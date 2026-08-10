/**
 * Which channels can actually deliver a gated assessment
 * ═══════════════════════════════════════════════════════════════════════════
 * A gated teach-back is a web flow end to end: the gate card renders in
 * `chat/page.tsx`, the learner answers at `/chat/assessment/[sessionId]`, and
 * every turn goes through `/api/assessment/*`, which authenticates with
 * `verifySession()` — a cookie-backed web session. There is no route into that
 * pipeline from a WhatsApp webhook.
 *
 * Before this module the router did not know that. On WhatsApp it would post
 * the gate prompt, create the session, and then — because an open session makes
 * `checkGatePosition` keep returning GATED_ASSESSMENT, and because the handler
 * suppresses the message when reusing a session — answer every subsequent
 * message with `responseText: ''`. Silence, forever, with no way out. Not a
 * degraded experience: a dead account, and one that only two live socios were
 * positioned to hit, which is why nobody had.
 *
 * So the honest statement is not "WhatsApp learners fail the gate". It is
 * "this lesson has no deliverable gate for this learner", and BOTH readers of
 * gate state have to agree on it:
 *
 *   - `router.checkGatePosition`  → progression is not blocked
 *   - `stance.readGateEvidence`   → `no_gates`, so the ungated evidence ladder
 *                                   applies instead
 *
 * Skipping only the first would unblock progression and then pin the learner to
 * tutor for the whole course, because a gate that can never be attempted can
 * never be passed. That is the same defect this codebase just removed for
 * gate-less curricula, and it must not come back through the side door.
 *
 * This is a stopgap with a clear replacement: a conversational teach-back
 * carried in the main WhatsApp thread. That needs an auto-complete path (there
 * is no button to press on WhatsApp) and a text score report, and it changes
 * the deliberate two-phase message/complete split. It deserves its own design
 * pass rather than being half-built here.
 * ═══════════════════════════════════════════════════════════════════════════
 */
/**
 * Can a gated teach-back be delivered to, and answered on, this channel?
 *
 * Takes `string` rather than `ChannelType` because that is what
 * `Socio.channelType` actually is — narrowing at the call site would be a cast
 * asserting something the database does not guarantee.
 *
 * Two different absences, two different answers:
 *
 *   `undefined`        no channel context at all. Answers true, so callers
 *                      outside the conversational path — the admin prompt
 *                      sandbox, tests exercising gate logic directly — keep
 *                      the pre-existing behaviour.
 *
 *   unrecognised value a channel nobody taught this function about. Answers
 *                      false. If a third channel is added and its gate flow is
 *                      not wired up, skipping the gate leaves learners able to
 *                      progress; honouring it repeats the WhatsApp lock. An
 *                      unnecessarily skipped gate is a smaller failure than a
 *                      dead account, so the unknown case fails that way.
 */
export function canDeliverGatedAssessment(channelType?: string): boolean {
  if (channelType === undefined) return true;
  return channelType === 'web';
}
