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
  webQuizMaxAttempts: 2,
};

describe("mergeAssessmentConfig", () => {
  it("inherits package defaults when a block has no override", () => {
    expect(mergeAssessmentConfig(base)).toEqual({
      passing: base.passing,
      allowRetake: true,
      showScoreToLearner: false,
      webQuizPassingScore: 0.7,
      webQuizMaxAttempts: 2,
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
      webQuizMaxAttempts: 2,
    });
  });

  it("lets a web quiz override the package's attempt cap", () => {
    expect(mergeAssessmentConfig(base, {
      mode: "web_quiz",
      webQuizMaxAttempts: 5,
    }).webQuizMaxAttempts).toBe(5);
  });

  it("falls back to 2 — the plain quiz_checkpoint QUIZ_ATTEMPT_LIMIT precedent — when neither package nor block configures it", () => {
    // Simulates a config stored before this field existed — real provenance
    // the `?? 2` fallback in mergeAssessmentConfig.ts exists to handle,
    // same as webQuizPassingScore's own `?? 1` above it.
    const { webQuizMaxAttempts, ...legacyBase } = base;
    void webQuizMaxAttempts;
    expect(mergeAssessmentConfig(legacyBase as typeof base).webQuizMaxAttempts).toBe(2);
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
