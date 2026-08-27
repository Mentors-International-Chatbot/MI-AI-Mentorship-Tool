# Reteach-Gate Write-Path — Stage 0: Design Investigation

Date: 2026-08-25
Scope: investigation and design only, per instructions. No application code, schema, or
migration changes. The only file written is this report.

References: `reports/reteach-gate-write-path-investigation.md` (approved: reuse-with-adapter —
`createAssessmentSession`/`runAssessmentTurn`/`completeAssessment`'s scoring core and the
`/api/assessment/[sessionId]/message`+`/complete` routes are channel-agnostic; the trigger, the
UI, and two spots inside completion are chat-coupled). This report resolves the three open design
questions that investigation left open before implementation starts.

---

## (a) Trigger point

**`completeBlock`'s current entry flow for a `teach_back` block — there is no block-entry network
call for any block type today, gated or not.** Confirmed by reading both ends:

- **Block-entry (page load / thread render)**: `LessonPlayer.tsx`'s `threadItems` walk
  (per `reports/phase-b-investigation.md` §1) computes `current` purely client-side from the
  already-fetched `LessonDto` (one `getLessonDto` call per page load, not per block). A block
  becoming `current` triggers **zero** network activity — `LessonPlayer.tsx:699` renders
  `teach_back`'s heading/hint straight from the authored block JSON already in the DTO
  (`<h2>Teach it back</h2>`, `<p>...AI Mentor asked you a question...</p>`), no fetch involved.
  Grepped `LessonPlayer.tsx` for `reteach_gate`/`GATED_ASSESSMENT`/`assessmentSession`/`sessionId`
  — zero hits anywhere in the file. There is no reteach-gate-aware code on the player surface's
  client side at all yet.
- **First submission (learner sends a message)**: only at this point does a request leave the
  browser — `askTutor`/the shared send button (`LessonPlayer.tsx:731`, `Share with AI Mentor`)
  posts to `POST /api/chat` with `context.intent: "teach_back"`. The route resolves
  `preparePlayerContext` (`player/service.ts:248-295`), which for **non-gated** `teach_back`
  reads `BlockProgress.state.turnCount` (line 289) and computes `teachBackTurn: 1 | 2` (line 292)
  — the very first read of any per-block state happens here, on submission, not on entry.

**Two candidate triggers, concrete tradeoffs:**

