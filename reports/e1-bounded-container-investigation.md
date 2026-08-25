# Stage E.1 — Bounded Container Investigation

Date: 2026-08-25
Scope: investigation and design only, per instructions. No application code, schema, or
migration changes. The only file written is this report.

References: `reports/reteach-gate-write-path-investigation.md` (reuse-with-adapter, approved),
`reports/reteach-gate-write-path-design.md` (Stage 0 design, approved — trigger = lazy
find-or-create, UI reuse = extend `teach_back`'s existing turn UI, completion = skip
`resetMessageIndex`/`runGateResolvedFollowUp` on the player surface). Stage 1 Part 1 (the
find-or-create trigger, `resolveOrCreateReteachGateSession` in `player/service.ts` + a new
route) shipped in this session and is not touched here. Stage 1 Part 2 (the `/complete`
score-gating fix) was investigated, found to need more plumbing than a route-only fix, and
stopped — this report resolves why, at wider scope, before any of it is rebuilt.

Scope change from the prior design: the container is no longer `reteach_gate`-specific. It
must carry at least two payload types today — AI-conversation (`reteach_gate`) and
rich-question quiz (`web_quiz`) — plus whatever comes later. This report investigates what a
single container/multiple-payload design requires.

---

## 1. Surface signal — build once, correctly

**`resolveDelivery()`, full body** (`journey-package/delivery.ts:16-23`):

```ts
export function resolveDelivery(metadata: unknown): DeliveryConfig {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return LEGACY_DELIVERY;
  }
  const candidate = (metadata as { delivery?: unknown }).delivery;
  const result = deliveryConfigSchema.safeParse(candidate);
  return result.success ? result.data : LEGACY_DELIVERY;
}
```

It takes one input — `ProgramVersion.metadata` (the raw JSON column) — and returns
`{surface: "chat" | "player", supportedChannels}`, falling back to `LEGACY_DELIVERY`
(`surface: "chat"`) on anything unparseable or absent. **It needs a `ProgramVersion` row in
scope, not a `collectionKey` string** — `metadata` is a column on that row.

**Availability at each of the three sites, checked directly:**

- **`/api/assessment/[sessionId]/complete/route.ts`** — does not load a `ProgramVersion`
  anywhere in its current body (confirmed by reading the full route: it loads
  `assessmentSession`, calls `getSessionConfig` on the session's own `configSnapshot`, and
  that's the only "package-shaped" data it touches). Calling `resolveDelivery()` here today
  would require a **new** `ProgramVersion` lookup — the route has `assessmentSession.lessonKey`
  but, per the schema's own doc comment (`schema.prisma:934-940`), `AssessmentSession` has "no
  collectionKey column at all — course identity had to be derived via lessonKey ->
  ContentLesson.collection.slug." Deriving `collectionKey` from `lessonKey` and then loading the
  `ProgramVersion` is exactly the derivation `resolveProgramConfig`
  (`createAssessmentSession.ts:110-137`) already performs once, at session-creation time — this
  route would either repeat that derivation from scratch or read a value baked in earlier.
- **`resetMessageIndex`'s caller** (`completeAssessment.ts`'s `return_for_reteach` branch,
  lines 294-303) — `completeAssessment`'s params (`CompleteAssessmentParams`, lines 80-93) are
  `ctx, repo, sessionId, socioId, finalState, outcome, config, enrollmentId, channel` — no
  `ProgramVersion`/`metadata`/`collectionKey` anywhere. Same gap as above: nothing in scope to
  resolve delivery from today.
- **`runGateResolvedFollowUp`'s call site** (`complete/route.ts:158-165`) — same route as above,
  same gap; `runGateResolvedFollowUp`'s own params (`gateFollowUp.ts:71-77`,
  `{socioId, sessionId, passed, resolvedAt}`) carry nothing course-shaped either.

**Conclusion: `resolveDelivery()` is not directly callable at any of the three sites today —
every one of them would need the resolved `ProgramVersion.metadata` (or the `surface` value
already derived from it) threaded in.** The cheapest place to do that derivation is once, at
session-creation time, inside `createAssessmentSession`'s existing `resolveProgramConfig` step
— it already loads the `ProgramVersion` row (`createAssessmentSession.ts:125`,
`repo.getActiveProgramVersionByCollection`) and discards everything but `.config`. Reading
`.metadata` too and calling `resolveDelivery()` on it there costs nothing extra by way of I/O.

