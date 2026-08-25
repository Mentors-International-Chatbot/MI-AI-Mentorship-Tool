import type { ProgramVersionConfig } from "./program-version-config.schema";
import type { BlockAssessmentOverride, PassingConfig } from "./journey-package.schema";

export type MergedAssessmentConfig = {
  passing: {
    dimensionKey: string;
    threshold: number;
    confidenceFloor: number;
    minTurns: number;
    maxTurns: number;
  };
  allowRetake: boolean;
  showScoreToLearner: boolean;
};

/**
 * The single per-block assessment-config merge.
 *
 * `legacyPassingOverride` preserves gated_session teach-backs authored before
 * block.assessment existed. New assessment.passingOverride values win field by
 * field when both shapes are present; neither can erase a populated value with
 * undefined.
 */
export function mergeAssessmentConfig(
  base: NonNullable<ProgramVersionConfig["assessment"]>,
  override?: BlockAssessmentOverride,
  legacyPassingOverride?: Partial<PassingConfig>,
): MergedAssessmentConfig {
  return {
    passing: {
      dimensionKey: override?.passingOverride?.dimensionKey
        ?? legacyPassingOverride?.dimensionKey
        ?? base.passing.dimensionKey,
      threshold: override?.passingOverride?.threshold
        ?? legacyPassingOverride?.threshold
        ?? base.passing.threshold,
      confidenceFloor: override?.passingOverride?.confidenceFloor
        ?? legacyPassingOverride?.confidenceFloor
        ?? base.passing.confidenceFloor
        ?? 0.5,
      minTurns: override?.passingOverride?.minTurns
        ?? legacyPassingOverride?.minTurns
        ?? base.passing.minTurns
        ?? 2,
      maxTurns: override?.passingOverride?.maxTurns
        ?? legacyPassingOverride?.maxTurns
        ?? base.passing.maxTurns
        ?? 12,
    },
    allowRetake: override?.allowRetake ?? base.allowRetake ?? true,
    showScoreToLearner: override?.showScoreToLearner ?? base.showScoreToLearner ?? false,
  };
}
