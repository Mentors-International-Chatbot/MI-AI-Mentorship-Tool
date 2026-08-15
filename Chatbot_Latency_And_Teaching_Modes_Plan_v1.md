# Chatbot Latency & Teaching Modes — Plan v1

Date: 2026-08-08
Scope: the conversational path (`/api/chat` → `messaging/handler.ts` → `ai/service.ts`) and the passive analysis passes hanging off it.

---

## Build status (2026-08-08)

**Shipped.** Typecheck clean, `npm run build` green, 644 tests passing (was 627; 17 new).

| item | status | files |
|---|---|---|
| P1.1 cache `getActivePrompt` | done | `prompts/activePromptCache.ts` (new), `loadPrompt.ts`, `layers/core.ts`, `api/admin/prompts/route.ts` |
| P1.2 pin function region | **blocked** — needs the Neon region, see below | `vercel.json` |
| P1.3 de-dupe `getSocioProgress` | done | `prompts/router.ts`, `ai/service.ts` |
| P1.4 de-dupe gate-session reads | done | `prompts/gateSessions.ts` (new), `router.ts`, `stance.ts` |
| P1.5 parallelize prompt layers | done | `prompts/builder.ts` |
| P1.6 parallelize handler head | done | `messaging/handler.ts` |
| P1.7 tighten retry envelope | done — 30s→12s, 2 retries→1 | `ai/service.ts` |
| P3.5a/5b analysis gating | done | `ai/analysisPolicy.ts` (new), `service.ts`, `handler.ts` |
| P4a second route to coach | done | `prompts/stance.ts`, `prompts/router.ts` |

New tests: `activePromptCache.test.ts` (6), `routerQueryBudget.test.ts` (4), `analysisPolicy.test.ts` (7), plus 11 stance cases and one end-to-end router case for the coach route.
`routerQueryBudget.test.ts` pins the de-dupes by counting calls, since a duplicate read is invisible in behaviour and shows up only as latency.

Two changes worth knowing about beyond the mechanical de-duping:

- **Sensing is now dispatched after the router, not before it.** This costs nothing (`determineMode` is DB-only and already had to finish before the LLM call) and buys the analysis policy a mode to decide on. Turns where the AI is doing the talking no longer pay for a sensing round trip.
- **Sentiment moved after `generateAIResponse`.** Beyond the gating, this makes a race deterministic: a RED flag written from *this* message could previously land before `determineMode` read the flag table, flipping stance to coach mid-turn some of the time. It now always takes effect on the next turn.

**Still open, in order:** P1.2 (region), P2 (streaming), P3.5c (merge sensing + sentiment), P3.5d, P4b/c/d.

### P4a as built (2026-08-09)

`hasPassedCurrentLessonGates` returned `false` for two different facts — "this learner did not clear the bar" and "this course set no bar" — which pinned every ungated curriculum to tutor for the whole course. `readGateEvidence` now separates them into `passed` / `not_passed` / `no_gates`, and the stance decision splits accordingly:

- **A declared gate remains the sole authority.** On a gated lesson a failed teach-back still means tutor, and no weaker evidence overrides it. Pinned by a test.
- **An ungated lesson runs an evidence ladder:** a reached milestone (strongest — they reported *doing* part of the project) → coach; else the lesson being *taught out* (`currentMessageIndex >= messages.length`, the exact state where the router stops delivering lesson content and falls through to FREEFORM_QUESTION) → coach; else tutor.

The taught-out rung is vetoed by a recorded understanding at or below `RETEACH_THRESHOLD`, but **not** by a missing one. Most lessons complete without a parsed score, so treating absence as failure would have left the ladder as unreachable as the rule it replaces. If they genuinely did not follow it, RETEACH fires and opens the existing tutor detour.

Three new `StanceReason` values (`milestone_reached`, `lesson_taught_out`, `awaiting_evidence`) ride on the existing trace, so you can query which route each learner took from `ai_invocations.promptVersion`.

Query cost is unchanged for gated courses. Milestone progress is now both a decision input and a coach-rendering input, served by one memoized per-turn loader that short-circuits on two process caches when a course declares no milestones — so the legacy MI collection pays nothing for the new rung.

**What this does not fix (P4b):** the gates that do exist still ask "did you understand lesson 7", not "do you know what you need for the next milestone". That is the interactive task-prerequisite workflow, and it remains unbuilt.

### P1.2 needs one answer from you

