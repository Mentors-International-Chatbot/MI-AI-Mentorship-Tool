# Platform Restructure Plan — v1.1

**Status:** Approved for phased execution. Supersedes v1 (conversation-only, never committed).
**Date:** 2026-08-21
**Repo location:** `docs/Platform_Restructure_Plan_v1.1.md`

**What changed from v1:** Phase A was rewritten end to end. v1 assumed `Enrollment` and `/home` had
to be built; the Phase A investigation
(`reports/phase-a-investigation.md`) found both already exist and are live. The real gap is
narrower and differently shaped — see Phase A. Journey-package audit
(`reports/journey-package-audit.md`) deltas are also folded in throughout, marked **[audit]**.
AIESS redesign is renamed **AI Guidance**.

**Scope:** Converge the player surface onto the single-thread PBJ pattern, complete the enrollment
migration, add the full block palette (onboarding / diagnostic / assessment / project / resource),
split roles into mentor → course admin → system admin with restructured dashboards, and formalize
the journey-package format as the authoring contract.

**Out of scope:** MI2024 chat/WhatsApp surface (frozen), Canvas/LTI (no deadline; resumes after
Phase E), visual builder + AI copilot (Phase F sketch; own doc when reached).

---

## Decision register (locked)

| # | Decision | Resolution |
|---|----------|------------|
| D1 | MI2024 during restructure | **Frozen.** No changes to chat surface, WhatsApp delivery, or MI content in Phases A–D. |
| D2 | Retakes / multi-course | One **ACTIVE** enrollment per (learner, course). Reset = archive + create fresh. **Blocked on Phase A** — `MilestoneProgress` carries its own code comment naming this as a retake blocker. |
| D3 | Rich web quiz | Schema-driven fixed palette: multiple choice, fill-blank, drag-order, matching. Never author-supplied HTML. |
| D4 | Course listing | `listed` flag on course config. MI2024 unlisted; PBJ, AI Guidance, SKILLS listed and open. |
| D5 | Project submission | In-platform `ProjectSubmission` + mentor review queue. Canvas AGS deferred. |
| D6 | System admin | Cross-org visibility intended. Seed `novanova@byu.edu`. Distinct `requireSystemAdmin` guard, separate `repo/system/` namespace, audit-logged writes. Never a loosening of `TenantContext`. |
| D7 | Scoping rule | Coursework → enrollment-scoped. Person-level (flags, sentiment, extracted context) → learner-scoped. |
| D8 | Onboarding output | Answers write to learner context; script frames the final project. |
| D9 | Authoring | **Superseded.** Michael authors, not Sam. Structured Markdown template + converter now; Phase E form reads/writes the identical format. |

---

## Frozen Surface Contract (MI2024) **[audit — tightened]**

The audit established the frozen contract precisely: `transformToLessonData` in
`db-lesson-service.ts` reads **only `teach` and `teach_back` fields**. Therefore:

- **New block types are safe to add.** They are invisible to MI by construction.
- **The frozen contract is `teach`/`teach_back`'s current shape**, not the whole schema.
- **New invariant test:** a package containing every new block type still produces byte-identical
  `transformToLessonData` output for MI2024. This is cheaper and tighter than re-running the full MI
  regression after every phase — run the invariant test always, the full regression only when
  `teach`/`teach_back`, the repo layer, prompts core, or the assessment service is touched.

Also frozen: chat-surface routing, WhatsApp handler, gate/session delivery on chat, MI content.
`channelSupport.ts` capability logic stays as-is; the unified block engine must carry a per-channel
capability map forward so a future MI migration cannot reintroduce the silent-gate dead-account
failure.

---

## Track 0 — Live defects, uncoupled from phases

1. **`media` / `resource` blocks have no renderer.** They validate and import; a learner reaching one
   gets stuck. Also blocks AI Guidance authoring (textbook excerpts, external links). Prompt written.
2. **WhatsApp gate-lock** — blocking assessment gate returns empty responses.
3. **`buildFreeformReferenceBlock`** in `content.ts` serves MI's 28 lesson titles to all courses; 18
   PBJ learners affected. Fix as config-driven, never a course-code branch.
