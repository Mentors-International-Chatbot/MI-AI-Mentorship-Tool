# Reteach-Gate Write-Path Investigation

Date: 2026-08-25
Scope: investigation only, per instructions. No code, schema, or migration changes. The only
file written is this report.

References: `reports/phase-b-investigation.md` §2 (PBJ gated-reteach session lifecycle),
`reports/phase-b-verification.md` §2–4 (B.2's shipped read-side: `resolveReteachGateSignal`,
`mergeBlockAssessmentConfig`, the player-surface schema gate rejecting
`assessment.mode: "reteach_gate"`). Goal: determine what a player-surface reachable path that
creates and scores an `AssessmentSession` would need, so the read side B.2 already built has
something real to read.

---

## 1. The chat-surface write path, in full

**`createAssessmentSession`** (`apps/web/src/lib/ai/assessment/createAssessmentSession.ts:273-332`)
— every field it writes and requires:

- Inputs (`CreateSessionParams`, lines 25-53): `ctx` (`TenantContext`), `repo` (`TenantRepo`),
  `socioId`, `lessonKey`, `blockId`, `channel` (string), and two optional fields —
  `enrollmentId` (present when the caller has one; player-surface gates always would) and
  `collectionKey` (ditto). Both optionals exist specifically because two chat-surface call
  sites — the router's gate trigger and `/api/assessment/start` — structurally lack them
  (lines 33-52's doc comments).
- Step 1 (`resolveProgramConfig`, lines 110-137): resolves `collectionKey` from the override or
  `repo.getSocioCurriculumCollectionKey(socioId)`, then `repo.getActiveProgramVersionByCollection`.
  Throws `AssessmentConfigError` if either is missing.
- Step 2 (`resolveLessonAndBlock`, lines 142-188): `repo.getActiveLessonVersionBySlug`, finds the
  `teach_back` block by id, throws unless `block.delivery === 'gated_session'`.
- Step 3 (`buildConfigSnapshot`, lines 209-255): merges `programConfig.assessment.passing` with
  `block.passingOverride` (`mergePassingConfig`, lines 193-204), resolves
  `studentVisibleDimensionKeys`/`recordedDimensionKeys`/`onMaxTurnsWithoutPass`/`allowRetake`/
  `blocking`/`trackedDimensions`/`aiBehavior`/`teachBackPrompt`/`keyConcepts`/`evaluatesConcepts`/
  `lessonContext` into `SessionConfigSnapshot`. Throws if `programConfig.assessment` is absent.
- Step 4-5 (lines 288-312): loads existing sessions via `repo.getAssessmentSessionsForSocio`
  (**not** the enrollment-scoped Stage 1 twin — see §3), scopes them to `enrollmentId` in memory
  when one was supplied, rejects if an open (non-completed) session already exists for this
  lesson+block, and computes `attemptNumber` from completed-session count.
- Step 6-8 (lines 314-331): builds initial dimension state (`createInitialSessionState`), calls
  `repo.createAssessmentSession` (writes `socioId, lessonKey, blockId, channel, configSnapshot,
  attemptNumber, enrollmentId`), then `repo.updateAssessmentSession` to attach `liveState`.

**Call site** (`apps/web/src/lib/messaging/handler.ts:560-593`), everything upstream:

- Triggered when `aiResponse.mode === InteractionMode.GATED_ASSESSMENT` — set by
  `router.checkGatePosition` (`apps/web/src/lib/ai/prompts/router.ts:81-152`), consumed in
  `apps/web/src/lib/ai/service.ts:647-670`, and only reachable from `determineMode`'s chat-surface
  legacy router.
- `checkGatePosition` (router.ts:81-152) is itself **legacy-lesson-pointer-shaped**: it walks
  `lesson.gates` built from `currentMessageIndex`/`currentLessonNumber` (`RepoSocioProgress`,
  router.ts:70-72) against `gate.afterMessageIndex` — the message-index model that predates the
  player surface entirely (`db-lesson-service.ts`, per phase-b-investigation.md §2). It also
  hard-gates on `canDeliverGatedAssessment(channelType)` (channelSupport.ts:59-62) — false for
  every channel but `"web"`.
- At the call site (`handler.ts:567-584`): `organizationId` resolved via
  `tenantPrismaRepo.resolveOrganizationIdForSocio(socio.id)`; `ctx` built from it;
  `createAssessmentSession` is called with `repo: tenantPrismaRepo`,
  `enrollmentId: playerContext?.enrollmentId`, `collectionKey: playerContext?.collectionKey` —
  **both already optional-chained off a `playerContext` that is normally `undefined` on this
  chat-surface path**, since the router that reaches this branch is chat-only (per
  phase-b-investigation.md §2's "PBJ itself resolves as a chat-surface course" finding). In
  practice this call site always passes `enrollmentId: undefined, collectionKey: undefined`
  today, falling back to the legacy `socio.curriculumCollectionKey` path inside
  `createAssessmentSession`.

**Turn/scoring loop, every file:**

- `POST /api/assessment/[sessionId]/message` (`apps/web/src/app/api/assessment/[sessionId]/message/route.ts:30-190`)
  — auth via `verifySession()` (line 35), a plain cookie-backed web-session check, **not** a
  chat-channel or webhook check (`session.role !== 'socio'` is the only role gate, line 40). Loads
  the session, 403s if `assessmentSession.socioId !== socioId` (line 69), loads conversation
  history via `tenantPrismaRepo.getAssessmentMessages`, extracts `SessionConfigSnapshot` via
  `getSessionConfig` (never re-reads the journey package), stores the student's message, calls
  `runAssessmentTurn`, then persists `turnCount`/`liveState`/(`passedAt` if passed) and the
  assistant's reply via `tenantPrismaRepo.updateAssessmentSession`/`addAssessmentMessage`.
- `runAssessmentTurn` (`apps/web/src/lib/ai/assessment/runAssessmentTurn.ts:254-355`) — pure
  orchestration, no DB I/O of its own (confirmed by phase-b-investigation.md §2 and by direct
  read: no `repo`/`tenantRepo`/Prisma import anywhere in the file). Senses the student's answer
  (`senseAssessmentTurn`) and drafts a probe concurrently, checks `checkPassCondition` (lines
  105-123: `turnCount >= minTurns` AND gating-dimension `level >= threshold` AND
  `confidence >= confidenceFloor`) against the freshly sensed state, returns `'continue'`,
  `'passed'`, or `'max_turns'` with the relevant message/scores.
- `passedAt` is set at `message/route.ts:154` (`if (outcome.status === 'passed')
  sessionUpdate.passedAt = new Date()`) — **before** completion, and explicitly left un-finalized
  (comment lines 139-142: the client must still call `/complete`).
- `POST /api/assessment/[sessionId]/complete` (`apps/web/src/app/api/assessment/[sessionId]/complete/route.ts:33-218`)
  — same `verifySession()`/ownership-403 pattern (lines 38-74). Resolves `outcome` from
  `passedAt`/`reason` (lines 85-93), builds `CompletionConfig`, looks up
  `tenantPrismaRepo.getParticipantBySocioId` for `enrollmentId` (line 110, **note**: this is
  `ParticipantProfile.id`, not `Enrollment.id`, per phase-b-investigation.md §2's same finding),
  calls `completeAssessment`, then persists a completion message and, for non-cancellations,
  calls `runGateResolvedFollowUp` (see below) before returning `{status, message, passed,
  scores?, reteachTriggered?}`.
- `completeAssessment` (`apps/web/src/lib/ai/assessment/completeAssessment.ts:212-348`) — writes
  `MetricObservation`s for `recordedDimensionKeys` (`writeObservations`, lines 151-197), runs
  `evaluateAlerts` when `enrollmentId` is present (lines 270-282), applies the
  `onMaxTurnsPolicy` branch on `max_turns` (lines 286-313 — `flag_mentor` sets `mentorFlagged`;
  `return_for_reteach` calls `socioRepo.resetMessageIndex(socioId)`, the legacy chat
  lesson-pointer, **only if `allowRetake`**; `complete_with_scores` is a no-op), then updates
  `AssessmentSession.status = 'completed'` (+`passedAt` if passed).
- "Return to main thread" has no explicit event, exactly as phase-b-investigation.md §2 found:
  the router's next `checkGatePosition` call simply sees a `completed` session and stops
  returning `GATED_ASSESSMENT`.

**Is this chat-native, or is only the transport chat-specific? Mixed — with one real exception.**

The turn/scoring core (`runAssessmentTurn`, `senseAssessmentTurn`, `checkPassCondition`,
`completeAssessment`'s scoring/observation logic) takes and returns plain strings/objects and has
zero chat-webhook or WhatsApp-message-shape dependency anywhere in its signatures or bodies —
confirmed by reading every line of `runAssessmentTurn.ts` and `completeAssessment.ts` above; grep
for `whatsapp`/`webhook`/`externalId` inside those two files returns zero hits. The
`/api/assessment/[sessionId]/message` and `/complete` routes are themselves **already
channel-agnostic HTTP endpoints** authenticated by `verifySession()`, the same session mechanism
the player surface uses — this is stated directly in the codebase's own comment at
`channelSupport.ts:4-8`: *"A gated teach-back is a web flow end to end: the gate card renders in
`chat/page.tsx`, the learner answers at `/chat/assessment/[sessionId]`, and every turn goes
through `/api/assessment/*`, which authenticates with `verifySession()` — a cookie-backed web
session. There is no route into that pipeline from a WhatsApp webhook."* In other words: the
*chat-native-ness* is not in the scoring pipeline at all — it is in (a) the **trigger**
(`router.checkGatePosition`'s message-index gate model, chat/legacy-only) and (b) the **UI**
(`chat/page.tsx` renders the gate card, `/chat/assessment/[sessionId]/page.tsx` is the only
consumer of the message/complete routes today).

The one place chat-transport coupling reaches into otherwise-agnostic logic:
`completeAssessment.ts:301`'s `socioRepo.resetMessageIndex(socioId)` on `return_for_reteach` is a
write to the **legacy chat lesson-pointer** (`currentMessageIndex`), which has no player-surface
equivalent (BlockProgress tracks completion per-block, not per-message-index) — confirmed as a
gap already, not newly found, by phase-b-investigation.md §2 ("no enrollment equivalent exists").
And `complete/route.ts:160-165`'s `runGateResolvedFollowUp` call (see below) is genuinely
chat-pipeline-coupled.

---

## 2. What the player surface has and doesn't have

**`teach_back` (non-gated) already does turn-by-turn multi-turn exchange in the player's single
thread today, through the exact same chat pipeline the gated path uses — this is the nearest
sibling pattern, confirmed structurally, not just by analogy:**

- `LessonPlayer.tsx` sends learner replies to `POST /api/chat` (`apps/web/src/app/api/chat/route.ts`)
  with a `context: {surface: 'player', intent: 'teach_back', lessonKey, blockId, ...}` body (route
  validation at lines 218-243).
- The route resolves `PlayerAccess` (`resolvePlayerAccess`) and calls
  `preparePlayerContext(access, {...})` (`apps/web/src/lib/player/service.ts:248-295`), which reads
  prior `BlockProgress.state.turnCount` and computes `teachBackTurn: 1 | 2` (line 292) — 1 on the
  first learner answer, 2 once `turnCount >= 1`.
- The route then calls the **same** `handleIncomingMessage` (`messaging/handler.ts`) the chat
  surface uses, passing `playerContext` through. Inside, `handler.ts:529-545` builds a
  player-context-aware instruction (branching on `playerContext.intent === 'teach_back'` and
  `teachBackTurn`) and calls `generateAIResponse`.
- After generation, `recordPlayerTutorSuccess(socioId, context)` (`service.ts:297-...`, called from
  `ai/service.ts` per the earlier grep) upserts `BlockProgress` with `state: {turnCount}`, and only
  marks `completedAt` once `teachBackTurn === 2` — a **fixed 2-turn, always-succeeds** gate, exactly
  as phase-b-investigation.md §1 already found. There is no scoring, no threshold, no branching
  on-exhaustion policy — `recordPlayerTutorSuccess` cannot express what `runAssessmentTurn`/
  `completeAssessment` do.
- The mechanism this proves, though, is real and reusable: **the player already round-trips
  learner text through a stateful, multi-turn AI exchange inside its single thread**, using
  `BlockProgress.state` (not a sub-thread table) to track turn position across separate HTTP
  requests. A reteach-gate write path does not need to invent "how does the player send a second
  message for the same block" — that plumbing exists.

**`completeBlock`/`gradePlayerBlock`'s shape vs. a multi-turn gated exchange:**

- `gradePlayerBlock` (`service.ts:584-707`) is a **synchronous, pure function**: one call, one
  `response: unknown` payload in, one `{complete, score, response, feedback}` verdict out
  (signature at line 584-605). For `teach_back` blocks with `assessment.mode === 'reteach_gate'`
  (lines 701-703) it already takes a **pre-resolved** `reteachGate?: {passed, score}` parameter —
  the caller (`completeBlock`) does the async `AssessmentSession` lookup
  (`resolveReteachGateSignal`, lines 743-766) *before* calling in, keeping `gradePlayerBlock` itself
  I/O-free. This is a single request/response HTTP call per learner submission
  (`completeBlock(access, lessonKey, blockId, response, options)`, line 787), matching
  phase-b-investigation.md §1's characterization exactly.
- This shape is **structurally incompatible with driving a multi-turn gated exchange itself** —
  it has no session id, no conversation history, no per-turn LLM call, and no way to return
  "continue, here's the probe" versus "terminal, here are scores." It is a *read* of gate state
  (`resolveReteachGateSignal` asks "has this enrollment ever passed"), not a *driver* of the
  exchange.
  It does not need to become one: §1 showed the turn loop already exists as
  `/api/assessment/[sessionId]/message` and `/complete`, both already `verifySession()`-gated
  plain HTTP routes. A gated conversation on the player surface needs **its own route(s)** — not a
  restructuring of `completeBlock`/`gradePlayerBlock`, which stays exactly the read-only verdict
  function it is today, consulting whatever session state the new write path produces.

---

## 3. Reuse vs. new — evidence

**Channel-agnostic vs. chat-transport-specific, by line range:**

| Function/file | Channel-agnostic | Chat-transport-specific |
|---|---|---|
| `createAssessmentSession.ts` (all) | 100% — `repo: TenantRepo` parameter already, `channel` is a plain string field it stores, never branches on it | none |
| `runAssessmentTurn.ts` (all) | 100% — plain strings/objects in and out, zero webhook/channel references | none |
| `senseAssessmentTurn.ts` | not read in full this pass, but never imported by anything chat-specific per the file's own module boundary comment (runAssessmentTurn.ts:18) | none found |
| `completeAssessment.ts:99-283` (scoring, observations, alerts) | 100% | none |
| `completeAssessment.ts:294-304` (`return_for_reteach`) | — | `socioRepo.resetMessageIndex(socioId)` — legacy chat lesson-pointer write, meaningless on the player surface |
| `/api/assessment/[sessionId]/message/route.ts` (all) | 100% — `verifySession()` web-session auth, no channel branch | none |
| `/api/assessment/[sessionId]/complete/route.ts:1-147` | 100% | — |
| `/api/assessment/[sessionId]/complete/route.ts:158-166` (`runGateResolvedFollowUp` call) | — | calls into the chat pipeline (see below) |
| `messaging/handler.ts:560-593` (session-creation call site) | the call itself is generic | the **trigger** (`aiResponse.mode === GATED_ASSESSMENT`) is chat-router-only |
| `router.ts checkGatePosition` (81-152) | — | 100% chat-specific: message-index lesson-pointer model, `canDeliverGatedAssessment(channelType)` gate |

**`runGateResolvedFollowUp`** (`apps/web/src/lib/messaging/gateFollowUp.ts:71-108`) — the one
piece of real coupling inside the completion route beyond the lesson-pointer reset. It manufactures
a synthetic learner turn and calls `handleIncomingMessage` (the full chat pipeline, including
`determineMode`/prompt routing) so the AI "speaks first" into the **main chat thread** after a gate
resolves (file docblock, lines 1-25, explains this is deliberately reusing the chat pipeline rather
than inventing new transport). This is chat-thread-shaped: it posts into `Message` rows with
`socioId, assessmentSessionId: null` — the main thread — via `WebChannel`/`WhatsAppChannel`. On the
player surface this would be the wrong delivery target: the player's UI (`LessonPlayer.tsx`) reads
its thread from `getLessonDto`, not from the main chat `Message` table, and has no polling loop
watching for an unprompted assistant turn there. A player-native completion would need either to
skip this call entirely (returning the result synchronously to the caller, which the `/complete`
response body already does via `scores`/`passed`/`reteachTriggered`) or replace it with something
player-shaped — not reuse it as-is.

**What a thin player-side adapter would need to supply, concretely:**

A chat webhook event (`handleIncomingMessage`'s implicit inputs at the gate-creation call site)
provides: `socio.id`, `socio.channelType`, `playerContext?.enrollmentId`,
`playerContext?.collectionKey`, and (via `router.checkGatePosition`) the specific `lessonKey`/
`blockId` of the gate the message-index model detected. Every one of these has a direct,
already-computed player-surface analog sitting in `PlayerAccess`
(`apps/web/src/lib/player/service.ts:19-31`): `socioId`, `collectionKey`, `enrollmentId`,
`organizationId` — plus `lessonKey`/`blockId` are route parameters on any player-surface endpoint,
not something that needs deriving. `channel` would be the literal `"web"` (the player surface has
no other channel — `canDeliverGatedAssessment` already restricts gated assessments to `web`
entirely). Concretely, a player-side trigger could call `createAssessmentSession` with:

```
createAssessmentSession({
  ctx: createTenantContext(access.organizationId),
  repo: tenantRepo,          // === tenantPrismaRepo, already imported in player/service.ts
  socioId: access.socioId,
  lessonKey, blockId,        // route params
  channel: "web",
  enrollmentId: access.enrollmentId,
  collectionKey: access.collectionKey,
})
```

every argument sourced directly from `PlayerAccess` plus the two route params — no new lookup,
no adapter logic beyond argument mapping. `tenantRepo` (player/service.ts:2) and `tenantPrismaRepo`
(messaging/handler.ts:18) are **the same singleton** (`apps/web/src/lib/repo/index.ts:10`:
`export const tenantRepo = tenantPrismaRepo`), so no repo-shim is needed either.

The `/api/assessment/[sessionId]/message` and `/complete` routes need **no adapter at all** to be
reachable from the player: they already authenticate via `verifySession()`, the identical mechanism
`/api/chat` uses, and identify the caller by `session.userId`/`assessmentSession.socioId` — nothing
chat-shaped in their request/response contracts. The two things that would need player-specific
handling are exactly the two chat-coupled spots found above: the `resetMessageIndex` reteach reset
(needs a player-surface equivalent, or a no-op, since BlockProgress already tracks per-block
completion independent of any message pointer) and `runGateResolvedFollowUp` (needs to not fire, or
fire into a player-shaped channel instead of the main chat thread).

**Is the coupling too deep for a thin adapter? No.** The scoring/session-state core has zero
structural dependency on chat transport — every one of its inputs is either a plain value already
in `PlayerAccess`/route params or is itself channel-agnostic (`verifySession()`). The two coupled
spots are both small, isolated, and already identified by name (`resetMessageIndex`,
`runGateResolvedFollowUp`) rather than diffused through the core logic.

---

## 4. Scope boundary

**Confirmed**: `assessment.mode: "reteach_gate"` is valid only on `teach_back` blocks
(`journey-package.schema.ts:1095-1100`'s superRefine cross-check — mismatched `blockType` is a
schema-level rejection). The player-surface write-path gap is enforced at
`journey-package.schema.ts:1117-1122`: any package with `metadata.delivery.surface === "player"`
and a `teach_back` block carrying `assessment.mode: "reteach_gate"` fails `journeyPackageSchema`
validation outright, with a message naming the exact gap ("the player surface has no write path for
reteach-gate sessions yet"). The comment directly above it (lines 1102-1116) states this check
should be removed once the write path ships. No other block type or mode is in scope for this
investigation — `web_quiz` (the sibling mode) has its own, unrelated, already-shipped
`gradePlayerBlock` branch (service.ts:667-678) and is explicitly exempted from this gate
(schema.ts test `"does not gate web_quiz on a player-surface course"`, confirmed at
`blockAssessmentOverride.schema.test.ts:252`).

**Tests/fixtures asserting player-surface `reteach_gate` fails closed today — the one that will
need updating:**

- `apps/web/src/lib/journey-package/__tests__/blockAssessmentOverride.schema.test.ts:203-221`,
  `"rejects assessment.mode='reteach_gate' on an explicit player-surface course"` — asserts
  `journeyPackageSchema.safeParse` fails with the "no write path for reteach-gate sessions yet"
  message for a player-surface package. This is the schema-gate test and will need to flip to an
  acceptance assertion (or be replaced) once the write path ships and
  `journey-package.schema.ts:1117-1122` is removed.

Its two siblings in the same file — `"still accepts ... on an explicit chat-surface course"`
(line 223) and `"still accepts ... when metadata.delivery is absent"` (line 240) — assert the
**allowed** cases and do not need to change; they exercise chat-surface/undefined-delivery
packages, which the gate never touched and never will.

Checked and **do not** need updating, because they test the read side's conditional correctness
rather than a fail-closed assumption (a real session existing simply makes their "not passed"
branches start returning "passed" — the tests themselves don't assert failure is permanent):

- `apps/web/src/lib/player/__tests__/completeBlockReteachGate.test.ts` — all five tests
  (`"stays incomplete when no AssessmentSession exists yet"`, `"stays incomplete when a session
  exists but has not passed"`, `"completes once a session with passedAt exists..."`, `"withholds
  the score when showScoreToLearner is false..."`, `"never issues a direct AssessmentSession
  query..."`) mock `tenantRepo.getAssessmentSessionsForSocioLesson` directly; they remain valid
  regardless of what creates those sessions.
- `apps/web/src/lib/player/__tests__/grading.test.ts:164-250` (`"teach_back grading — B.2 Stage 2
  reteach_gate branch"`) — same reasoning; `gradePlayerBlock` takes a pre-resolved
  `reteachGate` parameter and is agnostic to how it was produced.
- `apps/web/src/lib/journey-package/__tests__/assessment-mode.schema.test.ts` — covers
  `showScoreToLearner` defaulting only, no `reteach_gate`/player-surface interaction.

**Read-side seam confirmed already enrollment-scoped and separate from chat**:
`tenantRepo.getAssessmentSessionsForSocioLesson` (`tenantRepo.types.ts:580-585`) is the "B.2 Stage
1" twin the doc comment (lines 565-579) describes: enrollment-only, tenant-isolated, and — per its
own precondition note — verified against production data (0 of 9 `AssessmentSession` rows had
`enrollmentId` null as of 2026-08-24) before being added. The chat surface's
`router.ts`/`gateSessions.ts` never call it (confirmed by phase-b-verification.md §4's grep and not
re-verified live in this pass, since it's a static, unchanged fact). A player-surface write path
that creates sessions through `createAssessmentSession` with a real `enrollmentId` would populate
exactly the rows this read-side method already expects.

---

## Recommended shape (recommendation only — not a decision)

**Reuse-with-adapter**, not player-native reimplementation, for the reasons evidenced above:

1. `createAssessmentSession`, `runAssessmentTurn`, and the scoring/observation core of
   `completeAssessment` are already generic — `repo: TenantRepo` typed, plain-value inputs, zero
   chat-transport coupling in their bodies. `tenantRepo` (player surface) and `tenantPrismaRepo`
   (chat surface) are the literal same object today.
2. The turn/complete HTTP routes (`/api/assessment/[sessionId]/message`, `/complete`) are
   *already* channel-agnostic — `verifySession()`-gated, not webhook-gated — per the codebase's own
   `channelSupport.ts` comment. A player-surface UI could call them directly with no new backend
   route required for the turn loop itself.
3. What's actually missing is narrow: (a) a player-side trigger that calls
   `createAssessmentSession` with `PlayerAccess`-sourced arguments when a learner reaches a
   `reteach_gate` `teach_back` block with no open/passed session — the adapter sketched in §3, a
   handful of lines, not new business logic; (b) a player-surface UI surface to drive the
   message/complete calls, since `LessonPlayer.tsx` has no sub-thread UI today (a new page/panel,
   modeled on `/chat/assessment/[sessionId]/page.tsx` but rendered inside or alongside the player
   thread rather than as a separate full-page route — the *UI* is genuinely new, even though the
   API calls underneath it are not); (c) a player-shaped replacement for the two chat-coupled
   spots — `completeAssessment.ts`'s `resetMessageIndex` reteach reset (skip it; BlockProgress
   already tracks per-block completion, there's no message pointer to reset) and
   `runGateResolvedFollowUp` (skip it, or replace with rendering the `/complete` response's
   `scores`/`passed`/`reteachTriggered` directly in the player thread instead of a synthetic
   chat-thread turn).

A fully player-native reimplementation (a second `createAssessmentSession`/`runAssessmentTurn`
just for the player) would duplicate real, non-trivial, already-tested LLM-orchestration and
scoring logic with no structural justification found in this investigation — the channel-agnostic
core genuinely does not know or care which surface called it.

Flagging this as a recommendation for Michael's approval, not a decision. Do not begin
implementation — awaiting approval.
