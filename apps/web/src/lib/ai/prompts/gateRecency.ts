/**
 * Gate recency — what just happened, as distinct from what has ever happened
 * ═══════════════════════════════════════════════════════════════════════════
 * Stance already reads gate state, but it asks a durable question: has this
 * learner passed, ever. That is the right input for choosing a posture and the
 * wrong input for choosing what to say. A learner who passed a teach-back three
 * lessons ago and a learner who passed one thirty seconds ago are the same fact
 * to `readGateEvidence` and completely different conversations.
 *
 * The observed symptom: a learner passed a gate, the result card rendered, and
 * the conversation went silent until they typed "yay! Am i done?". The reply
 * was reasonable — stance was coach, so the posture was right — but the model
 * was inferring from the gate prompt sitting in its history, not from being
 * told. The assessment transcript is invisible to it: `prismaRepo.getMessages`
 * filters `assessmentSessionId: null`, so every teach-back turn and the score
 * report are excluded from the conversational history by design.
 *
 * ── What "this turn" means ────────────────────────────────────────────────
 * Not wall-clock. A gate is news if it resolved AFTER THE AI LAST SPOKE in the
 * main thread, because that is exactly the window in which the AI has not yet
 * had a chance to acknowledge it. That definition self-clears: once the AI
 * responds, its own message becomes the new reference point and the gate stops
 * being news on the following turn. No flag to set, no state to persist, no
 * way for the two to drift apart.
 *
 * It also gets the pre-existing case right. Before the follow-up turn exists,
 * the last main-thread assistant message is the gate card itself, posted before
 * the assessment began — so a resolved gate is correctly news when the learner
 * types in unprompted.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { getLessonData, hasLessonData } from '@/lib/lessons/db-lesson-service';
import { canDeliverGatedAssessment } from '@/lib/ai/assessment/channelSupport';
import type { GateSessionLoader } from './gateSessions';

export interface GateRecency {
  /** The lesson whose gate resolved. */
  lessonNumber: number;
  /** `passedAt !== null` on the session that resolved. */
  outcome: 'passed' | 'not_passed';
  /**
   * True when the gate resolved after the AI's last main-thread message, i.e.
   * the AI has not acknowledged it yet.
   */
  justResolved: boolean;
}

/**
 * Reads the most recent gate resolution for a lesson, and whether it is news.
 *
 * Returns null — meaning "there is nothing to say about a gate" — when the
 * lesson has no gates, when the channel cannot deliver one (see
 * `channelSupport.ts`), or when no attempt has been completed yet. A null is
 * rendered as no line at all rather than as "not yet attempted", because the
 * absence of a gate result is not a fact worth spending prompt tokens on.
 *
 * `loadLastAssistantAt` is a thunk rather than a value so the query is only
 * paid on turns that actually have a completed session to date. Most turns
 * return before reaching it.
 */
export async function readGateRecency(params: {
  collectionKey: string;
  lessonNumber: number;
  loadGateSessions: GateSessionLoader;
  loadLastAssistantAt: () => Promise<Date | null>;
  channelType?: string;
}): Promise<GateRecency | null> {
  const { collectionKey, lessonNumber, loadGateSessions, loadLastAssistantAt, channelType } = params;

  if (!hasLessonData(collectionKey, lessonNumber)) return null;
  if (!canDeliverGatedAssessment(channelType)) return null;

  const lesson = getLessonData(collectionKey, lessonNumber);
  if (lesson.gates.length === 0) return null;

  // Every gate on the lesson, then the single most recently resolved session
  // across all of them. With retakes a gate can have several completed
  // sessions; with several gates the lesson can have several too. The one that
  // resolved last is the one the learner just lived through.
  const perGate = await Promise.all(
    lesson.gates.map((gate) => loadGateSessions(lesson.lessonKey, gate.blockId)),
  );

  let latest: { completedAt: Date; passed: boolean } | null = null;
  for (const sessions of perGate) {
    for (const session of sessions) {
      if (session.status !== 'completed' || !session.completedAt) continue;
      if (latest === null || session.completedAt > latest.completedAt) {
        latest = { completedAt: session.completedAt, passed: session.passedAt !== null };
      }
    }
  }

  if (!latest) return null;

  const lastAssistantAt = await loadLastAssistantAt();

  return {
    lessonNumber,
    outcome: latest.passed ? 'passed' : 'not_passed',
    // No prior assistant message at all means the AI has said nothing since the
    // gate resolved, so it is news.
    justResolved: lastAssistantAt === null || latest.completedAt > lastAssistantAt,
  };
}