There is one repository-projection change hidden behind that sentence and it should be explicit
before BUILD: Prisma's `ProgramVersion` model has `metadata Json?` (`schema.prisma:495-501`), and
`findFirst` already retrieves the complete row, but the neutral `ProgramVersion` type
(`tenantRepo.types.ts:35-50`) and `toProgramVersion` mapper
(`tenantPrismaRepo.ts:132-142`) currently omit `metadata`. The approved implementation therefore
needs to expose `metadata` through that existing repo result (type + mapper, plus affected test
fixtures) before `resolveProgramConfig` can pass it to `resolveDelivery`. This is still the same
single lookup and the same choke point; it is not a reason to add a second ProgramVersion query.

**What "enrollmentId is overloaded" means, concretely — two different values share the name:**

1. **`AssessmentSession.enrollmentId`** (`schema.prisma:955-958`) — a real, nullable FK to
   `Enrollment.id`, set once at creation by `createAssessmentSession` and never rewritten.
2. **The `enrollmentId` parameter threaded through `completeAssessment`** — `complete/route.ts:
   108-120` computes it fresh at *completion* time via
   `tenantPrismaRepo.getParticipantBySocioId(ctx, socioId)`, then passes `participantProfile?.id`
   under the parameter name `enrollmentId`. `ParticipantProfile.id` (`schema.prisma:651-666`) is
   a **different primary key from a different table** — not `Enrollment.id`. Confirmed by
   reading `MetricObservation`'s schema (`schema.prisma:843-863`): its own `enrollmentId` column
   has a real `Enrollment @relation(fields: [enrollmentId], references: [id])` — the FK target
   is `Enrollment.id` — yet `completeAssessment.ts:170`'s `writeObservations` writes this
   `ParticipantProfile.id`-typed value straight into that column under the same field name. In
   practice this appears to resolve to `null` for most/all current socios (consistent with
   `metric_observations` showing `enrollmentId: NULL` on every row per prior session findings on
   this project — `ParticipantProfile` rows are largely unpopulated today), which is why this
   mismatch hasn't produced a visible FK-violation error yet. It is a latent bug independent of
   this investigation, noted here only because it is direct evidence for the point: **two
   structurally unrelated ID spaces are both called `enrollmentId` in the assessment code path**,
   and neither is safe to read as "is this a player-surface session" — one is a stored,
   creation-time, nullable `Enrollment.id`; the other is a freshly recomputed
   `ParticipantProfile.id` that happens to share a variable name.

There is also a direct surface-inference counterexample in the creation path: the chat-surface
gate handler calls `createAssessmentSession` with `enrollmentId: playerContext?.enrollmentId`
(`messaging/handler.ts:573-584`), so that value is `undefined` for chat. The tenant repo does not
necessarily persist `null`; when the caller omits it, `createAssessmentSession` resolves the
participant's active/recent `Enrollment.id` from the socio's current curriculum and writes that
ID (`tenantPrismaRepo.ts:2189-2235`). Therefore a **chat-surface** `AssessmentSession` can have a
non-null, perfectly valid `enrollmentId`. `if (enrollmentId) surface = "player"` would
misclassify that concrete chat case, independently of the separate naming/FK mismatch above.

**Recommended choke point**: resolve `surface` (via `resolveDelivery(programVersion.metadata)`)
once, inside `createAssessmentSession`'s existing `resolveProgramConfig` step, and bake it into
`SessionConfigSnapshot` as a new field (e.g. `surface: "chat" | "player"`). Every later read —
`/complete/route.ts`, `completeAssessment.ts`'s `return_for_reteach` branch, and
`runGateResolvedFollowUp`'s call site — already loads `configSnapshot` via `getSessionConfig`
(confirmed: `complete/route.ts:82`, `message/route.ts:86`) or could receive it as one extra
field threaded through `CompleteAssessmentParams`. This mirrors exactly how `showScoreToLearner`
should also be baked in (§3) — one snapshot-time computation, many read-only consumers — rather
than three independent re-derivations or three independent branches on a fact none of them can
safely infer from data already in hand.

---

## 2. Container generalization

**`/chat/assessment/[sessionId]`'s full shape** (`app/chat/assessment/[sessionId]/page.tsx`,
461 lines, read in full):