4. **Stale comment:** `quiz_checkpoint` claims to be reserved/ungraded; it is fully live, rendered and
   graded with retry. One-line fix, separate commit. **[audit]**

---

# Phase A — Complete the enrollment migration *(rewritten)*

**What already exists** (per `reports/phase-a-investigation.md`): `Enrollment` as a full Prisma model
with repo CRUD, adversarial tenant tests, and live use in `resolvePlayerAccess`,
`resolveLearnerHome`, and `LearnerProject`. `/home` exists and is wired into post-login redirect.
**Do not rebuild any of this.**

**The four real gaps:**

- **G1** Coursework tables — `BlockProgress`, `AssessmentSession`, `SocioFeedback`,
  `MilestoneProgress` — are keyed by `socioId` + `collectionKey`, not `enrollmentId`.
- **G2** The non-LTI player path gates on legacy `Socio.curriculumCollectionKey` **before** consulting
  `Enrollment`. This, not a missing table, is the actual single-course constraint.
- **G3** Chat-surface and pbj-basics traffic never write live `Enrollment` rows. Only a one-time
  MI-only backfill script ever did, and it is never rerun.
- **G4** 16 of 23 socios (70%) have no valid `Enrollment` to derive `enrollmentId` from: 13 have zero,
  3 point at a dangling draft `ProgramVersion`.

### A.1 — Make enrollment creation live *(must come first)*

G3 before G4 before G1, non-negotiable: backfilling `enrollmentId` while write paths still fail to
create enrollments fixes 23 socios and breaks on the 24th.

1. Identify **every** path by which a learner begins a course — player entry, chat surface,
   pbj-basics, LTI launch, admin assignment, home-page enroll. Report the full list before changing
   any of them.
2. Each path creates or resolves an ACTIVE `Enrollment` through one shared repo method. One
   creation path, not six — a second one is how G3 happened.
3. Idempotent: re-entry resolves the existing ACTIVE enrollment, never a duplicate.
4. Test: exercise every path from item 1 and assert an `Enrollment` row exists after each.

### A.2 — Enrollment column additions **[investigation correction]**

`LearnerProject`'s partial unique index does **not** transfer verbatim: it indexes a column that
already exists, and `Enrollment` lacks `learnerId` / `collectionKey`. So:

1. Add the columns (mapping from whatever `Enrollment` currently keys on — report that mapping
   before writing the migration).
2. Then add `UNIQUE (learnerId, collectionKey) WHERE status = 'ACTIVE'` via raw SQL, following the
   `LearnerProject` migration pattern.
3. Add `listed Boolean @default(true)` to course config; MI2024 → `false`.

### A.3 — Enrollment-creation pass for orphaned socios

1. **Neon branch snapshot first.** Name `pre-enrollment-backfill`. Report the branch id.
2. The 13 zero-enrollment socios: derive from `Socio.curriculumCollectionKey`. Report per-socio what
   was derived before writing.
3. The 3 dangling-draft-`ProgramVersion` socios: **decision required from Michael** — repair onto a
   real version, or archive as test detritus. Do not guess; do not let them fall through to a
   default.
4. Post-pass assertion: zero socios without a resolvable ACTIVE enrollment.

### A.4 — `enrollmentId` backfill on the four coursework tables

1. Add nullable `enrollmentId` to `BlockProgress`, `AssessmentSession`, `SocioFeedback`,
   `MilestoneProgress`.
2. Backfill by joining through (socioId, collectionKey) → Enrollment. Report rows updated per table
   and any unmatched (expect zero after A.3; investigate any).
3. Repo methods read `enrollmentId`. Legacy columns stay — **drops are A.6, a later separate
   migration after one full verification cycle**.
4. `MilestoneProgress` carries a code comment naming this as the retake blocker — remove it when the
   backfill lands, and add the D2 reset test that comment implies.

### A.5 — Flip the player gate (G2)

