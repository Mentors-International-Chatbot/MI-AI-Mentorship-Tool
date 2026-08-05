import { analyzeSentiment } from '@/lib/sentiment/analyzer';
import { repo } from '@/lib/repo';
import { getConfigNumber } from '@/lib/config/service';
import type { FlagReasonParams } from '@/lib/repo/types';

/**
 * The analyzer always returns at least one topic, and falls back to `['other']`
 * when it has nothing to say. Neither that nor an empty list is worth showing a
 * mentor, so we drop the key rather than render "topics: other".
 */
function usefulTopics(topics: string[]): string[] | undefined {
    if (topics.length === 0) return undefined;
    if (topics.length === 1 && topics[0] === 'other') return undefined;
    return topics;
}

/**
 * Fallback `reason` text for readers that predate reasonCode. Deliberately a
 * language-free key=value line, not a sentence: the rendered wording now comes
 * from the dashboard i18n table.
 */
function fallbackReason(params: Record<string, string | number | undefined>): string {
    return Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
}

/**
 * Runs sentiment analysis on a user message and auto-flags if thresholds are exceeded.
 * Designed to be called fire-and-forget (don't block the AI response).
 */
export async function analyzeSentimentAndFlag(
  messageId: string,
  socioId: string,
  message: string,
): Promise<void> {
  const result = await analyzeSentiment(message, socioId);

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

  const topics = usefulTopics(result.topics);

  // Auto-flag based on thresholds.
  if (result.urgency >= urgencyRed || result.sentiment === 'distressed') {
    // Urgency wins when it crossed; `distressed` is the reason only when
    // urgency stayed under the line and the mood alone raised the flag.
    const byUrgency = result.urgency >= urgencyRed;
    const params: FlagReasonParams = {
      urgency: result.urgency,
      threshold: urgencyRed,
      sentiment: result.sentiment,
      ...(topics ? { topics } : {}),
    };

    await repo.createFlag({
      socioId,
      level: 'RED',
      reason: fallbackReason({
        urgency: result.urgency,
        threshold: urgencyRed,
        sentiment: result.sentiment,
        topics: topics?.join(','),
      }),
      reasonCode: byUrgency ? 'sentiment.urgency_high' : 'sentiment.distressed',
      reasonParams: params,
      source: 'sentiment_auto',
      messageId,
    });
    return;
  }

  // Report only the signal that actually crossed. When both did, the one that
  // cleared its threshold by the wider margin is the more useful headline;
  // confusion breaks an exact tie.
  const confusionMargin = result.confusion - confusionYellow;
  const frustrationMargin = result.frustration - frustrationYellow;
  const confusionCrossed = confusionMargin >= 0;
  const frustrationCrossed = frustrationMargin >= 0;

  if (!confusionCrossed && !frustrationCrossed) return;

  const reportConfusion = confusionCrossed && (!frustrationCrossed || confusionMargin >= frustrationMargin);
  const value = reportConfusion ? result.confusion : result.frustration;
  const threshold = reportConfusion ? confusionYellow : frustrationYellow;
  const signal = reportConfusion ? 'confusion' : 'frustration';

  await repo.createFlag({
    socioId,
    level: 'YELLOW',
    reason: fallbackReason({ [signal]: value, threshold, topics: topics?.join(',') }),
    reasonCode: reportConfusion
      ? 'sentiment.confusion_elevated'
      : 'sentiment.frustration_elevated',
    reasonParams: { value, threshold, ...(topics ? { topics } : {}) },
    source: 'sentiment_auto',
    messageId,
  });
}
