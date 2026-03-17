import { analyzeSentiment } from '@/lib/sentiment/analyzer';
import { repo } from '@/lib/repo';
import { getConfigNumber } from '@/lib/config/service';

/**
 * Runs sentiment analysis on a user message and auto-flags if thresholds are exceeded.
 * Designed to be called fire-and-forget (don't block the AI response).
 */
export async function analyzeSentimentAndFlag(
  messageId: string,
  socioId: string,
  message: string,
): Promise<void> {
  const result = await analyzeSentiment(message);

  await repo.saveSentiment({
    messageId,
    socioId,
    confusion: result.confusion,
    frustration: result.frustration,
    urgency: result.urgency,
    sentiment: result.sentiment,
    topics: result.topics,
  });

  // Read thresholds from ProgramConfig (falls back to defaults)
  const [urgencyRed, confusionYellow, frustrationYellow] = await Promise.all([
    getConfigNumber('SENTIMENT_URGENCY_RED').catch(() => 8),
    getConfigNumber('SENTIMENT_CONFUSION_YELLOW').catch(() => 7),
    getConfigNumber('SENTIMENT_FRUSTRATION_YELLOW').catch(() => 7),
  ]);

  // Auto-flag based on thresholds
  if (result.urgency >= urgencyRed || result.sentiment === 'distressed') {
    await repo.createFlag({
      socioId,
      level: 'RED',
      reason: `Detección automática: urgencia=${result.urgency}, sentimiento=${result.sentiment}`,
      source: 'sentiment_auto',
      messageId,
    });
  } else if (result.confusion >= confusionYellow || result.frustration >= frustrationYellow) {
    await repo.createFlag({
      socioId,
      level: 'YELLOW',
      reason: `Detección automática: confusión=${result.confusion}, frustración=${result.frustration}`,
      source: 'sentiment_auto',
      messageId,
    });
  }
}
