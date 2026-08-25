type LearnerScoreVisibilityConfig = {
  showScoreToLearner: boolean;
  studentVisibleDimensionKeys: string[];
};

/**
 * The single learner-facing assessment score gate.
 *
 * Stored mentor scores remain complete. Responses first honor the coarse
 * show/hide flag, then the existing per-dimension allowlist.
 */
export function learnerVisibleAssessmentScores(
  config: LearnerScoreVisibilityConfig,
  scores: Record<string, number> | null | undefined,
): Record<string, number> | null {
  if (!config.showScoreToLearner || !scores) return null;
  return Object.fromEntries(
    config.studentVisibleDimensionKeys.flatMap((key) => (
      typeof scores[key] === 'number' ? [[key, scores[key]]] : []
    )),
  );
}
