# Phase B Verification Report (B.5)

Date: 2026-08-24
Scope: investigation and verification only, per instructions. No fixes applied for anything found.
One documentation addition made per explicit instruction (§2, `showScoreToLearner`'s write-time/
non-retroactive behavior) — that's the one exception to "no implementation," called out where it
happens below.

Reference: `docs/Platform_Restructure_Plan_v1.2.md` Phase B. Verifies B.1 (course intro message), B.2
(block-level `assessment` override schema + reteach_gate read-path wiring + player-surface write-path
gate), B.3 (dashboard container Stage 2 + `web_quiz` grading Stage 1, both now shipped — see update
below), B.4 (`comma_chained_enumeration` accept-path) together, in aggregate.

**Update (post-B.3-Stage-1-completion)**: at the time this report was first written, B.3's shipped
scope was Stage 2 only (dashboard container) — Stage 1 (`gradePlayerBlock`'s `web_quiz` grading branch)
had been investigated but not approved or built. Stage 1 has since been approved, built, and verified;
§1, §4, and the closing section below have been updated with fresh findings from that pass. §1's three
checks (`tsc`, full suite, eslint) were re-run in full against the Stage 1 diff. §2's live-content
census was re-run fresh (not carried over) per that stage's own verification instructions — still 0
blocks with an `assessment` key, now 518 blocks / 96 `LessonVersion` rows checked (broader than the
original 471-block count, which was scoped to 4 collections' matched-version lesson bodies only; this
recheck queried every `LessonVersion` row in the table). §2's other findings (schema parses, resolvers)
and §3's grep were not re-run in full, since Stage 1 touched no schema file — only `service.ts` and a
new test file — but §3's grep pattern was re-run specifically against the Stage 1 diff and found the
same zero hits.

---

## 1. Standard four

**`tsc --noEmit`** — clean, zero output. (Re-run after B.3 Stage 1: still clean.)

**`npm test`** (`npx vitest run`) — **1538 passed, 1 skipped**, 129 test files (up from 1533/128 —
the five new `completeBlockWebQuiz.test.ts` cases). The one skip is the same pre-existing gate noted in
B.2's report: `activeFlagWhere agrees with isFlagActive` (`src/lib/flags/__tests__/active.test.ts`),
gated on `TEST_DATABASE_URL` not being set — confirmed exactly one `SKIPPED` line in the raw output,
nothing else.

**`eslint` on the full `src` tree** — **17 errors, 23 warnings**, same count as B.2's report. Same 7
files carry every error, confirmed by diffing the file list against B.2's report verbatim:
`app/api/cron/check-in/route.ts`, `app/api/cron/cleanup-logs/route.ts`, `app/api/cron/summaries/route.ts`,
`app/api/dashboard/socios/[id]/summary/generate/route.ts`, `app/api/feedback/route.ts`,
`lib/courses/course-meta.ts`, `lib/logging/logger.ts`. **No new file.** All 23 warnings are pre-existing
unused-var/hook-dependency warnings in files this session never touched.

**Raw-prisma build guard, confirmed globally** — the eslint run above *is* the global check (not
scoped to `git diff` files this time, unlike B.2's per-file confirmation). Same 17 `no-restricted-syntax`
errors, same 7 files, all pre-existing and none touched this session (cross-checked against the
session's full changed-file list in §3 below — zero overlap).

---

## 2. Transform-invariant check

Reloaded every ProgramVersion row for all four collections (`mi-colombia-curriculum`, `pbj-basics`,
`skills-tool-calls`, `ai-essentials`) through the shipped B.1–B.4 schema code — **10 rows total**
(MI ×2, PBJ ×1, AIESS ×2, skills-tool-calls ×5) — via a throwaway read-only script (deleted after use,
same pattern as prior investigations), directly against the live Neon DB.

**What actually matters for "additive and null-safe," confirmed clean on all 10 rows:**

- **`programVersionConfigSchema.safeParse(pv.config)` — OK on all 10 rows.** This is what real runtime
  code actually parses (`player/service.ts`'s `resolvePlayerAccess`, etc.) — not a synthetic check.
  Every row's `config.assessment` (where present — PBJ, MI both absent; AIESS/skills-tool-calls also
  absent) parses with `showScoreToLearner` defaulting correctly and **no `mode` key** on any row
  (confirmed: `'mode' in assessment === false` everywhere), matching the design-(c) correction that
  `mode` is block-level, never package-level.
- **All three metadata resolvers ran clean on all 10 rows, zero throws**: `resolveIntroMessage` returned
  `null` on every single row (no course has authored one yet — expected, since B.1 only shipped the
  mechanism, not content); `resolveListed`/`resolveDelivery` returned the same values already known
  from Phase A (MI `listed: false`, everything else `true`; delivery surface `chat`/`chat`/`player`/`player`
  matching each collection's known shape).
- **Zero blocks anywhere carry an `assessment` key.** Census across all 10 rows' full lesson bodies
  (471 total blocks: 8 PBJ + 112×2 MI + 112×2 AIESS + 12/12/12/13/13 skills-tool-calls): **0 blocks**
  have the key. This is the load-bearing fact — `blockAssessmentOverrideSchema`'s superRefine
  (mode/blockType cross-check, config.assessment-presence check, the player-surface reteach_gate
  write-path gate) is **provably inert against every live and archived version of every current
  course**, not just believed inert by design.
- `mergeBlockAssessmentConfig(base, undefined)` — confirmed byte-identical to `base` reshaped, the only
  call shape any live block could ever produce today (since none carry an `assessment` key to pass as
  an override).

**Two `journeyPackageSchema.safeParse` failures on full-package reconstruction — both pre-existing,
neither caused by this session, explained precisely rather than left as unexplained noise:**

- **PBJ**: `quiz question "q1-order" requires an explanation in schema 1.2`. This rule
  (`journey-package.schema.ts:911`) predates this session by two weeks — `git log -L` on that line
  shows it was introduced 2026-08-10, in a commit unrelated to Phase B. PBJ's own content has always
  been missing this explanation; nothing in B.1–B.4 touches quiz-question validation.
- **MI Colombia** (both versions): `metadata.packageId`/`title`/`languages`/`version` all "expected
  string/array, received undefined." This is **an artifact of my own verification script's
  reconstruction, not a real gap** — MI's `ProgramVersion.metadata` is a genuinely *partial* object
  (`{listed: false}`, written by `scripts/set-mi2024-unlisted.ts` in Phase A, not a full re-import), and
  `journeyPackageSchema` — the full-package validator — is **only ever invoked at import time**
  (`import-journey-package.ts`'s `validateAndImport`), never at runtime against existing DB rows. No
  production code path reassembles MI's DB rows into a full package and reparses them; the resolvers
  (`resolveListed`, `resolveDelivery`, `resolveIntroMessage`) are specifically designed to tolerate
  exactly this partial shape, and all three did, cleanly, confirmed above. This failure would have
  occurred identically before any B.1–B.4 change — it's a property of my test harness reaching for a
  check nothing in production performs, not a regression.

**`showScoreToLearner` documentation — was undocumented outside this conversation, now fixed.** Grepped
`src/lib/player/service.ts`, `journey-package.schema.ts`, `program-version-config.schema.ts` for
"write-time"/"not retroactive"/"retroactively" — zero hits before this stage. Per instruction, added
the doc comment now (not new scope): extended `resolveReteachGateSignal`'s existing docblock in
`player/service.ts` with the exact claim — the gated score is baked into `BlockProgress.score` at
completion time, later config changes don't retroactively reveal it, and every later reader (this
function's caller, `getLessonDto`'s progress array, a future dashboard panel) inherits that write-time
decision for free. This is the one non-investigation change in this report; it's a comment only, no
behavior touched, and `tsc`/tests were reconfirmed clean after adding it.

---

## 3. Config-only proof

Checked the entire B.1–B.4 diff (one commit, `c3182b4` "phase b.2", 22 files, 1285 insertions) for any
course-identity branch:

```
git show c3182b4 | grep '^\+' | grep -iE "collectionKey ===|courseCode ===|slug ===|organizationId ===|'mi-colombia|'pbj-basics|'skills-tool-calls|'ai-essentials"
→ zero hits

git show c3182b4 | grep '^\+' | grep -iE '\bif\s*\(.*(collectionKey|courseCode|organizationId|programVersionId|slug)\b'
→ zero hits
```

A broader, non-`if`-scoped grep for the course-name/collection-slug strings themselves found 8 hits —
every one is either a code comment citing a course by name for rationale (e.g. "PBJ's own mechanism" in
a test description) or a test-fixture literal (`collectionKey: "ai-essentials"` inside a mock `access()`
object) — never an application-code branch that decides B.1–B.4 *behavior* on course identity. Confirmed
by inspection of each hit, not just the grep count.

---

## 4. Manual run-through

**What I verified directly (DB reads through the shipped code, no live server or LLM calls) — and what
I did not attempt, stated plainly rather than left implicit:**

I did not have a running dev server or browser session in this environment, and network access
(`curl`, process listing) is permission-gated in this session. Rather than fabricate a "played it,
works" claim, here is exactly what was and wasn't checked, and why what's below is a reasonable
substitute for the parts that don't need a live LLM call.

### `skills-tool-calls`

- **Intro message**: `resolveIntroMessage` returned `null` for every one of its 5 ProgramVersion rows
  (§2). No course-level intro message is authored anywhere in this collection's history, so the
  thread's first item is exactly as it was pre-B.1 — nothing to visually confirm because there is
  nothing new to render.
- **Dashboard container**: confirmed in the B.3 investigation (still true, re-confirmed here) that this
  collection has no `config.projectSelection` — `getLessonDashboard()`'s outer gate
  (`service.ts:353`) returns `null` before `buildLessonDashboard()` is ever reached, and
  `hasAttemptsData()` stubs to `false` regardless, so the dashboard container is provably absent, same
  as before B.3.
- **The two graded `quiz_checkpoint` blocks** (`stc-08-questions-skill`, `stc-10-questions-tool-calls`):
  **update — B.3 Stage 1 (`web_quiz` grading) has since shipped.** `gradePlayerBlock`'s `quiz_checkpoint`
  branch now has a `block.assessment?.mode === "web_quiz"` path, but confirmed via the fresh census
  (518 blocks, 96 `LessonVersion` rows, 0 with an `assessment` key) that neither of these two blocks —
  nor any block in this collection — carries that key. Grading for these blocks therefore still runs
  through the untouched `else` path, which is byte-for-byte the same code that existed before B.3
  Stage 1 (confirmed by reading the diff: the pre-existing return construction was extracted into
  `rawScore`/`rawFeedback` locals and returned unchanged in the no-`assessment.mode` branch — nothing
  about the values themselves changed). This is now "unaffected because the branch that reads
  `assessment.mode` finds nothing to match," not "unaffected because the branch doesn't exist" — a
  materially different but equally safe guarantee, and the new `completeBlockWebQuiz.test.ts` includes
  a regression-guard test pinning this exact case (no `assessment.mode`, `showScoreToLearner: false` at
  the package level) to prove the package-level setting cannot leak into a block that never opted in.
- **`comma_chained_enumeration` accept-path reachability**: confirmed structurally reachable (this
  collection has `responseStyle` configured, per the B.4 investigation) but **not exercised with a new
  live LLM call in this pass** — that would mean starting a dev server, authenticating as a test
  learner, and spending real provider calls to reproduce a failure shape that's already unit-pinned
  against the exact real acceptance-log text (B.4's two new tests in `streamWithRetry.test.ts`). I did
  not judge triggering new live model calls as necessary to close this verification stage given that
  evidence already exists; flagging this explicitly so it's a stated gap, not a silent one, if you want
  it exercised live regardless.

### `ai-essentials` (both package versions)

- Same intro-message and `comma_chained_enumeration` findings as above (both versions:
  `resolveIntroMessage → null`; `responseStyle` configured, confirmed reachable, not live-exercised
  this pass).
- **`assessment.mode` absence, confirmed explicitly as asked, and reconfirmed fresh post-B.3-Stage-1**:
  §2's original census found zero blocks with an `assessment` key across both `ai-essentials` versions
  (112 blocks each, 224 total); the fresh whole-table recheck (518 blocks, 96 `LessonVersion` rows) found
  the same zero, now covering `web_quiz` too, not just `reteach_gate`. This collection is unaffected by
  either the reteach_gate schema gate or the new `web_quiz` grading branch **because it has never
  attempted to use either feature**, not because either was silently blocked — nothing in either
  package's authored content or its DB-stored `LessonVersion` rows would trip either path.
- Dashboard container: AIESS *does* configure `projectSelection` (unlike skills-tool-calls), so
  `getLessonDashboard()` does reach `buildLessonDashboard()` for learners with a confirmed project —
  this path is unchanged by B.3 Stage 2, since `hasAttemptsData()` stubbing to `false` makes the new
  OR-branch of the null condition logically inert; the null condition B.3 shipped is proven equivalent
  to the old one in §1's full test-suite pass (`dashboard.test.ts`'s existing project-path assertions
  needed zero changes).

### MI Colombia — re-confirmation in aggregate, citing rather than re-deriving

Per instruction, this is a citation pass, not new investigation:

- **B.1 (intro message)**: unreachable — `resolveIntroMessage`/`PlayerAccess.introMessage`/
  `getLessonDto`'s `introMessage` field are all player-surface-only (`player/service.ts`), and MI never
  calls `resolvePlayerAccess`/`getLessonDto` — confirmed again here via
  `grep -rl "resolveIntroMessage" src/lib/messaging src/lib/ai/prompts src/app/chat` → zero hits.
- **B.2 (reteach_gate wiring)**: unreachable by the same structural proof from the B.2 investigation —
  `invokeStyledPlayerResponse`/`gradePlayerBlock`/`completeBlock` are player-only; the chat surface's
  `router.ts`/`gateSessions.ts` continue to use the pre-existing, untouched
  `getAssessmentSessionsForSocioLesson` (legacy `repo`, not the new `TenantRepo` twin B.2 Stage 1 added).
- **B.3 (dashboard container)**: unreachable — `buildLessonDashboard`/`PlayerDashboard.tsx` are
  player-component-only, confirmed again here via the same grep (zero hits in chat-surface files).
- **B.4 (`comma_chained_enumeration`)**: unreachable by a *hard runtime assertion*, not inference — the
  B.4 investigation found `ai/service.ts:512-519`'s `if (playerTurn) { if (delivery.surface !== 'player')
  throw ... } else { if (delivery.surface !== 'chat') throw ... }`, which makes a chat-surface call
  physically incapable of reaching `invokeStyledPlayerResponse`.

**New this pass**: a single grep across all four stages' functions
(`resolveIntroMessage|buildLessonDashboard|mergeBlockAssessmentConfig|resolveReteachGateSignal|blockAssessmentOverrideSchema`)
against `src/lib/messaging`, `src/lib/ai/prompts`, `src/app/chat` returned **zero hits** — none of the
four stages' new functions or schema symbols are even imported anywhere the chat surface can reach,
which is the aggregate confirmation this report exists to produce.

---

## Is Phase B safe to consider closed?

**Yes, with one explicitly-named piece of known open scope, not a gap this report failed to catch:**

- B.1–B.4 as shipped are additive, null-safe, config-only, and unreachable from the chat surface —
  confirmed in aggregate across all four sections above, not just per-stage.
- The one uncommitted change from this report (§2's doc comment) is a comment-only addition; `tsc` and
  the full suite were reconfirmed clean after it.
- **The reteach_gate write path is deferred by design, not forgotten.** Nothing on the player surface
  creates or scores an `AssessmentSession` yet (Option A from B.2, explicitly not built), and the
  schema-level gate B.2 shipped rejects `assessment.mode: "reteach_gate"` on any player-surface package
  specifically so this absence can't silently strand a learner — confirmed still enforced in this pass
  (§2's zero-live-usage census means the gate has never had to fire against real content, but its own
  test suite from B.2 still passes in §1's full run).
- **B.3 Stage 1 (`web_quiz` grading) is now closed, moved off this list.** `gradePlayerBlock`'s
  `quiz_checkpoint` branch gates both `score` and `feedback` on `mergeBlockAssessmentConfig`'s
  `showScoreToLearner` when `block.assessment?.mode === "web_quiz"`, written into `BlockProgress` at
  completion time (same write-time-null shape as B.2's `reteach_gate`, not a response-time redaction).
  Design choice made and recorded here as instructed: **full suppression** (`feedback: null`), not
  partial field-stripping of just `correctAnswer`/`explanation` — a per-question correct/incorrect
  breakdown is itself a score, just not expressed as a fraction, so stripping only the answer-revealing
  fields would still leak the outcome `showScoreToLearner: false` is asking not to reveal. This mirrors
  `resolveReteachGateSignal`'s already-shipped coarse-null convention rather than inventing a second,
  finer-grained redaction shape for a sibling gate. Confirmed the retry mechanism still functions with
  feedback fully suppressed — `complete: false` is still returned on an incomplete attempt regardless of
  feedback shape, so the block stays open for resubmission; the client only loses the "Try again"-labeled
  button in favor of a generic "Submit answer" label, since `feedbackAllowsRetry` requires a real
  quiz-shaped feedback object that `null` doesn't satisfy. Five new tests in `completeBlockWebQuiz.test.ts`
  cover both `showScoreToLearner` settings and two regression guards; the fresh content census (518
  blocks, 0 with `assessment`) reconfirms this ships against zero live risk.
- **§4's live-LLM verification of `comma_chained_enumeration` was not performed in this pass** — the
  evidence backing that finding is real (dated acceptance-log data plus two unit tests replicating the
  exact failure shape) but is not the same as a fresh live confirmation. Named explicitly rather than
  implied as done.

Nothing found in this pass rises to "fix before closing" — everything above is either already-mitigated
(the schema gate), already-tested (`web_quiz`'s and `comma_chained_enumeration`'s unit coverage), or
genuinely inert against all current content (zero live `assessment` usage). Phase B can be considered
closed with **two** items carried forward explicitly as open, not closed, scope: the reteach_gate write
path, and live-LLM re-confirmation of B.4.
