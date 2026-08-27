# Platform Restructure Plan — v1.2

**Status:** Phase A closed. Phase B not yet started.
**Supersedes:** v1.1 (repo copy at `docs/Platform_Restructure_Plan_v1.1.md`).
**Date:** 2026-08-23

**What changed from v1.1:** Phase A is closed — A.1 through A.6 shipped, A.6's final step (dropping
five legacy columns) did not, and is refiled below as **Phase A.7**. This is not a failure of Phase
A; the investigation gate did exactly its job, finding that `curriculumCollectionKey`,
`BlockProgress`/`MilestoneProgress`'s `socioId`+`collectionKey`, and `AssessmentSession.socioId` are
still live, load-bearing infrastructure for the chat surface, LTI grading/overview, and — most
consequentially — the AI prompt router's own gate-session lookup. None of those three surfaces were
ever in scope for Phase A. Also folded in: `listed` is `ProgramVersion.metadata.listed` via
`resolveListed()`, not a dedicated Boolean column as v1.1 stated.

---

## What Phase A actually delivered

**The player surface is fully enrollment-native.** `Enrollment` is the access gate, the content pin
(version-pinned, never floats), and the progress-scoping key for `BlockProgress`/`MilestoneProgress`
reads. A reset now behaves like a real reset: the new enrollment shows 0% progress, the old
enrollment's history stays intact and independently queryable. `/home` lists every active enrollment,
degrades gracefully at 0/1/2+, and excludes unlisted collections (MI2024) even under a real
multi-enrollment fixture.

**Chat, LTI, and the AI prompt router are not enrollment-native, and were never asked to be.**
They still run entirely on `Socio.curriculumCollectionKey` and the legacy `socioId`/`collectionKey`
columns. This is the honest state, not a gap that slipped through — A.6's investigation gate is what
caught it before a column drop broke the router.

### Confirmed still-live dependents (blocking the column drops)

| Column | Blocking dependents |
|---|---|
| `Socio.curriculumCollectionKey` | Entire chat-surface course-identity mechanism (handler.ts, onboarding, chat progress, join); auth surface (`/api/auth/me`, `/api/auth/curriculum`); dashboard/admin rollups; cron summaries; LTI provisioning |
| `BlockProgress.socioId`/`.collectionKey` | `learnerProjectSelectionRequired` grandfathering check; `/api/lti/instructor/overview` |
| `MilestoneProgress.socioId`/`.collectionKey` | Chat progress display; **`ai/prompts/router.ts`'s milestone-gating logic**; LTI grade passback (`lti/grades.ts`); LTI instructor overview |
| `AssessmentSession.socioId` | Ownership checks (403 authorization) on 3 live API routes; `getAssessmentSessionsForSocio` (foundational, used by `createAssessmentSession`, dashboards, signals); **`getAssessmentSessionsForSocioLesson` → the router's stance/gate-passed logic**, pinned by 5 test files |

The two bolded rows are why this isn't a follow-up commit: dropping either breaks core AI behavior,
not a side surface.

### What A.6 did ship

- **A.6.1/A.6.2** — unique constraints on `BlockProgress`, `MilestoneProgress`, `AssessmentSession`
  widened to `enrollmentId`, dropping `socioId`/`collectionKey` from the constraint shape entirely.
  Retakes now create independent rows instead of colliding. `AssessmentSession.attemptNumber` resets
  per enrollment (confirmed: D2 decision was "fresh attempts on retake").
- **A.6.1 addendum** — the read side. All ~10 progress-read call sites re-scoped from
  `socioId`+`collectionKey` to `enrollmentId`. This is the change that makes D2 actually mean
  something: a reset now shows 0% complete, not inherited progress from the archived enrollment.
  Proven against a real fixture on the live dev DB (complete 13/13 blocks under enrollment #1, reset,
  confirm 0/13 under enrollment #2, confirm enrollment #1's history still independently queryable).
- **A.6.3** — `Enrollment.collection_key` gets a partial `CHECK` constraint
  (`collection_key IS NOT NULL OR status = 'dropped'`), admitting the 3 known archived rows as a
  named, bounded exception rather than leaving the column silently nullable forever.
- **A.6.4** — the 3 archived rows confirmed permanently inert. Status check, no action.
- **A.6.5** — `/api/assessment/start`'s missing course signal scoped (three additive touches: surface
  `enrollmentId` on the session GET, thread it through the retry page, accept it optionally on the
  POST with server-side cross-tenant verification). Deferred to Phase B, which touches assessment
  config directly anyway.
- **A.6.6** — `listed` wired into `/home`'s multi-enrollment choose-list, with 0/1/2+ degradation.
  Verified against a real MI2024-plus-other fixture, not just prod's current 0-instances state.
- **Closing cleanup** — player-surface writers stopped populating the now-dead `socioId`/
  `collectionKey` on `BlockProgress`/`MilestoneProgress` creates. Chat-surface writers untouched.

---

# Phase A.7 — Enrollment migration: chat + LTI + router *(new, filed from A.6's blocked step)*