- **Route**: a standalone full-page client route, not a panel inside another page.
- **Entry**: `chat/page.tsx` renders a gate card when `checkGatePosition` reports
  `GATED_ASSESSMENT` mode (per the earlier investigation); the learner navigates to this route,
  landing with a `sessionId` route param.
- **Load** (`useEffect`, lines 98-151): fetches `/api/auth/me` for language, then
  `GET /api/assessment/[sessionId]` for `{session, messages, config}`. If `session.status ===
  'pending'`, it calls `startSession()` (`POST /api/assessment/start`) to kick off the opening
  turn — this is the standalone-retake path's own trigger, distinct from the player's find-or-
  create trigger already shipped in Stage 1 Part 1.
- **State held**: `messages[]`, `status`, `visibleKeys` (from `config.studentVisibleDimensionKeys`),
  `scores`, `canComplete`, `passed` — all client-local `useState`, rehydrated once on mount from
  the one GET.
- **Turn loop**: `handleSend()` (lines 186-245) posts to `/api/assessment/[sessionId]/message`,
  appends the reply; on a terminal outcome (`requiresCompletion: true`) sets `canComplete` and
  shows scores/passed state inline, without navigating away.
- **Return path**: `handleComplete()` (lines 249-272) posts to
  `/api/assessment/[sessionId]/complete`, then `router.push('/chat')` — a hard navigation back to
  the main thread. There is no server-side "return" event; the client simply leaves the route.

**What a payload-agnostic player-surface container needs — shared vs. payload-specific:**

**Shared across every payload type** (session/attempt lifecycle, entry, return-and-write):
- Entry: a thread-rendered element (button/card) inside `LessonPlayer.tsx`'s existing thread,
  not a route navigation — per the Stage 0 design report, the player has no separate-page
  precedent to reuse and no reason to invent one; the reteach-gate design already committed to
  "extend the shared thread, don't leave it."
- Attempt/session identity: some `{sessionId, status, attemptNumber}`-shaped state, whatever
  creates it (`resolveOrCreateReteachGateSession`-style find-or-create, per Stage 0 (a)).
