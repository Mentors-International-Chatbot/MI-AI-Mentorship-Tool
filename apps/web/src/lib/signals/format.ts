import type { DashboardStrings } from '@/lib/i18n/dashboard';
import type { PositiveSignal } from './positive';

/**
 * Renders a {@link PositiveSignal} in the dashboard viewer's language.
 *
 * The render-layer half of the split, mirroring `formatHealthReason`:
 * `derivePositiveSignals` decides *what happened*, this decides how to say it.
 * Exhaustive over the union — adding a signal kind without a string is a
 * compile error, not a blank line in the good-news list.
 */
export function formatPositiveSignal(signal: PositiveSignal, t: DashboardStrings): string {
  switch (signal.kind) {
    case 'gate_passed_first_try':
      return t.positiveGatePassedFirstTry(signal.lessonKey);
    case 'lesson_completed':
      return t.positiveLessonCompleted(signal.lessonNumber);
    case 'returned_after_quiet':
      return t.positiveReturnedAfterQuiet(signal.daysQuiet);
    case 'sustained_positive':
      return t.positiveSustainedSentiment(signal.positiveCount);
  }
}

/** Emoji marker for the compact zone-3 list. One per kind, same exhaustiveness. */
export function positiveSignalIcon(signal: PositiveSignal): string {
  switch (signal.kind) {
    case 'gate_passed_first_try':
      return '🎯';
    case 'lesson_completed':
      return '✅';
    case 'returned_after_quiet':
      return '👋';
    case 'sustained_positive':
      return '🌱';
  }
}