`vercel.json` has no `regions` key, so functions run in the project's default region. If that is not the Neon region, every one of the remaining per-turn queries pays cross-region RTT — worth more than everything above combined. Check the Neon dashboard (or the host in `DATABASE_URL`, which encodes it) against the Vercel project region and set `"regions": ["<region>"]`.

---

## 1. What actually happens on one user message

Traced from `src/app/api/chat/route.ts` down. For an ACTIVE socio mid-lesson on web:

**Four LLM calls per message.**

| call | model | blocking? | file |
|---|---|---|---|
| sensing (comprehension + confusion) | `claude-haiku-4.5` | started in parallel, **joined before returning** | `ai/sensing/senseDimensions.ts` |
| main generation | `claude-haiku-4.5` | yes | `ai/service.ts:273` |
| sentiment (confusion/frustration/urgency/topics) | default model | fire-and-forget | `sentiment/analyzer.ts` |
| context extraction (business facts) | default model | fire-and-forget | `ai/contextExtractor.ts` |

Each one also writes an `ai_invocations` row (`invokeTraced`), so four LLM round trips plus four DB writes.

The two background calls are "fire-and-forget" in the sense that nothing awaits them, but on Fluid Compute they run on the same instance, competing for the same CPU and outbound sockets as the call the user is waiting on. They are not free.

**~25–35 sequential DB round trips**, on Neon via `PrismaNeon` (HTTP per query — every one is a network hop). The expensive and avoidable ones:

- `loadActivePrompt` is **uncached** and walks up to 3 scope tiers per category (`prismaRepo.ts:781`, one `findFirst` per tier, deliberately sequential). Three categories load per turn — `core`, the mode's task category, and `stance_tutor`/`stance_coach`. That is **up to 9 sequential round trips per turn** for prompt text that changes maybe monthly.
- `getSocioProgress` runs **twice**: `service.ts:167` (for sensing's lesson context) and `router.ts:241`.
- The current lesson's assessment sessions are fetched **twice**: `checkGatePosition` (`router.ts:92`) and `hasPassedCurrentLessonGates` (`stance.ts:137`). Same rows, two different questions asked of them.
- `getMessages` runs twice — limit 1 in the router for `daysSince`, limit 10 in the service for history.
- The four prompt layers in `buildSystemPrompt` are awaited **serially** (`builder.ts:70–79`) despite being fully independent.

**No streaming.** `/api/chat` returns `NextResponse.json` after the entire completion is generated, parsed, sanitized, and persisted. Perceived latency equals total generation time, always.

**Retry envelope is wide.** `AI_TIMEOUT_MS = 30000`, `maxRetries = 2`, exponential backoff. A bad turn can take 30s+ before the fallback text appears.

**No `regions` key in `vercel.json`.** If the functions and the Neon database are not in the same region, every one of those 25–35 queries pays cross-region RTT.

---

## 2. Phase 0 — measure before cutting (half a day)

You already built the instrumentation; nothing here is new code.

- `ai_invocations` has `operation`, `latencyMs`, `success`. Get p50/p95 per operation:
  ```sql
  SELECT operation, count(*),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95
  FROM ai_invocations
  WHERE "createdAt" > now() - interval '7 days'
  GROUP BY operation ORDER BY p95 DESC;
  ```
- `logEvent('info','ai','AI response generated')` already carries `timings.{sensing, sensingJoinWait, determineMode, buildPrompt, fetchHistory, llmInvoke}`. `sensingJoinWait` is the number that says whether sensing is still on the critical path. `determineMode + buildPrompt + fetchHistory` is your DB tax.
- Add one line: total handler time minus `llmInvoke`. That is the number Phase 1 attacks.
- Confirm the Vercel function region vs. the Neon region. If they differ, fix that first — it is worth more than every code change below combined.

Do not skip this. The plan below is ordered by expected value, but the ordering assumes DB tax and generation time are roughly comparable. Your traces will say.

---

## 3. Phase 1 — mechanical wins, zero behavior change

Ordered by value/effort.

1. **Cache `getActivePrompt`.** In-process `Map` keyed by `category|organizationId|collectionKey`, 60s TTL — same discipline as `config/service.ts` and `courseOutcome.ts`, both of which already do this. Bust the entry when a prompt is activated in `/admin/prompts`. Removes up to 9 round trips per turn on a warm instance.
2. **Pin the function region** to the Neon region in `vercel.json` (`"regions": ["<neon-region>"]`).
3. **De-dupe `getSocioProgress`.** `service.ts` already has it before it calls `determineMode`; pass it in.
4. **De-dupe the gate session read.** Fetch the current lesson's sessions once in `determineTurnType`, hand the rows to both `checkGatePosition` and `resolveStance`. Keep the two *interpretations* separate — `checkGatePosition` correctly treats any completed session as clearing progression, `hasPassedCurrentLessonGates` correctly requires `passedAt !== null`. That distinction is load-bearing and documented in `stance.ts:112`; only the fetch is shared.
5. **Parallelize `buildSystemPrompt`.** `Promise.all` over layers 1–4. They share `scope` and nothing else.
6. **Parallelize the handler head.** `addMessage` / `touchInteraction` / `getDimensionStateMap` are independent.
7. **Tighten the retry envelope on the interactive path.** `maxRetries: 1`, timeout 12–15s. 30s of waiting is worse for a learner than an honest fallback at 15s. Keep the wide envelope for cron/summary work.
8. **Enable prompt caching on the stable prefix.** Layers 1–2 are near-identical turn to turn. Anthropic prompt caching cuts time-to-first-token materially on a ~1k-token prefix. Verify OpenRouter passes `cache_control` breakthrough for the model you use; if it does not, this is an argument for going direct or through AI Gateway.

Expected: this removes most of the non-LLM time. It does not make the model faster.

---

## 4. Phase 2 — stream the response (the real perceived-latency fix)

Everything in Phase 1 shaves the wrapper. Streaming changes what the learner experiences: first token in ~500ms instead of a blank screen for the full generation.

**Why it is not a one-liner here:** markers (`[FLAG:…]`, `[LESSON_COMPLETE:n]`, `[MILESTONE:key]`, `[ESCALATE|…]`, `[FINANCIAL:…]`) are parsed out of the *complete* text and stripped before delivery (`prompts/markers.ts`, consumed in `handler.ts:352–419`). You cannot naively forward tokens.

**Shape:**
- Stream from the route, not the handler. WhatsApp cannot stream and must keep the current batch path — so the streaming variant lives in `/api/chat`, and `handleIncomingMessage` grows a mode that returns a stream plus a completion promise.
- Buffer on `[` and hold until the bracket resolves as marker-or-prose. Markers are emitted at the end of replies by convention, so in practice this costs nothing mid-stream.
- Run all persistence (flags, milestones, lesson completion, financials, `addMessage`) after the stream closes, from the completion promise. The client already has a `/api/chat/poll` path for late-arriving messages, so the metadata can land slightly after the text.
- Keep the assessment-gate path non-streaming — it returns a fixed card, not a generation.

This is the largest piece of work in the plan and the largest single UX win. Do it after Phase 1 so you are not streaming on top of 30 avoidable round trips.

---

## 5. Phase 3 — gate the analysis passes (your ask)

Your instinct is right, with one correction: **onboarding already skips all three passes.** The `socio.status !== 'ACTIVE'` branch returns at `handler.ts:121` before sentiment, sensing, or context extraction are reached. What actually runs the heavy analysis on worthless input is narrower and more specific:

- Sentiment fires at `handler.ts:145` on **every** ACTIVE message — including `"ok"`, `"siguiente"`, the numeric feedback-score replies (`awaitingFeedback` path), the no-curriculum path, and `aiPaused` socios. Sensing has a triviality gate (`sensing/triviality.ts`); sentiment and context extraction have none at all.
- Context extraction runs on every reply, and starts by re-fetching the socio (`contextExtractor.ts:12`) that the handler already has in hand. Extracting business facts from `"ok"` is pure waste.

### 5a. Cheap gates first

- Reuse `isTrivialMessage` for sentiment and context extraction. "ok" / "listo" / "siguiente" cannot be distressed and contain no facts. One import, three call sites.
- Skip both on structural turns: `awaitingFeedback` replies, `aiPaused`, no-curriculum, `startNextPatterns` matches.
- Pass the already-loaded `socio` into `extractAndStoreContext` instead of re-querying.

### 5b. The policy table you actually asked for

The signal to gate on already exists — `routerResult.mode` and `routerResult.stance`. Resolve one `AnalysisPolicy` per turn from those two, in one place, instead of three scattered unconditional calls:

| turn | sensing | sentiment | context extraction |
|---|---|---|---|
| trivial message (any mode) | no | no | no |
| LESSON_START | no | no | no |
| LESSON_DELIVERY | yes | yes | yes |
| RETEACH | yes | yes | no |
| FREEFORM_QUESTION | yes | yes | yes |
| REMINDER | no | no | no |
| feedback-score reply | no | no | no |
| GATED_ASSESSMENT | assessment path has its own sensing | no | no |

**One ordering problem to solve:** sentiment currently fires *before* the router runs, so it cannot see `mode`. Fix by moving the call to after `generateAIResponse` — it only needs `messageId` and the message text, and it is fire-and-forget either way. No behavior is lost: a flag it writes feeds stance rule (a) on the *next* turn regardless of where in this turn it fired.

### 5c. Fold sensing and sentiment into one call

This is the highest-value item in the phase. The two calls score the same message on overlapping axes:

- sensing → `comprehension`, `confusion`
- sentiment → `confusion`, `frustration`, `urgency`, `sentiment`, `topics`

That is two Haiku calls returning near-identical JSON about one sentence. Merge into a single structured call that returns both shapes; split the result at the boundary — dimensions to `updateDimensionState`, scores to `saveSentiment` and the auto-flag thresholds. Halves the analysis cost and removes a round trip and a trace write.

Watch the one real difference: sensing takes `priorState` and lesson context in its prompt, sentiment does not. Keeping both inputs is fine; the merged prompt is still one call.

### 5d. Get the rest out of the request entirely

Longer horizon, mentioned so the phases above do not paint you into a corner:

- **Context extraction wants to be a marker, not a call.** The model already emits `[MILESTONE:key]` and `[FINANCIAL:…]` in the main generation. A `[CONTEXT:key=value]` marker costs *zero* extra LLM calls — it rides on a completion you are already paying for. This deletes an entire pass.
- **Sentiment wants to be batched**, except for urgency. A confusion score that lands two minutes late costs nothing. A RED urgency flag that lands two minutes late may cost an escalation. Split it: keep a cheap synchronous urgency/distress check (keyword prefilter, or the merged call from 5c), batch the rest via Vercel Queues or a cron over unanalyzed messages.

---

## 6. Phase 4 — tutor / coach modes

**This is already built.** `src/lib/ai/prompts/stance.ts` implements exactly the two postures you described, as a second router axis orthogonal to `InteractionMode`:

- **tutor** — "your job is for them to UNDERSTAND, not to execute; do not yet ask them to report results"
- **coach** — "they already understand; start from where they are: what they tried, what happened, what is blocking them; acknowledge real progress and name the next concrete step"

Selection is code's decision, not the model's, in precedence order: active RED flag → coach (never tutor someone in crisis); gate not passed → tutor; gate passed → coach. A 3-turn hysteresis window (`TUTOR_DETOUR_TURNS`) lets coach visit tutor without flapping. Coach stance additionally gets the task facts block — course project, deliverables, this lesson's exercise and commitment, and per-milestone done/pending state.

So the gap is not the modes. It is these four things:

**a. Most courses can never reach coach.** `hasPassedCurrentLessonGates` returns `false` when a lesson declares no gates (`stance.ts:133`) — deliberately, since with no gate there is no evidence of knowledge. But it means any curriculum imported without teach-back gates, including the legacy MI collection, is **permanently tutor**. Fix is one of: author gates per course, or add a second route to coach (a reached milestone, or a started project, is also evidence).

**b. The gates ask the wrong question for your framing.** You described "interactive workflows that assess what they need to know to accomplish the task." The assessment system exists (`ai/assessment/`), but gates are per-lesson comprehension checks — "did you understand lesson 7" — not task-prerequisite checks. Now that `outcome.milestones` is readable (`prompts/courseOutcome.ts`, as of 2026-08-08), the gate can be derived from the *next milestone* instead: "do you know what you need in order to do the next thing." That is the workflow you described, and the data to build it just landed.

**c. Coach turns run tutor-shaped analysis.** Sensing scores `comprehension` and `confusion` on a coach turn where the learner is reporting execution progress. Wrong axis — a coach turn wants obstacle, momentum, morale. This ties directly into Phase 3: the analysis policy should be **stance-aware**, not only mode-aware, and the sensing dimensions should differ by stance.

**d. Stance is invisible.** It is recorded on every trace row (`promptVersion.stance`, `stanceReason`) but surfaced in no dashboard. A mentor cannot see that a socio has been stuck in tutor for three weeks. Cheap, high-value addition to `/dashboard/socios/[id]`.

---

## 7. Suggested order

1. Phase 0 (measure) — half a day
2. Phase 1 items 1, 2, 3, 4 — the four that remove the most round trips
3. Phase 3 §5a + §5b — gating, small and independent of everything else
4. Phase 2 (streaming) — the big UX win
5. Phase 3 §5c (merge sensing + sentiment)
6. Phase 4a (a second route to coach) — otherwise most learners never see the mode
7. Phase 3 §5d, Phase 4b/c/d