- Return-and-write: one completion call that commits a verdict and lets the caller re-render the
  outcome synchronously — `reteach_gate`'s `/complete` response already carries
  `{status, passed, scores, reteachTriggered}` in one payload, no second round-trip needed
  (Stage 0 (c)'s finding, unchanged).
- The container "shell" itself: whatever renders the score/verdict card and the return-to-thread
  transition — this part genuinely doesn't care what produced the verdict.

**Payload-specific** (the seam sits exactly here):
- The turn loop's shape: `reteach_gate` is N free-text turns against an LLM sensing pipeline
  (`runAssessmentTurn`, conversational, unbounded until pass/max-turns); `web_quiz` (per its
  existing `gradePlayerBlock` branch, `service.ts:668-679`) is a single structured
  question/answer submission graded deterministically against `answerKey` — no LLM call, no
  multi-turn state at all today.
- The input UI: free-text `<textarea>` for `reteach_gate` vs. a question-by-question form for
  `web_quiz`.

**Proposed seam (sketch, not implementation)**: a container component/route that owns entry,
attempt-state display, and the completion call, parameterized by a `payloadType` that selects
which inner component renders the turn UI and which submission function it calls — the container
never inspects payload content, only a `{payloadType, sessionOrAttemptId, status}`-shaped
envelope. Concretely, something like:

```
BoundedContainer({ payloadType: "reteach_gate" | "web_quiz", entryContext })
  → resolves-or-creates an attempt (shape TBD per §2's fork below)
  → renders <ReteachGateTurnLoop /> or <WebQuizForm />, keyed on payloadType
  → on terminal outcome, calls one completion function, renders the shared verdict card
  → returns control to the player thread (no navigation away, per the existing convention)
```

**Do `/message` and `/complete` generalize to `web_quiz`, or does it need its own route? — two
options, not resolved here:**

`runAssessmentTurn` (`runAssessmentTurn.ts`) takes `studentText: string` — one turn of free text
(`message/route.ts:111`, `studentText: message`) — and returns a sensed dimension-state update.
A `web_quiz` submission is structurally different: a set of question/answer pairs graded by
deterministic comparison against `answerKey`, not sensed by an LLM. There are two viable route
shapes:

- **Generalize the session endpoints.** Change `/message` into a discriminated submission
  endpoint (for example `{payloadType: "reteach_gate", message}` vs.
  `{payloadType: "web_quiz", answers}`) that delegates to payload-specific handlers, while
  `/complete` commits either handler's terminal verdict. This avoids serializing structured quiz
  answers into prose and can give Option A one uniform session URL family. The tradeoff is that a
  route named `message` stops meaning one conversational turn, and the endpoint must branch on
  payload type even though its inner grading logic remains separated.
- **Give `web_quiz` its own submission route.** Keep `/message` conversational and post the
  answer map to a quiz-specific endpoint; the container normalizes that endpoint's response into
  the same terminal-verdict contract. Under Option A it could still share session creation and
  `/complete`; under Option B it would call the existing player completion/grading path and need
  no assessment-session completion. This keeps transport semantics honest at the cost of more
  route surface.

Neither route shape should be chosen independently of the lifecycle fork below. Option A makes
the generalized session endpoints plausible; Option B strongly aligns with a distinct quiz
submission route. This report records both and deliberately does not decide between them.

**This is the concrete, evidence-based answer to the container/payload seam question — presented
as a two-option fork for Michael's decision, not resolved here:**

Today, `web_quiz` (`quiz_checkpoint` blocks tagged `assessment.mode: "web_quiz"`) has **no
`AssessmentSession` and no snapshot in its loop at all**. `gradePlayerBlock`'s `web_quiz` branch
(`service.ts:668-679`) computes `mergeBlockAssessmentConfig` **fresh, live, per grade call** —
reading `packageAssessment`/`block.assessment` directly off the already-loaded lesson JSON, no
session row, no `configSnapshot`, no creation step. `reteach_gate` has a full session lifecycle:
a created `AssessmentSession` row, a `configSnapshot` computed once and read on every subsequent
turn/completion call, `turnCount`/`liveState` persisted across requests. **This is a real
architectural divergence between the two existing payload types, not just a UI difference:**

- **Option A — give `web_quiz` a session+snapshot too.** Uniform plumbing: every payload type
  gets an `AssessmentSession` row, `buildConfigSnapshot`-shaped config resolution, and the same
  `/message`+`/complete`-style routes (or their generalized equivalents). Cost: `web_quiz` is
  single-submission by nature today — it doesn't need multi-turn state, `turnCount`, or a
  `liveState` sensing map — so this is a real lifecycle addition to something that doesn't
  structurally need one, purely for uniformity's sake.
- **Option B — the container sits above both without forcing convergence.** The container owns
  entry/return/completion-writing (§2's shared layer above), but `reteach_gate` keeps its
  session+snapshot internals and `web_quiz` keeps its live-computed-per-call internals
  underneath it. The container's completion contract would need to be payload-agnostic at the
  boundary (e.g. both payload types ultimately produce a `{passed, score, feedback}`-shaped
  verdict, however they got there) rather than assuming every payload has a `sessionId` to look
  up.

This fork determines the answer to the `/message`+`/complete` reuse question directly: Option A
would make `web_quiz` route through session-backed endpoints structurally similar to
`reteach_gate`'s; Option B would keep `web_quiz` on its current synchronous `gradePlayerBlock`
call entirely, with the container only wrapping its UI, not its data path. **Flagging this as the
one open architectural decision this report cannot resolve — it needs Michael's call before
Stage 1 of the generalized container can be scoped**, distinct from the lean container/payload
seam sketched above (which is agnostic to which option is chosen, but whose concrete shape
narrows once the fork is resolved).

---

## 3. The stopped Part 2 (score-gating), now investigated at full depth

**Confirmed: `showScoreToLearner` is absent from `SessionConfigSnapshot` at creation time.**
`SessionConfigSnapshot` (`createAssessmentSession.ts:55-86`) has no such field; `buildConfigSnapshot`
(lines 209-255) never reads `block.assessment?.showScoreToLearner` or
`programConfig.assessment.showScoreToLearner` — confirmed by reading the full function body.

**This is not a missing-field problem alone — the route reads the wrong mechanism entirely.**
`/complete/route.ts:184-194`'s existing (unconditional) score-inclusion gates on membership in
`configSnapshot.studentVisibleDimensionKeys` — a **visible-by-default** allowlist (defaults to
`[passing.dimensionKey]`, `buildConfigSnapshot` line 237) — not on `showScoreToLearner`, which is
a separate, **hidden-by-default** boolean (`showScoreToLearner: z.boolean().optional().default(false)`,
`journey-package.schema.ts:672` and `program-version-config.schema.ts:193`). These are two
independent gating mechanisms that happen to both exist in the assessment config surface: one
controls *which dimensions* a learner ever sees (already correctly read here), the other
controls *whether any score is shown at all* (never read here). The route isn't missing a check
— it's applying the wrong one for the "hide scores entirely" case `showScoreToLearner: false`
is meant to express. The same gap exists a second and third place, found in this pass, beyond
what the design report scoped:

- **`/message/route.ts:169`** returns `scores: outcome.scores` unconditionally on every terminal
  outcome — `outcome.scores` is already `studentVisibleDimensionKeys`-scoped (via
  `extractStudentVisibleScores`, `runAssessmentTurn.ts:303,327`), but, same as `/complete`, never
  checked against `showScoreToLearner`.
- **`GET /api/assessment/[sessionId]/route.ts:66`** returns `assessmentSession.scores`
  unconditionally — this is `allScores` (**every tracked dimension**, via
  `extractAllScores`/`completeAssessment.ts:113-119,325`), not even scoped to
  `studentVisibleDimensionKeys`. This is the broadest leak of the three, and the one the chat
  UI's read-only view (`app/chat/assessment/[sessionId]/page.tsx:134-136`) renders directly on
  page reload.

**Smallest fix to `buildConfigSnapshot` — reconciling two existing mechanisms, not adding an
isolated field, and routed around a real circular-import constraint:**

`player/service.ts` already has `mergeBlockAssessmentConfig` (lines 568-583), which correctly
merges `showScoreToLearner` (and `allowRetake`) from package config + block override, and is
already the convention `gradePlayerBlock`'s `web_quiz`/`reteach_gate`-read-side branches use.
But `player/service.ts:12` already imports `createAssessmentSession` **from**
`createAssessmentSession.ts` — so `createAssessmentSession.ts` importing `mergeBlockAssessmentConfig`
**back** from `player/service.ts` would be circular. The fix is a shared extraction, not a
naive cross-import: move `mergeBlockAssessmentConfig` (it only depends on
`ProgramVersionConfig["assessment"]` and `BlockAssessmentOverride`, both journey-package schema
types with no dependency on either `player/service.ts` or `createAssessmentSession.ts`) into a
neutral module — e.g. `journey-package/mergeAssessmentConfig.ts`, alongside `delivery.ts` — and
have both `createAssessmentSession.ts`'s `buildConfigSnapshot` and `player/service.ts`'s
`gradePlayerBlock` import it from there. `player/service.ts` would re-export or directly import
the relocated function so its own callers/tests are unaffected.

With that extraction available, `buildConfigSnapshot` would call
`mergeAssessmentConfig(assessment, teachBackBlock.assessment)` and store the resulting
`showScoreToLearner` (and `allowRetake`, see below) on `SessionConfigSnapshot`. The three read
sites (`/complete`, `/message`, `GET`) would then gate their `scores` fields on
`configSnapshot.showScoreToLearner ? scores : null` (or, for `GET`, an equivalent gate on the
stored `AssessmentSession.scores`), matching the convention `resolveReteachGateSignal` and
`gradePlayerBlock`'s `web_quiz` branch already established elsewhere in this codebase.

**Adjacent bug, same root cause, found in this pass — bundle into the same fix, not a separate
future item:** `buildConfigSnapshot` (`createAssessmentSession.ts:246`) also reads
`assessment.allowRetake ?? true` — **package-level only** — and never checks
`teachBackBlock.assessment?.allowRetake` (the block-level override
`blockAssessmentOverrideSchema.allowRetake` defines). This is the identical shape of gap as
`showScoreToLearner`'s absence — the snapshot is built without full block-override awareness —
and the same `mergeAssessmentConfig` extraction fixes both in one pass, since
`mergeBlockAssessmentConfig`'s existing return shape already includes `allowRetake`.

**PBJ — out of scope as a preservation concern, per explicit instruction. Factual effect if this
ships:** PBJ's `pbj-journey-package.ts` does not set `showScoreToLearner` at either the package
or block level, and the schema default is `false`. Once the three read sites gate on
`showScoreToLearner`, PBJ's chat-surface learners — currently shown scores unconditionally at
`/chat/assessment/[sessionId]/page.tsx`'s score card (both mid-session via `/message` and on
completion/reload via `/complete`/`GET`) — would stop seeing them, unless PBJ's package is
updated to set `showScoreToLearner: true` explicitly. Stated as fact; not designed around.

---

## 4. Scope boundary

**Confirmed: `project` is not a schema block type today.** A repository search across the
journey-package schema, player service/components, and player routes found no `blockType:
"project"`, `project_block`, `projectBlock`, or `requiresSubmission` implementation. The existing
`projectSelectionSchema` (`journey-package.schema.ts`) configures the learner-project/dashboard
domain; it is unrelated to a lesson block's rendering or completion lifecycle.

The product decision in this track is nevertheless clear about the **future Stage E.3 `project`
block type**: its brief renders in the main continuous thread, the learner responds through the
normal chat input, and that submission completes the block. `requiresSubmission` and `blocking`
are project configuration, not `assessment.mode`; there is no entry button, bounded route,
`AssessmentSession`, question form, score, or verdict card. Consequently E.1 must neither model
future projects as today's `teach`/`teach_back` blocks nor build provisional support for them.
E.3 owns their schema/render/submit path.

**Confirmed zero dependency on this container.** Current assessment entry points are selected by
`block.assessment?.mode` (`web_quiz` in `service.ts:668`; `reteach_gate` in `service.ts:702`). The
future conversational `project` type will not carry either assessment mode and is therefore
structurally outside the E.1 container. **No scope correction is needed: project blocks are
excluded from this stage entirely.**

---

## Recommended container/payload seam (recommendation only — not a decision)

**Layered, not merged**: a thin container shell (entry-from-thread, attempt-state display,
one completion call, shared verdict rendering) sitting above payload-specific turn UIs and
submission logic, selected by a `payloadType` discriminator — sketched in §2. This part is a
lean recommendation and is independent of the fork below.

**The one item this report cannot resolve and is not attempting to** — §2's Option A vs. Option
B fork (give `web_quiz` a session+snapshot lifecycle to match `reteach_gate`, or keep the two
payload types' internals genuinely divergent underneath a shared shell) needs Michael's decision
before Stage 1 of the generalized container can be scoped concretely, because it determines
whether `web_quiz` submissions ever touch `AssessmentSession`/`/message`+`/complete` at all, or
stay on `gradePlayerBlock`'s current synchronous path with the container merely wrapping its UI.

---

## Proposed stage breakdown (proposed only — not a decision)

1. **Stage 1 — resolve the Option A/B fork** (decision, not code). Everything below assumes an
   answer; the shape of Stage 2 differs materially depending on which is chosen.
2. **Stage 2 — snapshot/config reconciliation.** The `mergeAssessmentConfig` extraction (§3),
   `showScoreToLearner` + `allowRetake` baked into `SessionConfigSnapshot`, the `surface` field
   baked in alongside it (§1's choke-point recommendation) via the same
   `resolveProgramConfig` step. Gate `/complete`, `/message`, and `GET`'s score-returning fields
   on `showScoreToLearner`. This stage is payload-type-agnostic infrastructure regardless of the
   Stage 1 answer, since `reteach_gate` needs it either way.
3. **Stage 3 — container shell.** The shared entry/attempt-display/completion-call/verdict-card
   component, built against `reteach_gate` only first (the payload type that already has a full
   backend lifecycle), reusing the already-shipped find-or-create trigger
   (`resolveOrCreateReteachGateSession`) and `/message`+`/complete` as-is.
4. **Stage 4 — `web_quiz` payload wiring**, shaped entirely by Stage 1's answer: either a new
   session-backed submission path mirroring `reteach_gate`'s (Option A), or a thin
   container-to-`gradePlayerBlock` adapter that never touches `AssessmentSession` (Option B).
5. **Stage 5 — completion-resolution adapter.** `surface`-branched skip of `resetMessageIndex`
   and `runGateResolvedFollowUp` on the player surface (Stage 0 design, unchanged), now reading
   the `surface` field baked into the snapshot in Stage 2 rather than re-deriving it.
6. **Stage 6 — remove the schema gate + update the one test**, per the original design report's
   Stage 4, now applying to whichever payload types the container actually serves.
7. **Stage 7 — verification pass.** Same shape as prior stages in this session: `tsc`/full
   suite/eslint, transform-invariant check, manual run-through.

Do not implement — awaiting approval.
