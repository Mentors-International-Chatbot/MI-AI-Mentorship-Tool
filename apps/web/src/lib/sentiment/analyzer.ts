/**
 * Sentiment shape and validators
 * ═══════════════════════════════════════════════════════════════════════════
 * This module used to own a Haiku call scoring a learner's message for
 * confusion, frustration and urgency. That call is gone: it asked the same
 * model about the same sentence that the sensing pass was already asking
 * about, so the two were merged into `ai/sensing/senseAndScore.ts`. What is
 * left here is the contract both halves of the system still agree on — the
 * result shape and the clamps that keep a model's output inside it.
 *
 * The prompt text moved with the call. The `sentiment` prompt category is
 * still the override point, and is still platform-scoped for the reason it
 * always was: its output is parsed as data that drives auto-flagging.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface SentimentResult {
  confusion: number;    // 0-10
  frustration: number;  // 0-10
  urgency: number;      // 0-10
  sentiment: 'positive' | 'neutral' | 'negative' | 'distressed';
  topics: string[];
}

/** What a caller records when the model gave nothing usable. */
export const DEFAULT_RESULT: SentimentResult = {
  confusion: 0,
  frustration: 0,
  urgency: 0,
  sentiment: 'neutral',
  topics: ['other'],
};

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function validateSentiment(s: unknown): SentimentResult['sentiment'] {
  const valid = ['positive', 'neutral', 'negative', 'distressed'];
  return valid.includes(s as string) ? (s as SentimentResult['sentiment']) : 'neutral';
}