The player path checks `Enrollment` first; `Socio.curriculumCollectionKey` becomes a fallback for
legacy rows only, with a deprecation comment naming A.6 as its removal. This is the change that
actually delivers multi-course.

### A.6 — Legacy column drops *(closed — see A.6.1–A.6.6 below; FINAL step blocked, not done)*

Only after one full verification cycle on A.1–A.5.

**A.6.1** widened `BlockProgress`/`MilestoneProgress`'s unique constraints to `enrollmentId`, dropping
`socioId`/`collectionKey` from the constraint shape (not appending). Its addendum also re-scoped every
progress-*read* path (`completeBlock`, `getCourseProgress`, `getLessonDashboard`, `getLessonDto`,
`resolveLearnerHome`'s `resolveCoursePath`, `playerMilestoneAvailabilitySnapshot`) from
`socioId`+`collectionKey` to `enrollmentId` — this is what actually makes a D2 reset show 0% progress
instead of inheriting the archived enrollment's completed lessons.
**A.6.2** did the same for `AssessmentSession` (`attemptNumber` now resets per enrollment).
**A.6.3** added a partial `CHECK` constraint on `Enrollment.collection_key` (`IS NOT NULL OR status =
'dropped'`), admitting the 3 known pre-Stage-2 dangling rows explicitly rather than leaving the column
silently nullable.
**A.6.4** confirmed those 3 rows are fully inert (no activity since Stage 3, no other enrollment) —
status check only, left alone.
**A.6.5** confirmed `/api/assessment/start` is still live and traced exactly where its missing
enrollment signal would need threading through (`GET /api/assessment/[sessionId]` → the client page →
the `POST /start` body) — deferred to Phase B, which touches assessment config directly anyway.
**A.6.6** wired `listed` into `/home`'s multi-enrollment choose-list (it wasn't consulted at all), with
graceful degradation when filtering collapses the list to 0 or 1 remaining course.

**A.6's FINAL step — the actual column drops — did not ship.** Investigation (full codebase grep, one
column at a time, plus an `information_schema` check for FK constraints) found none of the five target
columns (`Socio.curriculumCollectionKey`; `BlockProgress`/`MilestoneProgress`'s `socioId` +
`collectionKey`; `AssessmentSession.socioId`) actually have zero remaining reads, contrary to this
plan's original assumption. They are still the live, load-bearing course-identity and access-control
mechanism for the **chat surface** (MI2024, PBJ — `messaging/handler.ts`, `onboarding/service.ts`,
`chat/progress.ts`, `ai/contextExtractor.ts`), the **LTI overview/grading surface**
(`/api/lti/instructor/overview`, `lti/grades.ts`), and — most critically — the **AI prompt router's own
gate-session lookup** (`ai/prompts/gateSessions.ts`, `ai/prompts/router.ts`). None of that was ever in
Phase A's scope; only the player surface was. See **Phase A.7** below, filed to track this rather than
lose it.

As a same-day, low-risk consolation: `BlockProgress.socioId`/`collectionKey` were relaxed to nullable
and the player surface's three writers (`recordPlayerTutorSuccess`, `completeBlock`,
`markTeachBackComplete`) stopped populating them — their own reads already moved to `enrollmentId` in
A.6.1's addendum, so the columns were dead weight on every new row. Chat-surface writers (there are
none for `BlockProgress`; `MilestoneProgress`'s shared `recordMilestoneReached` writer was left
untouched) are unaffected. Old rows keep whatever value they already had.

### Verification (raw, unpiped)

1. `npx tsc --noEmit` · 2. `npm test` · 3. `npx eslint .` · 4. `npm run build`
5. Transform-invariant test (Frozen Surface Contract) + full MI regression — repo layer moved.
6. Adversarial tenant suite extended for the four newly-scoped tables.
7. Manual: one learner in AI Guidance + SKILLS concurrently, independent progress; reset SKILLS;
   retake from block 1; AI Guidance untouched; prior attempts still queryable.

