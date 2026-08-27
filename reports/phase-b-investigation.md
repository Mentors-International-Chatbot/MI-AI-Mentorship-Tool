# Phase B.0 Investigation Report — Single-thread consolidation + block palette

Date: 2026-08-23
Scope: investigation only, per instructions. No schema, migration, or application code was changed.
Four throwaway diagnostic scripts (`apps/web/scripts/_query-*.ts`) were created to query the live Neon
DB for quiz_checkpoint usage, then deleted after use — same pattern as Phase A's diagnostic scripts.
The repo has no other working-tree changes.

References: `docs/Platform_Restructure_Plan_v1.2.md` (Phase B), `docs/Platform_Restructure_Plan_v1.1.md`
(full B.0–B.5 text, since v1.2 elides it), `reports/journey-package-audit.md`,
`reports/onboarding-shape-audit.md`, `reports/phase-a-investigation.md`.

---

## 1. Single-thread state — what's actually left open

**`ThreadItem` kinds** (`apps/web/src/components/player/LessonPlayer.tsx:65-81`) — exactly three,
exhaustive: `"block"` (a completed block's authored content, replayed as history), `"prompt"` (an
authored transition/handoff/teach-back prompt shown while its block is current), `"tutor"` (a
persisted chat turn, learner or mentor/AI).

Of the four UX issues the plan names, **three are already fixed** by Phase A-era work on
`LessonPlayer.tsx` and `player/service.ts`; **one is still live**:

- **Duplicate input boxes — fixed.** Exactly one `<textarea>` in the component (`LessonPlayer.tsx:713`),
  shared across all block types; label/placeholder change with `requiresResponse`/teach-back state but
  there is only ever one control. A code comment at lines 364-379 documents the fix directly: there
  used to be two boxes (this one plus a separate teach-back box with its own send button); intent now
  follows the current block instead of which box was typed into.
- **Next-block rendering while a question is open — fixed.** `threadItems` (lines 446-521) breaks out
  of the block walk at the first non-done, non-current block (`if (!isDone && !isCurrent) break;`,
  line 496); the current block's own content is never pushed as history, only completed ones are. The
  `current` pointer only advances once a block is in `completed`, which requires the server to confirm
  the block is actually done — not merely gated.
- **Teach blocks duplicating prompt text post-answer — fixed**, via a `!submittedComplete.has(current.id)`
  guard wrapping every non-teach_back block's authored content (`teach` line 677, `quiz_checkpoint` 678,
  `drag_order` 685, `media` 686, `resource` 687). Once a block is in the reviewed/held state, only a
  generic "keep talking or continue" hint plus the Continue button render — not the original prompt.
- **`comma_chained_enumeration` — still escalates to the generic fallback, not fixed.** It's one of 16
  `ResponseStyleViolation` kinds (`apps/web/src/lib/player/responseStyle.ts:11,136`), detected via
  `hasCommaChainedEnumeration` (`telemetryMetrics.ts:1-16`). The repair pipeline
  (`apps/web/src/lib/ai/service.ts:214-282`) allows exactly one repair pass
  (`MAX_STYLE_REPAIRS = 1`), with a comma-specific repair instruction
  (`responseStyle.ts:193-197`), but if the violation survives that one repair it throws
  (`service.ts:253-260`) and is caught by the generic AI-failure handler
  (`service.ts:874-897`), which returns the same `AI_ERROR_FALLBACK` string used for timeouts and
  provider errors alike (`i18n/languages.ts:226-230`). There is no dedicated degrade path — the plan's
  characterization is accurate as of today.

**The three advance gates**, doc-commented together at `LessonPlayer.tsx:112-127`:

- **`requiresResponse`** (`current.blockType === "teach" && expectsResponse === true`) — enforced
  **client-side only** (send button disabled while the textbox is empty). Not enforced server-side:
  `gradePlayerBlock` for `teach` blocks (`service.ts:539`) always returns `complete: true` regardless of
  response content, so a direct API call bypasses it. A client escape hatch also exists: after 2 failed
  sends, a "Continue without sending" button appears.