**Not started. Sequenced after Phase B**, with an explicit re-evaluation point: chat-surface
migration may partly fold into Phase B's single-thread engine work, since MI2024 is frozen but PBJ
runs on the same chat surface and Phase B's block palette is being built for exactly this kind of
course. Check at Phase B's B.0 investigation gate whether building B's `assessment` block against the
legacy `AssessmentSession.socioId` path is about to create fresh work A.7 will have to redo — if so,
sequence the relevant slice of A.7 earlier.

**Scope, per A.6's investigation:**

1. Port chat-surface progress/milestone reads (`chat/progress.ts`, `onboarding/service.ts`) onto
   `Enrollment`. Chat-surface courses currently have no `Enrollment`-equivalent access gate at all —
   this is the harder half, not a mechanical rename.
2. Port the LTI overview (`/api/lti/instructor/overview`) and grade passback
   (`lti/grades.ts`) onto `Enrollment`.
3. Port `ai/prompts/router.ts`'s milestone-gating and `getAssessmentSessionsForSocioLesson`'s
   stance/gate-passed logic onto `Enrollment`. **Highest-risk item in this phase** — five test files
   (`stance.test.ts`, `router-progression.test.ts`, `router-stance.test.ts`, `gate-integration.test.ts`,
   `channelSupport.test.ts`) currently pin the legacy behavior; changing the router's course-identity
   source is a change to core AI behavior, not infrastructure plumbing.
4. Redesign `learnerProjectSelectionRequired`'s grandfathering check (currently deliberately
   collection-scoped, not enrollment-scoped, per its own code comment) — this needs a product decision
   about what grandfathering means once enrollment-scoping exists, not a mechanical swap.
5. Complete A.6.5's deferred `/api/assessment/start` enrollmentId threading.
6. Only then: drop `Socio.curriculumCollectionKey`, the two coursework tables' legacy columns, and
   `AssessmentSession.socioId`. Re-run A.6's FINAL-step grep at that point — don't assume the item 1
   list of ~150 hits is unchanged.

**Investigate-first gate for A.7 itself, when it starts:** map exactly which of the ~150
`curriculumCollectionKey` hits are chat-surface-frozen (D1 — MI2024 untouchable) versus PBJ/general
chat infrastructure that can move. This determines whether A.7 can touch chat code at all without
violating the Frozen Surface Contract, or whether it needs its own parallel legacy-path preservation
for MI2024 specifically, the same shape as `transformToLessonData`.

---

# Phase B — Single-thread consolidation + block palette

*(Unchanged from v1.1, with one addition to B.0.)*

**Goal:** one conversation per course — authored intro → onboarding button → optional diagnostic →
conversational teach with authored transitions → assessment → next. Exactly one call to action at
any moment.

### B.0 Investigate first — **add this item**

0. **Check against A.7 before building the `assessment` block.** The `reteach_gate` mode's session
   lifecycle is the PBJ machinery, which currently runs on `AssessmentSession.socioId` — a column
   A.6's investigation confirmed is still load-bearing and not yet enrollment-scoped (A.7 territory).
   Report whether building B's assessment block against the current legacy path creates rework A.7
   will have to redo, or whether B can build directly against `enrollmentId` now that the column
   exists (even though old rows and other call sites still populate/read the legacy field alongside
   it). Prefer building new code against `enrollmentId` from day one wherever the column is already
   populated — the legacy field only needs to keep being *read* by the surfaces A.7 hasn't migrated
   yet, not written into by new B-era code.

*(Remaining B.0–B.5 content unchanged from v1.1 — see that document for full detail: block-type
registry mapping, PBJ gated-reteach session lifecycle, course intro message, the full block palette
including `onboarding`/`diagnostic_quiz`/`assessment`/`resource`/`media`, the web quiz engine, UX debt
closure, and verification steps.)*

---

## Decision register — additions since v1.1

| # | Decision | Resolution |
|---|----------|------------|
| D10 | Retake semantics | A retake is a fresh start. Prior enrollment's progress is not visible under the new enrollment; its history remains independently queryable by its own id. Delivered in A.6.1's addendum. |
| D11 | Assessment attempt counting | Resets per enrollment, not lifetime. Delivered in A.6.2. |
| D12 | `collection_key` nullability | Partial `CHECK` constraint admitting only `status = 'dropped'` rows as null, rather than a plain nullable column or a blanket `NOT NULL` that the 3 archived rows can't satisfy. |
| D13 | Column drops sequencing | Never drop a column based on "no reads in the surface I migrated." Require a full-codebase grep across every surface, migrated or not, before any drop. (This is the rule A.6's investigation gate enforced; codifying it so A.7 follows the same discipline.) |

## Sequencing (updated)

```
Track 0 (live defects)              — done (media/resource renderer, quiz_checkpoint comment)
Onboarding shape audit              — done (config.onboarding canonical)
Phase A (A.1–A.6)                   — DONE, not yet committed
  A.7 (chat/LTI/router migration)   — filed, sequenced after B, re-evaluate at B.0
E.0 authoring template              — blocked on Michael: module/lesson breakdown,
                                        3 missing activities, milestone map
B  Single thread + block palette    ← next
C  Project + interleave + submission
D  Roles + three dashboards
E.1–E.3 importer + form editor
(Canvas/LTI resumes here)
F  Visual builder + copilot          ← own plan doc first
```