**Exit criteria:** every course-entry path writes enrollments; zero socios without one; no coursework
read path ignores `enrollmentId`; D2 reset works end to end.

---

# Phase A.7 — Enrollment migration: chat + LTI + router *(new, filed from A.6's FINAL-step audit)*

**Not started.** Filed here so it stays tracked rather than becoming a footnote. Scope, as named by
A.6's own investigation:

1. **Chat-surface progress/milestone reads** — port `chat/progress.ts`, `ai/contextExtractor.ts`, and
   the several dashboard/cron/summary readers of `Socio.curriculumCollectionKey` off the legacy field
   onto `Enrollment`. This is the biggest piece, and the one most likely to **partly fold into Phase B**
   once the single-thread conversation engine exists there — Phase B is already rebuilding how a chat
   turn resolves "which course, which lesson," so the enrollment plumbing may be a natural byproduct
   rather than a separate pass. Re-evaluate scope once Phase B's engine lands.
2. **LTI overview/grading paths** — `/api/lti/instructor/overview` and `lti/grades.ts`'s
   `queueMilestoneGrade` both query `BlockProgress`/`MilestoneProgress` by `socioId`+`collectionKey`
   directly; need an enrollment-based join (or an enrollment-scoped aggregate) instead.
3. **The router's gate-session lookup** — `ai/prompts/gateSessions.ts` (feeding `stance.ts`'s
   gate-passed logic) calls `getAssessmentSessionsForSocioLesson(socioId, ...)` directly. High blast
   radius: this is core AI routing behavior, pinned by a large existing test suite
   (`stance.test.ts`, `router-progression.test.ts`, `router-stance.test.ts`, `gate-integration.test.ts`).
4. **`AssessmentSession.socioId`'s access-control role** — three API routes
   (`/api/assessment/[sessionId]/{,complete,message}/route.ts`) authorize on `session.socioId !==
   socioId` directly. Any migration here has to preserve that check, not just relocate its data source.

**Sequencing:** after Phase B, per (1) above. Exit criteria for A.7: all four items land, then — and only
then — A.6's FINAL step (the actual column drops) can be re-attempted.

---

# Phase B — Single-thread consolidation + block palette

**Goal:** one conversation per course — authored intro → onboarding button → optional diagnostic →
conversational teach with authored transitions → assessment → next. Exactly one call to action at
any moment: the chat input, or the current block's button.

### B.0 Investigate first

Map remaining v4.1 single-thread items; the PBJ gated-reteach session lifecycle for reuse on player;
block-type registry and `content/block-ids.json` four-step matching under new types; where the
right-hand dashboard is composed (attempts panel lands there).

### B.1 Course intro message **[audit — confirmed gap]**

No intro field exists in the schema. Add at course level; render as the thread's first
`kind: "prompt"` item — **derived, verbatim, never a model turn**. Every authored string in this
phase follows that rule.

### B.2 Block palette

**[audit] `handoff` is NOT a gap** — already on every block type and already rendered. Removed from
scope. It covers the authored conversation→assessment transition ("Great job! Let's move on…") as-is.

**`onboarding`** — gate card + button, opens a session (reuse assessment-session machinery, new
session kind) running an authored question script: name, background, experience, background↔topic
connection, plus the project-framing segment (D8). Writes to learner context and an
enrollment-scoped record. **[audit] Blocked on the onboarding shape audit** —
`metadata.onboarding` and `config.onboarding` are two uncross-validated shapes sharing a name; the
canonical one must be settled before this block extends either.

**`diagnostic_quiz`** — optional per course. Uses B.3 engine. `questionCount` 3–10,
`showScoreToLearner`, always non-blocking. Feeds dimension state / tutor context.