- **Teach-back turn-count gate** — server-side. `recordPlayerTutorSuccess` (`service.ts:291-326`) only
  completes the block once `context.teachBackTurn === 2` (computed from persisted `state.turnCount`).
  `teach_back` cannot complete through the normal `completeBlock`/`gradePlayerBlock` path at all — that
  path explicitly throws `PlayerError(409, "tutor_required", ...)` for it (`service.ts:587`).
- **Open-question gate** — server-side, in `completeBlock` (`service.ts:623-699`). If the last assistant
  message for the block ends with a question (`metadata.endsWithQuestion === true`,
  `persistedBlockHoldsOpenQuestion`, `service.ts:604-621`), a would-be-complete block is instead marked
  `reviewPending: true`; the client routes it into `submittedComplete` and requires one explicit Continue
  click — a one-click soft hold, not a true block.

**`gatedStreak`** (`LessonPlayer.tsx:249`) is client-side state counting *consecutive* blocks completed
via the open-question soft-hold (not via real graded feedback). It's a backstop against a model that
systematically ends every reply in a question, which would otherwise pause every block for the rest of
the lesson: once the streak hits `OPEN_QUESTION_GATE_CAP = 5`, the client tells the server to disable the
open-question gate for that request (`openQuestionGateEnabled: gatedStreak < 5`), and the server honors
it as one AND-condition in the gate check. It only interacts with the open-question gate — no
relationship to `requiresResponse` or the teach-back turn gate — and it's plain `useState`, so it resets
on page reload (a session-scoped backstop, not persisted).

**Does the target palette need a fourth gate?** No, for everything except one real candidate:

- Course intro message, `onboarding` (config already exists, `program-version-config.schema.ts:126-140`),
  `diagnostic_quiz` (maps onto the existing baseline-quiz submit path, `service.ts:778-836`, structurally
  identical grading to `quiz_checkpoint`), and `assessment`/`web_quiz` mode all fit the existing three
  gates cleanly — none needs a new primitive, just plumbing (e.g. folding the diagnostic's current
  pre-lesson full-page redirect into the thread).
- **`assessment`/`reteach_gate` mode is the one plausible gap.** The chat/MI-surface prompt router
  already has a *separate*, richer gate concept — `AssessmentSession` + `passedAt !== null` — with
  variable-length back-and-forth bounded by `minTurns`/`maxTurns`, a real graded pass/fail verdict, and
  a branching on-exhaustion policy (`onMaxTurnsWithoutPass`: reteach / flag-mentor / accept-with-score).
  None of the player's three gates express any of that: `requiresResponse` doesn't grade, teach-back's
  gate is a fixed 2-turn always-succeeds, and the open-question gate always eventually advances on one
  click. This machinery already exists (built for the chat surface) but is **not wired into
  `completeBlock`/`gradePlayerBlock`/`LessonPlayer.tsx` at all** today.
  **Framing for B.1:** this is not "invent a fourth player-gate primitive," it's "recognize the
  existing chat-surface `AssessmentSession`/`passedAt` gate as a fourth *completion source* the
  player's block-progress model can consult" — exactly the same shape as how `teach_back` today
  already bypasses `completeBlock` in favor of `recordPlayerTutorSuccess`. Flag this explicitly before
  B.1 starts designing the `assessment` block.

---

## 2. PBJ gated-reteach session lifecycle

**Full lifecycle, file by file** (all chat-surface, all `socioId`-keyed on the read side):

- **Gate detection**: `db-lesson-service.ts:41-46,136-152` builds `LessonGate[]` from `teach_back`
  blocks with `delivery === "gated_session"`. `router.ts:81-152` `checkGatePosition()` is the sole
  caller-facing gate check (invoked from `determineMode`, `router.ts:440`), gated on
  `canDeliverGatedAssessment(channelType)` — **false for any channel but `web`**
  (`channelSupport.ts:59-62`); non-web channels skip the gate entirely (`router.ts:96-102`).
