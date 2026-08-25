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
  webQuizPassingScore: 0.7,
};

describe("mergeAssessmentConfig", () => {
  it("inherits package defaults when a block has no override", () => {
    expect(mergeAssessmentConfig(base)).toEqual({
      passing: base.passing,
      allowRetake: true,
      showScoreToLearner: false,
      webQuizPassingScore: 0.7,
    });
  });

  it("merges new block assessment overrides field by field", () => {
    expect(mergeAssessmentConfig(base, {
      mode: "reteach_gate",
      passingOverride: { threshold: 8, minTurns: 3 },
      allowRetake: false,
      showScoreToLearner: true,
      webQuizPassingScore: 0.7,
    })).toEqual({
      passing: { ...base.passing, threshold: 8, minTurns: 3 },
      allowRetake: false,
      showScoreToLearner: true,
      webQuizPassingScore: 0.7,
    });
  });

  it("lets a web quiz override the normalized package passing score", () => {
    expect(mergeAssessmentConfig(base, {
      mode: "web_quiz",
      webQuizPassingScore: 0.8,
    }).webQuizPassingScore).toBe(0.8);
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