**`assessment`** — **[audit — rescoped]** not a from-scratch block type. The reteach knobs already
exist unnamespaced (`passing.threshold`, turn limits, `blocking`, `allowRetake`). Work is:
(a) wrap them under `mode: "reteach_gate"`, (b) add the `web_quiz` branch beside it, (c) add
`showScoreToLearner`. Reteach grading leniency is an **explicit prompt instruction** ("grade
generously; pass on demonstrated understanding, not phrasing"), not threshold tuning alone.

**`resource` / `media`** — schema and import already exist; renderer is Track 0.1. Read-and-continue
semantics, no new gate.

**Inline vs separate page — OPEN DECISION.** `quiz_checkpoint` is already live inline (graded,
retry-capped at 2). Proposed rule: short checks stay inline as thread cards; the separate page is
reserved for long mixed-format assessments (drag-drop, fill-blank, matching). Without an explicit
rule we get two overlapping quiz systems. **Needs Michael's confirmation before B.3 begins.**

### B.3 Web quiz engine (D3)

Route `/learn/[course]/[lesson]/quiz/[blockId]`. Question types v1: `multiple_choice`, `fill_blank`,
`drag_order`, `matching` — extending the existing `quiz_checkpoint` question shape (`graded`,
`options`, `answerKey`, `explanation`) **without breaking existing packages**. Server-side scoring →
durable `QuizAttempt` (enrollmentId, blockId, answers, score) → result line in thread respecting
`showScoreToLearner` → attempts panel on the right dashboard, viewable any time.

### B.4 UX debt closure

Single input (no duplicates); next block never renders while the mentor holds an open question; teach
blocks never duplicate prompt text post-answer (`!submittedComplete`); `comma_chained_enumeration`
violations degrade gracefully instead of escalating to generic fallback.

### B.5 Verification

Standard four + transform-invariant + config-only proof (`grep` for course-code literals outside test
fixtures — report hits) + full manual run-through with refresh.

---

# Phase C — Project, milestone interleaving, submission

### C.1 `project` block
Authored brief in-thread: overview, steps, skills, software, submission instructions. Config
references the course milestone set.

### C.2 Interleaving **[audit — priority raised]**
Only lesson-level and mentorResource-level milestone links exist; **block-level `milestoneRef` does
not exist and is the entire mechanism**. Teach blocks gain optional `milestoneRef`; on completion the
thread shows an authored interleave prompt with a done/skip affordance recording milestone progress.
Mapping is data — the author decides when project work happens, never the AI.

**AI Guidance milestone map (pending confirmation):** M1 pick your business process · M2 name your
failure/hallucination risks · M3 design prompting/context/tools · M4 choose your model with cost
justification · M5 choose platform + guardrails · Final write-up (what you built, how, what it does,
what it applies).

### C.3 `ProjectSubmission`
`enrollmentId`, `milestoneKey?`, `url?`, `fileRef?`, `note?`, `submittedAt`, `status`, `reviewerId?`,
`reviewerNote?`, `reviewedAt?`. Resubmission allowed, history preserved. Mentor review queue,
oldest-unreviewed first. Canvas AGS is a documented seam, no code.

---

# Phase D — Role split + three dashboards

**Roles:** learner · mentor · **course admin** (`course_lead` expanded) · **system admin**.
`requireSystemAdmin` is the only cross-org guard; cross-org repo methods live in `repo/system/`;
cross-org writes produce `AuditLog` rows. Seed `novanova@byu.edu` (idempotent). Self-signup open for
both admin roles for now; `EnrollmentInvitation` is the documented future lock.

**Mentor:** delete `SliderPanel` UI, **keep** the override machinery. Remove web-chat links from
mentor and admin navs. Main view becomes a **flag triage inbox** (severity × age) with an embedded
assistant whose tools — each mentor-confirmed, each logged — are `adjust_learner_overrides`,
`draft_message_to_learner`, `resolve_flag`/`snooze_flag`, `summarize_history`. Assistant prompt lives
in the DB prompt store, system-admin editable.

**Course admin:** course-scoped aggregates; **block-level funnel** (reached / completed / gate pass
rate — the content-quality heatmap that later feeds the Phase F copilot); **project pipeline**
(learners per milestone, stalled projects, review status); mentor↔learner assignment; reserved nav
slot for Course Configuration (Phase E).

**System admin:** prompt store, model config, logs, cross-org feedback, org management,
unanchored-records tile, feature flags. Built exclusively on `repo/system/`.

**Verification:** standard four + adversarial (course admin cannot read another org; mentor cannot
open either admin surface; cross-org write produces an AuditLog row; assistant tool calls require
confirmation; `adjust_learner_overrides` visibly changes tutor output).

---

# Phase E — Journey package: spec, converter, form editor

**[audit] The format already exists** at `apps/web/src/lib/journey-package/journey-package.schema.ts`
with `PackageLesson`, `LessonBlock`, typed variants, and graded questions carrying `answerKey` and
`explanation`. `LessonData` is the **legacy output** of `transformToLessonData`, not the starting
point. The spec documents and extends the real schema.

**E.0 — Authoring template + converter (pull forward, ahead of the form).** Michael authors AI
Guidance in a structured Markdown template; a converter emits journey packages. Authoring starts
immediately, the template doubles as the human-readable spec, and it stress-tests the schema before
form UI is committed to it. The Phase E form reads and writes the identical format — nothing
authored is thrown away.

**E.1 — Importer/exporter.** Finish `import-journey-package.ts` (blocks land as DB rows, idempotent
upsert, block-id continuity). Exporter for round-trip; **round-trip byte-comparability is the
validation harness** for the converter, the tools, and the form.

**E.2 — Form-based editor** in the course admin's Course Configuration section: lesson list → block
list → typed config form per block type (config schemas double as form schemas). Draft vs published;
publish runs the importer path so the editor cannot produce an unrunnable course.

**E.3 — Verification.** Round-trip green on SKILLS and AI Guidance; a course authored entirely in the
editor runs end to end with zero code changes; sensing/dimension-distribution check after a 3-lesson
run.

---

# Phase F — Visual builder + AI copilot *(sketch)*

Drag-and-drop canvas over the same format, reusing E.2 forms in a panel; copilot with
`create_block`, `edit_block_config`, `generate_quiz_from_teach_content`, `critique_flow`, grounded in
the spec and informed by D.3 funnel data. **Do not start without `Course_Builder_Plan_v1.md`.**

---

## Cross-cutting rules

1. Investigate-first gate: written report before code, every phase. *(This rule caught Phase A's
   stale premise before a line was written — it stays.)*
2. Raw unpiped output: `tsc` / `npm test` / `eslint` / `build`.
3. Transform-invariant test always; full MI regression when shared code moves.
4. `migrate dev` with the shadow DB, never `db push`. Neon branch snapshot before destructive or
   backfill migrations.
5. `TenantContext` first parameter, repo-only prisma access, adversarial suite extended per model.
   Sole exception: `repo/system/` behind `requireSystemAdmin`.
6. Configuration over custom code: a per-course `if` outside test fixtures is a defect.
7. Authored strings are derived verbatim, never generated.

## Sequencing

```
Track 0 (live defects)          ── anytime, uncoupled; resource renderer first
Onboarding shape audit          ── running; blocks B.2 onboarding + E.0
E.0 authoring template          ── after onboarding audit; parallel with A
A  Complete enrollment migration ← current phase
B  Single thread + block palette
C  Project + interleave + submission
D  Roles + three dashboards
E.1–E.3 importer + form editor
(Canvas/LTI resumes here)
F  Visual builder + copilot      ← own plan doc first
```

## Open decisions blocking work

| Question | Blocks | Owner |
|---|---|---|
| 3 dangling-draft-`ProgramVersion` socios: repair or archive? | A.3 | Michael |
| Inline `quiz_checkpoint` vs separate page — split rule? | B.3 | Michael |
| AI Guidance module → lesson breakdown | E.0 | Michael |
| Three missing activities (M3 motivating, M4 closing, M5 closing) | E.0 | Michael / Brad |
| Milestone map confirmation | C.2, E.0 | Michael / Brad |
| Diagnostic quiz for AI Guidance — include? show score? | B.2 | Michael |
| Canonical onboarding shape | B.2, E.0 | onboarding audit |