- **The shared seam**: `gateSessions.ts:35-52` `createGateSessionLoader(socioId)` →
  `repo.getAssessmentSessionsForSocioLesson(socioId, lessonKey, blockId)`
  (`prismaRepo.ts:1056-1065`, **`socioId`-only query, no `enrollmentId` parameter at all**). Both
  `router.checkGatePosition` and `stance.hasPassedCurrentLessonGates`/`readGateEvidence`
  (`stance.ts:140-195`) go through this one function — it is the single choke point for "is this gate
  passed."
- **Session creation**: `messaging/handler.ts:560-630` calls `createAssessmentSession` with
  `enrollmentId: playerContext?.enrollmentId` — present only when a player context exists.
  `createAssessmentSession.ts:288` checks for an open session via `getAssessmentSessionsForSocio`
  (**`socioId`-only**), then filters in memory by `enrollmentId` only if one was supplied (lines
  295-297) — an ad hoc branch-per-call-site pattern, not a shared enrollment-aware query.
  `tenantPrismaRepo.ts:2175-2186` computes `attemptNumber` via a **socioId-only** query (does not
  filter by `enrollmentId`) even though the row it writes does carry `enrollmentId`.
  `/api/assessment/start/route.ts:36-166` — the standalone retake entry point — has no course/enrollment
  signal at all and falls back fully to `socio.curriculumCollectionKey`.
- **Sub-thread**: sub-session turns are `Message` rows scoped by `assessmentSessionId` (not
  `socioId`+`collectionKey`) — `getAssessmentMessages`/`addAssessmentMessage`
  (`tenantPrismaRepo.ts:2283-2292`). The main thread explicitly excludes them
  (`where: { socioId, assessmentSessionId: null }`), confirming the two threads are partitioned on the
  same `Message` table by this one column. UI: `app/chat/assessment/[sessionId]/page.tsx`.
- **Scoring / turns**: `/api/assessment/[sessionId]/message/route.ts:30-190` — 403s on
  `assessmentSession.socioId !== socioId` (line 69), runs `runAssessmentTurn.ts` (pure, no DB I/O of
  its own), writes back via `sessionId`-keyed updates.
- **Completion / return to main thread**: `/api/assessment/[sessionId]/complete/route.ts` — same
  `socioId` 403 check (line 72); resolves `enrollmentId` via `getParticipantBySocioId` but — note —
  this actually passes **`ParticipantProfile.id`**, not `Enrollment.id`, under the parameter name
  `enrollmentId` (line 120). `completeAssessment.ts:212-348` writes `MetricObservation`s keyed by
  `enrollmentId` and gates alert evaluation on `if (enrollmentId)` (lines 254-282) — the completion-time
  *write* side is already enrollment-aware. On `return_for_reteach`, calls
  `socioRepo.resetMessageIndex(socioId)` (line 301) — the legacy chat lesson-pointer, no enrollment
  equivalent exists. "Return to main thread" has no explicit event: the router's next-turn
  `checkGatePosition` call simply resolves differently once the session is `completed`.

**socioId vs. enrollmentId — exact split**: every read that decides gate state or authorization
(`getAssessmentSessionsForSocioLesson`, `getAssessmentSessionsForSocio`, the two ownership 403 checks,
attempt-number computation) is **100% `socioId`-keyed today**. Only the completion-time writes
(`MetricObservation`, alerts) are already `enrollmentId`-keyed.

