import { describe, expect, it } from "vitest";
import { mergeAssessmentConfig } from "../mergeAssessmentConfig";

const base = {
  passing: {
    dimensionKey: "comprehension",
    threshold: 7,
    confidenceFloor: 0.5,
    minTurns: 2,
    maxTurns: 12,
  },
  allowRetake: true,
  blocking: true,
  onMaxTurnsWithoutPass: "complete_with_scores" as const,
  autoAppendTeachBack: false,
  showScoreToLearner: false,
};

describe("mergeAssessmentConfig", () => {
  it("inherits package defaults when a block has no override", () => {
    expect(mergeAssessmentConfig(base)).toEqual({
      passing: base.passing,
      allowRetake: true,
      showScoreToLearner: false,
    });
  });

  it("merges new block assessment overrides field by field", () => {
    expect(mergeAssessmentConfig(base, {
      mode: "reteach_gate",
      passingOverride: { threshold: 8, minTurns: 3 },
      allowRetake: false,
      showScoreToLearner: true,
    })).toEqual({
      passing: { ...base.passing, threshold: 8, minTurns: 3 },
      allowRetake: false,
      showScoreToLearner: true,
    });
  });

  it("preserves legacy passingOverride while giving the new field precedence", () => {
    expect(mergeAssessmentConfig(
      base,
      { mode: "reteach_gate", passingOverride: { threshold: 9 } },
      { threshold: 8, maxTurns: 5 },
    ).passing).toEqual({
      ...base.passing,
      threshold: 9,
      maxTurns: 5,
    });
  });
});
