/**
 * Which passive analysis a turn is worth
 * ═══════════════════════════════════════════════════════════════════════════
 * Three LLM passes hang off the conversational path besides the reply itself:
 *
 *   sensing            comprehension / confusion, feeds the reteach heuristic
 *   sentiment          confusion / frustration / urgency, feeds auto-flagging
 *   context extraction persistent facts about the participant's business
 *
 * Until this module existed, sensing had a triviality gate and the other two
 * had nothing at all — sentiment fired on every message from an ACTIVE socio,
 * including "ok", "siguiente", and the bare numeric replies to the feedback
 * prompt. Scoring the emotional state of "ok" costs a round trip and returns
 * nothing; extracting business facts from it returns nothing twice.
 *
 * Two rules decide, in order:
 *
 *   1. A message that cannot carry signal gets no analysis at all. This is the
 *      same `isTrivialMessage` the sensing pass already used, applied to all
 *      three rather than one.
 *   2. Otherwise the turn type decides. A learner typing "next" to advance a
 *      lesson is not telling us anything about their comprehension or their
 *      business; a learner explaining what went wrong when they raised prices
 *      is telling us about both.
 *
 * Deliberately NOT in here: the turns that never reach the router at all —
 * onboarding, a paused socio, the numeric reply to a feedback prompt, a socio
 * with no curriculum. `handleIncomingMessage` answers each of those from a
 * fixed string and returns before any analysis is dispatched. Adding a flag
 * here for them would imply those branches might one day fall through, and
 * would be a knob nothing turns.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { InteractionMode } from '@/lib/ai/prompts/types';
import { isTrivialMessage } from '@/lib/ai/sensing/triviality';

export interface AnalysisPolicy {
  /** Score comprehension/confusion into the dimension EMA. */
  sensing: boolean;
  /** Score emotional state and auto-flag past the configured thresholds. */
  sentiment: boolean;
  /** Extract persistent participant facts into SocioContext. */
  contextExtraction: boolean;
}

const NOTHING: AnalysisPolicy = { sensing: false, sentiment: false, contextExtraction: false };

/**
 * Per-mode budget for a substantive message.
 *
 * LESSON_START and REMINDER are turns where the *AI* is doing the talking —
 * the learner's message was "next" or nothing much, and the content of the
 * reply is curriculum. Nothing to sense, nothing to feel, nothing to extract.
 *
 * RETEACH skips extraction only: a learner who did not understand is restating
 * the lesson, not describing their business.
 *
 * GATED_ASSESSMENT runs its own sensing pass inside the assessment path
 * (`ai/assessment/`), with `TrivialityMode: 'assessment'`, because there a
 * terse answer is the thing being graded. Running the chat-path sensing on top
 * would double-score the same message against the wrong triviality rule.
 */
const BY_MODE: Record<InteractionMode, AnalysisPolicy> = {
  [InteractionMode.LESSON_START]: NOTHING,
  [InteractionMode.REMINDER]: NOTHING,
  [InteractionMode.GATED_ASSESSMENT]: NOTHING,

  [InteractionMode.LESSON_DELIVERY]: { sensing: true, sentiment: true, contextExtraction: true },
  [InteractionMode.FREEFORM_QUESTION]: { sensing: true, sentiment: true, contextExtraction: true },
  [InteractionMode.RETEACH]: { sensing: true, sentiment: true, contextExtraction: false },

  // Not routable today (see ROUTABLE_MODES). Given the full budget rather than
  // none, so that wiring one up later fails loud on cost, not silent on signal.
  [InteractionMode.CHECKIN]: { sensing: true, sentiment: true, contextExtraction: true },
  [InteractionMode.MENTOR_HANDOFF]: { sensing: true, sentiment: true, contextExtraction: true },
  [InteractionMode.POST_MENTOR]: { sensing: true, sentiment: true, contextExtraction: true },
};

export function resolveAnalysisPolicy(params: {
  mode: InteractionMode;
  message: string;
}): AnalysisPolicy {
  const { mode, message } = params;

  if (isTrivialMessage(message, 'chat')) return NOTHING;

  return BY_MODE[mode] ?? NOTHING;
}