| | (i) Eager, on block-entry | (ii) Lazy, on first submission |
|---|---|---|
| What it requires | A new `useEffect`-driven call the moment `current` becomes a `reteach_gate` block, before the learner types anything | No new entry-time call; session creation folds into the same request that carries the learner's first answer |
| Consistency with the player's own convention | Breaks it — no other block type, including non-gated `teach_back`, makes a network call on becoming `current` (confirmed above) | Matches it exactly — every block's first server interaction today is the learner's own action |
| Consistency with the chat-surface pattern | Does not mirror chat — chat never creates a session ahead of a learner action either (see below) | Mirrors chat closely |
| UI cost | The learner sees the authored `prompt` immediately regardless (it's already in the DTO) — an eager session buys nothing for what's on screen, since intro text is static content, not the AI's session-opening message | Same authored `prompt` renders immediately from the DTO; no intro text is lost by waiting |
| Failure handling | An eager create that fails (config error, race) has to degrade a block the learner hasn't engaged with yet — a new failure mode with no clear owner in the UI | A lazy create failing on submit is the same shape as an existing failure the UI already handles (`sendFailures >= 2` → "Continue without sending", `LessonPlayer.tsx:737`) |

**Chat's actual trigger, re-confirmed at the exact call site**: `checkGatePosition`
(`router.ts:81-152`) evaluates gate position on **every incoming chat turn** (not a dedicated
"enter the gate" event — chat has no such event; it's turn-based by construction). It returns
`sessionId: existingSession?.id` when one is already open. `handler.ts:562-579` then does:
`let sessionId = gate.sessionId; if (!sessionId) { create }` — creation is **conditional and
idempotent**, firing only when no open session exists yet, on whatever the next incoming message
happens to be. This is structurally lazy: nothing is created ahead of a learner's own turn.

**Recommendation: mirror chat's lazy, idempotent-create pattern — trigger (ii), not (i).** Two
independent reasons converge on the same answer: it is what the player already does for every
other block type (no block-entry call precedent to break), and it is what chat already does
(no block-entry-equivalent event exists there either — the model doesn't need inventing, it needs
porting). Concretely: the learner's first "Share with AI Mentor" submission for a `reteach_gate`
`teach_back` block should be the request that performs "find existing open session for this
enrollment+lesson+block, else create one" before running the first turn — not two separate steps
across two page states.

**Navigate-away-and-return — falls out of the trigger design for free, provided the trigger step
includes the same check-before-create the chat call site already does, not a separate resume
mechanism.** Two sub-cases, traced against what already exists:

- **Learner leaves before submitting anything.** No `AssessmentSession` row exists yet (lazy
  creation never fired). On return, the block renders exactly as any first-visit `teach_back`
  does — no resume logic needed, nothing to resume.
- **Learner leaves mid-session (has submitted ≥1 turn, session is `pending`/`in_progress`).**
  The session's full state — `turnCount`, `liveState`, and every turn as a `Message` row scoped
  by `assessmentSessionId` (`getAssessmentMessages`, confirmed in the prior report) — is already
  durable in the DB; nothing about a page reload touches it. **What's needed on return is a
  lookup, not new state-management**: `GET /api/assessment/[sessionId]` already exists
  (`app/api/assessment/[sessionId]/route.ts`) and returns exactly `{session, messages, config}` —
  confirmed by reading `app/chat/assessment/[sessionId]/page.tsx:100-133`, which uses this exact
  route today to resume its own reload case (`if (data.session.status === 'pending')
  await startSession(...)` — the chat UI already has to handle "page loaded, session exists,
  resume it," and does so entirely via this one GET). The only piece missing for the player is
  knowing **which** `sessionId` to fetch, since the player thread doesn't get a session id handed
  to it via a chat message the way `chat/page.tsx` does. That means the same lazy-create trigger
  step must, on every visit to a `reteach_gate` block (not just the very first), do a
  find-or-create lookup (`getAssessmentSessionsForSocioLesson`-shaped, scoped to non-completed
  status) before deciding whether to create — exactly mirroring `checkGatePosition`'s own
  `existingSession = sessions?.find((s) => s.status !== 'completed')` check. **This is not
  separate scope; it is the same idempotency guard chat already has, applied on every block-visit
  rather than only at submission-time creation.** Design consequence for Stage 1: the trigger
  endpoint's contract should be "resolve-or-create, return the sessionId + resume state," called
  whenever the learner is on a `reteach_gate` block with an unresolved gate — not merely on first
  submission in the narrow sense, but on every request into that block until it resolves.

---

## (b) UI reuse

**Confirmed: non-gated `teach_back` already does turn-by-turn multi-turn exchange in the player's
single thread today.** Full flow, `LessonPlayer.tsx` + `player/service.ts`:

- `LessonPlayer.tsx:685-740` renders `teach_back` inside the **same** `<section>`/`<aside>`
  structure every block uses — no separate sub-view. The card shows the block's authored `prompt`
  (already pushed into the thread as a `"prompt"` `ThreadItem`, per phase-b-investigation.md §1)
  plus a one-line hint (`699-701`) that flips between "answer the question" and "keep talking or
  continue" based on `submittedComplete`. The shared `<textarea>` (`721`) is the only input;
  its button label is turn-aware (`731`: `teachBackTurn === 1 ? "Share with AI Mentor" :
  "Send follow-up"`).
- Submission goes through `askTutor()` → `POST /api/chat` with `context.intent: "teach_back"`.
  Server-side, `preparePlayerContext` (`service.ts:248-295`) computes `teachBackTurn` from
  `BlockProgress.state.turnCount`, `handler.ts:529-545` builds a turn-aware instruction, and after
  generation `recordPlayerTutorSuccess` (`service.ts:297-330`) upserts `BlockProgress.state =
  {turnCount}`, marking `completedAt` only once `teachBackTurn === 2`.
- **This is the base to extend, not a new UI**, exactly as anticipated: the mechanics of "learner
  sends text into the shared box, server round-trips through a stateful multi-turn AI exchange,
  turn position persists in a DB row across separate HTTP requests, the card's hint text and
  button label react to turn state" are all already built and already player-native.

**Concrete delta `reteach_gate` needs on top — three real differences, not a rebuild:**

1. **Variable-length, not fixed-2-turn.** Non-gated `teach_back` hardcodes `teachBackTurn: 1 | 2`
   and always completes at turn 2 (`service.ts:292,299`). `reteach_gate` needs `turnCount` bounded
   by `minTurns`/`maxTurns` from `configSnapshot` (already computed server-side by
   `createAssessmentSession`'s `buildConfigSnapshot`, per the prior report) with a real pass/fail
   verdict from `checkPassCondition`, not an always-succeeds counter. The UI needs to render "keep
   going" for an unbounded number of turns rather than switching to "Send follow-up" once and
   completing on the next reply.
2. **Passing-state / failure / max-turns display.** Non-gated `teach_back` has exactly one
   completion shape (the block turns green). `reteach_gate` has three real outcomes —
   `passed`, `max_turns` with `onMaxTurnsWithoutPass` branching (`flag_mentor` /
   `return_for_reteach` / `complete_with_scores`), and mid-session `continue` — that the chat
   surface's `AssessmentPage` already renders (`status`, `passed`, `scores`,
   `reteachTriggered` state in `app/chat/assessment/[sessionId]/page.tsx:24-31`). The player card
   needs equivalent verdict UI, not the binary "reviewed / not reviewed" `BlockFeedback` shape
   used by quiz/drag_order.
3. **`showScoreToLearner` gating applies here the same way, and this is already partially built
   on the read side — confirmed, not merely "should apply."** `resolveReteachGateSignal`
   (`service.ts:743-766`) already gates the score at completion-time read (`merged?.showScoreToLearner
   && typeof rawScore === "number" ? rawScore : null`), matching B.3's `web_quiz` coarse
   suppression convention exactly (per the prior investigation and phase-b-verification.md's
   design note on full suppression, not field-stripping). **What's missing is only the write-time
   mirror**: the `/complete` route already computes and returns `scores` unconditionally in its
   response body (`complete/route.ts:184-191`, one `for` loop over
   `configSnapshot.studentVisibleDimensionKeys`, no `showScoreToLearner` check at all). A
   player-surface caller rendering that raw response directly would leak scores
   `resolveReteachGateSignal` is designed to withhold. This needs either (a) the player UI to
   discard `response.scores` client-side when `showScoreToLearner` is false (fragile — trusts the
   client not to just read the network tab) or (b) `complete/route.ts` itself to gate `scores` on
   `configSnapshot.showScoreToLearner` before returning, mirroring `resolveReteachGateSignal`'s
   own gate server-side. **(b) is the only safe option** and is a real, if small, code change to
   an otherwise-reused route — flagged here for the implementation stage, not attempted in this
   investigation.

**Route reuse — confirmed, no adapter needed for the turn/complete calls themselves.** Read both
route bodies directly:

- `POST /api/assessment/[sessionId]/message` (`message/route.ts:16-51`): auth is
  `verifySession()` (a cookie-backed web session, line 35) plus `session.role !== 'socio'` →
  403 (line 40); request body is `{message: string}` (line 24-25); `socioId = session.userId`
  (line 55). Nothing chat-shaped — no channel field, no webhook payload, no WhatsApp-specific
  parsing.
- `POST /api/assessment/[sessionId]/complete` (`complete/route.ts:1-40` read directly): identical
  `verifySession()` pattern; request body is `{reason?: 'cancelled' | 'timeout'}`. Also nothing
  chat-shaped.
- **Confirmed reusable as-is from a player-surface caller for the turn loop itself.** The one
  caveat is the `showScoreToLearner` gate identified above inside `/complete`'s response
  construction — a fix to the shared route, not a fork of it.

---

## (c) Completion resolution

**`resetMessageIndex`, exact current behavior** (`prismaRepo.ts:396-404`): unconditionally sets
`SocioProgress.currentMessageIndex = 0` for the given `socioId`, no other fields touched. Called
from exactly one place: `completeAssessment.ts:301`, inside the `outcome === 'max_turns'` →
`onMaxTurnsPolicy === 'return_for_reteach'` branch, itself gated only on `if (allowRetake)`
(lines 294-303) — no surface check anywhere in the call chain.

**Player-surface equivalent: none needed — this can be skipped entirely, not replaced.**
`currentMessageIndex` is read by exactly one consumer, `router.checkGatePosition`
(`router.ts:89, 103`, `msgIndex = repoProgress.currentMessageIndex`), which is chat-surface-only
machinery (per `reports/phase-b-investigation.md` §2: `router.ts` has zero player-surface
callers). The player tracks lesson progress entirely through `BlockProgress`/`LessonProgress`
(per-block `completedAt`, read by `lessonRows`/`completeBlock`/`getLessonDashboard`), which has
**no message-index concept to reset** — confirmed by grepping `player/service.ts` for
`currentMessageIndex`/`messageIndex`: zero hits. "Return for reteach" on chat means "rewind the
linear pointer so the AI replays earlier teach content before the learner reaches the gate again";
on the player, all prior blocks are already permanently visible as thread history (per
phase-b-investigation.md §1's "next-block rendering" fix — completed blocks never disappear), so
there is nothing to rewind — the learner can already reread any earlier block at will. Retry
itself is already covered by (a)'s find-or-create trigger design: a `completed`, unpassed session
with `allowRetake: true` simply leaves the door open for a new session on the same block the next
time the learner submits — no pointer of any kind gates that.

**`runGateResolvedFollowUp`, exact current behavior** (`gateFollowUp.ts:71-108`, full body read):
called unconditionally and unawaited-for-failure (wrapped in try/catch, "never throws" per its own
docblock) from `complete/route.ts:158-165` whenever the completion is not a cancellation. It looks
up the socio, builds a synthetic instruction string standing in for a learner message
(`FOLLOW_UP_INSTRUCTION`, localized, lines 39-52), and calls **`handleIncomingMessage`** — the
full chat pipeline (`determineMode`, prompt routing, generation) — with `systemInitiated: {kind:
'gate_resolved', ...}`. The reply is delivered via `WebChannel`/`WhatsAppChannel`
(`channelFor`, line 54-58) into the **main chat thread** — a `Message` row with
`assessmentSessionId: null`, the same table `chat/page.tsx`'s five-second poll reads (per the
function's own docblock, lines 9-12).

**Player-surface equivalent: confirmed to be nothing — the block resolving to `complete` and the
learner advancing via existing `completeBlock` machinery is sufficient, no synthetic turn
needed.** Two independent reasons: (1) the `/complete` response body already carries everything a
"the AI congratulates you" moment would need — `status`, `message`, `passed`, `scores`,
`reteachTriggered` (`complete/route.ts:172-197`) — so a player UI can render the outcome
synchronously from the same request that resolved it, with no second round-trip; (2) posting into
the main `Message` table would be structurally wrong for the player even if desired —
`LessonPlayer.tsx` builds its thread from `getLessonDto`, not from polling the main chat
`Message` table (confirmed by phase-b-verification.md §4's grep: `resolveIntroMessage`/
`buildLessonDashboard`/etc. are unreachable from `src/app/chat`, and the reverse holds structurally
too — `LessonPlayer.tsx` has no chat-`Message`-table read anywhere). Every other block type's
completion (`teach`, `quiz_checkpoint`, `drag_order`) already resolves synchronously through
`completeBlock`'s own response with no synthetic AI turn — `reteach_gate` following the same shape
is consistent with the player's existing convention, not a special case.

**How do these two functions currently know they're on the chat surface — explicit check or pure
implicit?** **Purely implicit, confirmed by reading every call site in the chain — no surface or
channel parameter exists anywhere in either function's signature or caller.**

- `resetMessageIndex(socioId: string)` (`repo/types.ts:338`) takes only a `socioId`. Its caller,
  `completeAssessment`'s `return_for_reteach` branch, receives no surface/channel argument either
  — `completeAssessment`'s params (per the prior investigation's citation, `completeAssessment.ts`
  read again here) are `sessionId`, `outcome`, config, and `enrollmentId` (itself an overloaded
  field — see below), nothing surface-shaped.
  Note: `enrollmentId` as threaded into `completeAssessment` **cannot safely serve as a surface
  signal** even though it looks tempting — the value complete/route.ts computes and passes under
  that name is `getParticipantBySocioId(...).id`, i.e. `ParticipantProfile.id`
  (per `reports/phase-b-investigation.md` §2), which is broader than "has a player enrollment" and
  is populated for chat participants too whenever they happen to have a profile row. It is a
  different, coincidentally-named value from the `AssessmentSession.enrollmentId` **column**
  (nullable, set once at creation, real `Enrollment.id` — schema.prisma:955-958), which today
  happens to be null on every session chat's real call site creates (confirmed in the prior
  report: `handler.ts:567-584` passes `enrollmentId: playerContext?.enrollmentId`, always
  `undefined` on the chat path in practice). Using either of these as an implicit "which surface"
  signal would work by coincidence today and is exactly the kind of fact A.7's planned
  enrollment-ID migration (per phase-b-investigation.md §2/§3) could silently invalidate later —
  the same anti-pattern that report already flagged once (`createAssessmentSession.ts:295-297`'s
  ad hoc in-memory filter). **Do not use enrollmentId-presence as the surface signal.**
- `runGateResolvedFollowUp` (`gateFollowUp.ts:71-77`) takes `{socioId, sessionId, passed,
  resolvedAt}` — again no surface field. `complete/route.ts:158-165` calls it unconditionally
  whenever `!isCancellation`.

**This means the fix is not a one-line conditional using data already in hand — it requires
resolving surface from course identity, via the resolver pattern already established elsewhere in
this codebase (B.1's `resolveDelivery`/`resolveListed`/`resolveIntroMessage` triplet,
`journey-package/delivery.ts:16`), not a full two-implementations-behind-an-interface adapter
split.** `AssessmentSession` carries `lessonKey` but no `collectionKey` column (schema.prisma:934-
940's own doc comment: "This table has no collectionKey column at all — course identity had to be
derived via lessonKey -> ContentLesson.collection.slug"). The same derivation
`createAssessmentSession` already performs at session-creation time (`resolveProgramConfig`,
lines 110-137, per the prior report) can be repeated at completion time — or, more cheaply, the
session's `configSnapshot` (already loaded by `complete/route.ts` via `getSessionConfig`) could be
extended at creation time to carry the resolved `surface` value once, rather than re-deriving it
on every completion. Either way, this is **one derived boolean/enum, branching two existing call
sites** (`completeAssessment.ts`'s `return_for_reteach` case, `complete/route.ts`'s
`runGateResolvedFollowUp` call) — not a structural interface split with two parallel
implementations. Recommend against branching on `enrollmentId` presence for the reason above;
recommend branching on a `surface` value resolved the same way B.1's resolvers already do, either
computed fresh or (better, cheaper) baked into `configSnapshot` at creation time since that's
already read at both turn- and completion-time.

---

## Proposed implementation stage breakdown

Proposed only — not a decision. Mirrors this session's Phase B staging convention (small,
independently verifiable, read-side-before-write-side-shipped-first pattern already used for B.2/
B.3's Stage 1/Stage 2 split).

1. **Stage 1 — find-or-create trigger.** A new player-surface entry point (likely a route under
   `/api/learn/[course]/[lessonKey]/blocks/[blockId]/...`, sibling to the existing `complete`
   route rather than a new top-level namespace) that, for a `teach_back` block with
   `assessment.mode === 'reteach_gate'`, resolves-or-creates an `AssessmentSession` using
   `PlayerAccess`-sourced arguments exactly as sketched in the prior investigation's §3, applying
   the same idempotent existing-open-session check `checkGatePosition` already does. Returns
   `{sessionId, resumed: boolean}`. No UI yet — this stage is pure plumbing, testable directly
   against `createAssessmentSession`/`getAssessmentSessionsForSocioLesson` the same way B.2's
   Stage 1 tests did.
2. **Stage 2 — player UI.** Extend `LessonPlayer.tsx`'s `teach_back` rendering (not a new page)
   to detect `reteach_gate` mode, call Stage 1's endpoint on first interaction with the block,
   then drive `/api/assessment/[sessionId]/message` and `/complete` directly for the turn loop —
   reusing the shared textarea/button, adding the three UI deltas from (b): variable-length turn
   handling, verdict/max-turns display, and score visibility respecting `showScoreToLearner`.
3. **Stage 3 — completion-resolution adapter + score-gating fix.** The `surface`-branch on
   `resetMessageIndex` (skip on player) and `runGateResolvedFollowUp` (skip on player, render the
   already-returned `/complete` response instead) designed in (c), plus the `/complete` route
   `showScoreToLearner` gate on its response `scores` field identified in (b). Small, surgical,
   touches exactly the two chat-coupled spots plus one route — no new business logic.
4. **Stage 4 — remove the schema gate + update the one test.** Once Stages 1-3 are shipped and
   verified, remove `journey-package.schema.ts:1117-1122`'s player-surface `reteach_gate`
   rejection (per its own doc comment, "should be removed once the write path ships"), and flip
   `blockAssessmentOverride.schema.test.ts:203-221` from a rejection assertion to an acceptance
   assertion. This stage is deliberately last and separate so the gate keeps failing closed for
   every stage in between — a partially-built write path never becomes reachable by real content
   mid-implementation.
5. **Stage 5 — verification pass.** Same shape as `reports/phase-b-verification.md`: `tsc`/full
   suite/eslint, a transform-invariant check against live content (still expected to be zero
   `reteach_gate` blocks authored anywhere), and a manual run-through once Stage 4 lands — this is
   the first point at which authoring a real `reteach_gate` block for a live or test course
   becomes meaningful, since Stage 4 is what stops the schema from rejecting one.

Do not begin implementation — awaiting approval.