**Which surface does this run on?** Chat-surface only, and specifically its web-channel variant — never
reachable from the player surface. `PBJ` (`pbj-basics`) is confirmed as an explicitly-labeled toy/schema-
test package (`journey-package/examples/pbj-journey-package.ts:1-11`), not production content; its
`ProgramVersion.metadata` is `null`, so `resolveDelivery()` falls back to `LEGACY_DELIVERY = {surface:
"chat", ...}` — **PBJ itself resolves as a chat-surface course, not a player-surface one.**
`router.ts`, `stance.ts`, `gateSessions.ts`, `gateRecency.ts`, `chat/progress.ts`,
`messaging/handler.ts` are all chat-surface code; `getGateAtPosition`/`hasGates` in `db-lesson-service.ts`
have zero non-test callers outside `router.ts` — there is no player-surface consumer of gates today.

**Can B build against `enrollmentId`-only? No — dual-path is required, but narrower than the whole
lifecycle.** The *write* side (`createAssessmentSession`) is already enrollment-capable, just not
enrollment-*exclusive* (falls back to full socioId history when `enrollmentId` is absent). The blocker
is the **read** side: `getAssessmentSessionsForSocioLesson` and `getAssessmentSessionsForSocio` take no
`enrollmentId` parameter at all, and the two ownership 403 checks compare `socioId` with no enrollment
equivalent. Any B-phase "does this enrollment have a passing reteach-gate session" query must go through
these socioId-keyed functions until A.7 migrates them — i.e., it inherits their current (non-enrollment-
scoped) semantics, where a completed session from *any* enrollment counts as passed.

**Collision risk with future A.7 migration — there is a clean seam, if B uses it.** Exactly one function,
`repo.getAssessmentSessionsForSocioLesson`, is the choke point (everything routes through
`gateSessions.ts`'s loader). If A.7 later migrates that one function's *internals* to be enrollment-aware
(same signature, or accepting `enrollmentId` with internal legacy fallback), every existing caller
(`router.ts`, `stance.ts`, `gateRecency.ts`) is covered automatically, no call-site changes needed.
**Recommendation for B.1**: write new reteach-gate queries through this same repo method (or a thin new
one following the identical "accept enrollmentId, resolve legacy fallback internally" pattern) rather
than branching `enrollmentId ? ... : ...` at each new call site. `createAssessmentSession.ts:295-297`'s
own ad hoc in-memory filter is exactly the anti-pattern to avoid replicating — if B repeats that shape at
new call sites, A.7 will not cover them automatically and both will collide later.

---

## 3. B.0 addition — enrollmentId vs. legacy, and A.7 rework

Directly answered by §2: the reteach-gate lifecycle runs on the **chat surface only** (its web-channel
variant), not the player surface. Building the new `assessment` block's `reteach_gate` mode means new
code, not code shared with today's PBJ machinery in a call-compatible way — but it should be modeled on
the same session/scoring/sub-thread pattern. It **must remain dual-path** (enrollmentId when present via
the already-enrollment-capable write path, socioId+collectionKey fallback on the read/ownership side)
until A.7 closes, because the read/ownership functions have no enrollmentId parameter today. Nothing in
the current reteach-gate code needs to change *today* for B to build against it — but per §2's seam
finding, B's new code should route through the same one choke-point function (or its equivalent) rather
than invent parallel branch-per-call-site logic, so A.7's later migration doesn't have to chase B's call
sites individually.

---

## 4. Block-type registry and `content/block-ids.json`

**Registry, confirmed current** (declare → validate → render → grade), all six existing types:

| Type | Declared | Block-level validation | Rendered | Graded |
|---|---|---|---|---|
| `teach` | schema.ts:236-276 | none | `LessonPlayer.tsx:677` | `service.ts:539` — always `complete:true` |
| `teach_back` | schema.ts:287-295 | `dimensionKey` must exist in `trackedDimensions`; `gated_session` requires `config.assessment` present | `LessonPlayer.tsx:691` | **not** via `gradePlayerBlock` — throws `PlayerError(409,"tutor_required")` (`service.ts:587`); graded via `recordPlayerTutorSuccess`/tutor pipeline |
| `quiz_checkpoint` | schema.ts:298-303 | per-question `dimensionKey` ref check; graded questions need `explanation` (1.1+) | `LessonPlayer.tsx:678-684` | `service.ts:540-580`, retry-capped (`QUIZ_ATTEMPT_LIMIT`) |
| `drag_order` | schema.ts:306-322 | own superRefine: `correctOrder` must be a full permutation | `LessonPlayer.tsx:685` (dnd-kit) | `service.ts:581-585`, exact-order match |
| `media` | schema.ts:329-335 | none | `LessonPlayer.tsx:686` (`MediaBlock`) — **now rendered** (Track 0 fix confirmed live) | fallback path, `service.ts:588` — `complete:true, score:1` |
| `resource` | schema.ts:338-362 (weblink/textbook/mcp discriminated union) | none | `LessonPlayer.tsx:687` (`ResourceBlock`) — **now rendered**, weblink gets a real anchor | same fallback as `media` |

`handoff` — confirmed unchanged: on `blockBase` (schema.ts:212), spread into all six variants, rendered
at `LessonPlayer.tsx:510-511` as a `"prompt"` thread item whenever its block is current. Still not a gap.

`resource`/`media` — confirmed post-Phase-A that both now render (`MediaBlock`/`ResourceBlock` in
`LessonPlayer.tsx`) with **read-and-continue, no gate** semantics (`advance({acknowledged:true})`,
identical to a plain `teach` block's grading fallback). This matches the convention the new block types
should follow where a block is informational rather than a checkpoint.

**`content/block-ids.json`**: confirmed still used only by `scripts/convert-learnmachine-package.ts` and
its test — not read by the importer or runtime app. Its four-step match order (explicit reuse → exact
content-hash → discriminator+fingerprint overlap ≥0.5 → mint) is unchanged, and untouched entries stay
`retired: true` (append-only by construction). **A brand-new, hand-authored block type (Sam's path —
authoring `JourneyPackage` JSON directly) never touches this file at all.** It only becomes relevant if
someone later teaches the Learn Machine *source* converter to emit the new block type, which is a
separate, unrelated task from adding the block type to the schema/importer/player.

---

## 5. Target palette — gap-check against the real schema

**Confirmed Phase A did not touch the JourneyPackage schema** except one 9-line addition (`listed`, see
item 9 below) — verified directly against the Phase A commit diff. All findings below are current as of
today, not stale audit output.

**9. Course intro message** — confirmed still no field. **Precedent for placement, now shipped**: Phase
A added `metadata.listed: z.boolean().optional()` (schema.ts:754-762) exactly the way the earlier
investigation proposed — a sibling on `metadataSchema`, stored verbatim in `ProgramVersion.metadata`
JSON (not a new `ContentCollection` column), read back via `resolveListed()`
(`journey-package/listed.ts:14-18`), structurally a twin of the pre-existing `resolveDelivery()` pattern.
**The intro message should follow the identical shape**: a new `introMessage: localizedStringSchema
.optional()` sibling near `listed`, same JSON column, a third resolver file (`resolveIntroMessage`)
alongside `delivery.ts` and `listed.ts`. This is now a proven pattern with one shipped precedent, not a
proposal.

**10. `onboarding` block** — confirmed `config.onboarding` is canonical
(`mode: "survey"|"baseline_quiz"|"skip"`, `steps:[{id,promptKey,field}]`, `diagnostic?`), schema.ts:582-
590, unchanged since the onboarding-shape audit. `metadata.onboarding` remains dead (validated, stored,
never read back). Missing to support the full target design: name/background/experience questions and
the project-framing segment (D8) have no dedicated fields today — `steps[]` is generic
(`id`/`promptKey`/`field`), so these would be authored as additional steps rather than needing new schema
surface, provided the runtime script-runner (not yet built — today `config.onboarding` only drives the
player's diagnostic gate, per the onboarding audit, not a name-capture conversation) is built to execute
an arbitrary step list. Writing answers to learner context has no existing wiring from `config.onboarding`
either — `SocioContext` is populated today only by the AI's own fire-and-forget extractor
(`contextExtractor.ts`), not by onboarding step answers directly.

**11. `diagnostic_quiz`** — confirmed: this **is** today's mechanism, just under a different name. AIESS
already has `config.onboarding.mode === "baseline_quiz"` with a populated `diagnostic`
(`baselineDiagnosticSchema`: `id, title, description?, threshold, questions: quizQuestionSchema[]`,
schema.ts:472-478) in both its authored package files. It is currently implemented as a **pre-lesson
full-page redirect** (`LessonPlayer.tsx:273`, `getLessonDto` throw at `service.ts:452-456`), not an
in-thread block — folding it into the single-thread design is a plumbing/UI change (render it as a
gate card + button like `onboarding`, per §1's gate analysis), not a new schema concept and not a new
block type distinct from `onboarding`'s diagnostic sub-mode.

**12. `assessment`/`reteach_gate` mode** — confirmed exact current field names, all inside
`config.assessment` (schema.ts:603-617) and `passingSchema` (schema.ts:219-225): `passing.threshold`
(required, no default), `passing.minTurns` (default 2), `passing.maxTurns` (default 12) — confirmed these
are the exact names, no `turnLimit` alias exists — `blocking` (default true), `allowRetake` (default
true). **Smallest schema diff**: add `mode: z.enum(["reteach_gate"]).default("reteach_gate").optional()`
as a new sibling key inside the existing `config.assessment` object — additive, not a
`z.discriminatedUnion` restructure. This is non-breaking: existing imported packages with
`config.assessment` populated but no `mode` parse unchanged (zod fills the default), no migration needed
for existing rows. A true discriminated-union restructure would be a breaking change requiring either a
schema-version-gated migration or a permissive union arm — avoid it.

**13. `assessment`/`web_quiz` mode** — confirmed genuinely net-new (zero occurrences of `web_quiz`
anywhere). Full current `quizQuestionSchema` (schema.ts:128-189):
```ts
{
  id: key,
  prompt: z.string().min(1),
  format: z.enum(["multiple_choice", "short_answer"]),
  options: z.array(z.string()).optional(),
  answerKey: z.union([z.string(), z.array(z.string())]).optional(),
  explanation: z.string().min(1).optional(),
  dimensionKey: key.optional(),
  graded: z.boolean().default(true),
}
```
plus a `.refine` (multiple_choice needs ≥2 options) and a format-scoped `.superRefine` (option uniqueness
after normalization; `graded` gates whether `answerKey` is required vs. forbidden). New question types
(`fill_blank`, `matching`) should extend this the same way `multiple_choice` does — new `format` enum
values with their own `superRefine` arms — rather than restructuring into a discriminated union, to avoid
breaking already-imported packages.

**14. `showScoreToLearner`** — confirmed zero occurrences repo-wide. The closest existing field,
`studentVisibleDimensionKeys` (schema.ts:607), is **actively read** — it's a dimension-key allowlist
(default: just the passing dimension) threaded through `createAssessmentSession.ts`,
`runAssessmentTurn.ts`, and `completeAssessment.ts` to decide which dimension *scores* surface mid-session
and at completion, consumed by `AssessmentGateCard.tsx` and the assessment session page. This is a finer-
grained control (which dimensions) than a single boolean show/hide-the-score toggle — `showScoreToLearner`
would be genuinely new, coarser surface, not a rename.

---

## 6. Inline vs. separate-page quiz — usage data

Live DB query (via the same `PrismaNeon` diagnostic-script pattern as Phase A) plus a static
`content/*.package.json` cross-check (zero `quiz_checkpoint` hits in the two authored AIESS files — all
live usage traces to TS example packages imported directly).

**Static block presence** (blocks authored, regardless of whether ever played):

| Org / Collection | quiz_checkpoint blocks | Lessons | Status |
|---|---|---|---|
| ai-essentials-verification / ai-essentials | 38 | 17 | published (v1.1.2) |
| mentors-international / skills-tool-calls | 4 | 1 | published (v2026.5) |
| mentors-international / pbj-basics | 1 | 1 | published (v0.1.0) |
| mentors-international / mi-colombia-curriculum (the real flagship cohort) | 0 | — | published (v1.1.0) |

**Real learner-attempt data (`BlockProgress`), the number that actually matters for this decision**:

- `ai-essentials-verification` — the org with by far the largest static footprint (38 blocks) — has
  **zero** `Enrollment` rows and **zero** `BlockProgress` rows. It's a verification-only tenant; no real
  learner has ever hit these blocks.
- `pbj-basics` — 10 enrollments exist but **zero** `BlockProgress` against its one quiz block.
- `skills-tool-calls` is the **only course with real, played usage**: 23 `BlockProgress` rows across 4
  quiz blocks, 4-7 distinct learners per block, 100% completed (`stc-02-skills-poll` 7/7,
  `stc-03-tool-calls-poll` 7/7, `stc-08-questions-skill` 5/5, `stc-10-questions-tool-calls` 4/4).
- The flagship MI Colombia curriculum doesn't use `quiz_checkpoint` at all.

**Bottom line for Michael's confirmation**: real-world usage is thin and concentrated in one small
course (~5-7 learners per block, all short multiple-choice, all completed inline without incident). This
is weak evidence either way — it doesn't demonstrate a need for a separate full-page quiz UI (nothing has
broken at this volume), but it also doesn't validate that inline scales past small/simple quizzes, since
nothing larger has ever actually been played. Flag this thinness explicitly when the decision is made,
rather than treating either usage count as decisive.

---

## 7. Right-hand dashboard composition

Composed by `apps/web/src/components/player/PlayerDashboard.tsx` (104 lines), rendered from
`LessonPlayer.tsx:743-749` and given a fully server-precomputed `LessonDashboard` prop — no client-side
fetching or derivation (explicit in the component's own docblock: "if something here needs computing, it
belongs in `lib/player/dashboard.ts`"). Server assembly: `player/service.ts`'s `getLessonDashboard()`
(lines 340-397) → `buildLessonDashboard()` (`player/dashboard.ts:135-163`) → included in the lesson DTO
(`getLessonDto()`, `service.ts:466-471`). `dashboard` is `null` whenever `config.projectSelection` isn't
configured — MI Colombia and PBJ both currently render no right-rail at all.

**Composition shape is fixed, not extensible-by-config**: three literal JSX `<section>` blocks inside one
`<aside>` (`PlayerDashboard.tsx:34-101`) — project card, progress/milestones card, and a conditionally-
rendered help card. No switch/map over a panel-type list.

**Adding an attempts/scores panel**: no `QuizAttempt` model exists in `prisma/schema.prisma` today (zero
grep hits) — quiz results currently live only in enrollment-scoped `BlockProgress` rows
(`blockId`/`score`/`response`/`completedAt`), not a dedicated per-attempt table. Adding a fourth
`<section>` to `PlayerDashboard.tsx` is a trivial additive JSX block, same pattern as the existing help
card — **but it is not zero-plumbing**: it requires threading new data through three files across the
server→client boundary (`dashboard.ts`'s type + builder, `service.ts`'s DTO assembly,
`PlayerDashboard.tsx`'s render), not just a component-local change. Whether a new `QuizAttempt` table is
needed depends on whether per-attempt history is required (`BlockProgress`'s latest-score-only shape is
sufficient if not) — that's a design decision for B.3, not a blocker for B.0.

---

## What changes about the plan

1. **B.0's "map remaining v4.1 single-thread items" is smaller than the plan implies.** Three of the four
   named UX issues (duplicate inputs, next-block-while-open, teach-block prompt duplication) are already
   fixed, apparently by Phase A-adjacent work on `LessonPlayer.tsx`/`player/service.ts` that wasn't
   explicitly scoped as UX-debt closure. Only `comma_chained_enumeration`'s generic-fallback escalation
   remains open. B.4 ("UX debt closure") should be re-scoped to just that one item plus whatever B.1-B.3
   introduce, not treated as a four-item backlog.

2. **The PBJ gated-reteach lifecycle cannot be "reused" for the player's `assessment` block in the sense
   of shared code paths — it must be reimplemented against the same pattern, dual-path, on the read side.**
   The plan's framing ("reuse assessment-session machinery") is directionally right (the session/sub-
   thread/scoring shape is sound to copy) but the specific functions (`getAssessmentSessionsForSocioLesson`,
   `getAssessmentSessionsForSocio`, the ownership 403 checks) are chat-surface-only, socioId-keyed, and have
   no enrollmentId parameter at all today — not "already enrollmentId-capable with a fallback," which is
   what B.0's addition in v1.2 seemed to hope for. New B code needs to write against these functions
   as they exist (accepting the same non-enrollment-scoped gate semantics), and should route through the
   existing single choke point (`getAssessmentSessionsForSocioLesson`) rather than inventing its own
   parallel enrollmentId-branching — the `createAssessmentSession.ts:295-297` in-memory filter is a
   cautionary example of the branch-per-call-site anti-pattern already present in the codebase, not a
   template to copy.

3. **PBJ itself is not a useful reference course for "reuse on the player surface."** It resolves as a
   chat-surface course today (`resolveDelivery()` falls back to `LEGACY_DELIVERY`, since its
   `ProgramVersion.metadata` is null), and it's an explicitly-labeled toy/schema-test package with no real
   enrollments hitting its one quiz block. If B.1 wants a real reference for reteach-gate behavior under
   load, `skills-tool-calls` (the only course with actual played `quiz_checkpoint` attempts) is a better
   analog for volume, though it doesn't exercise the gated-reteach mechanism at all — nothing today
   exercises gated-reteach with real learner volume.

4. **`assessment`/`reteach_gate` is the one place B.0's "don't add a fourth gate without a proven gap"
   instruction has a live candidate.** The existing three player gates (`requiresResponse`, teach-back
   turn-count, open-question) cannot express a real graded pass/fail with branching on-exhaustion policy.
   The fix is not a new *primitive* but recognizing the chat-surface's existing `AssessmentSession`/
   `passedAt` machinery as a fourth completion source the player's block-progress model can consult —
   worth stating explicitly in B.1's design rather than leaving it implicit.

5. **The inline-vs-separate-page quiz decision (still open, needs Michael's confirmation) has thin real
   usage data behind it either way** — one small course, ~5-7 learners per block, all short and all
   completed without incident. This doesn't validate scaling inline to "long mixed-format assessments"
   (drag-drop/fill-blank/matching) as the plan's proposed rule assumes, since nothing that complex has
   ever been played. Recommend treating the proposed rule (short=inline, long-mixed-format=separate page)
   as a design default rather than something the data confirms.

6. **Course intro message placement is no longer a proposal — it's a proven pattern with one shipped
   precedent.** `metadata.listed` + `resolveListed()` (added in Phase A) is structurally identical to what
   an `introMessage` field needs: sibling on `metadataSchema`, stored in `ProgramVersion.metadata` JSON,
   read back via an analogous resolver. B.1 can copy this file-for-file (a third `resolveX.ts` alongside
   `delivery.ts` and `listed.ts`) rather than re-deriving the pattern from scratch.

7. **`media`/`resource` block rendering is confirmed shipped** (Track 0, as the project's own notes
   already believed) — `LessonPlayer.tsx` now has real cases for both, with read-and-continue/no-gate
   semantics. New block types that are purely informational (course intro, parts of `onboarding`) should
   follow this exact convention rather than introducing a new completion shape.

Do not begin B.1.
