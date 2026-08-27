/**
 * E.5.2: threshold: 0 alone does not produce an always-pass reteach_gate —
 * checkPassCondition ANDs turnCount/minTurns, level/threshold, AND
 * confidence/confidenceFloor independently, and confidenceFloor defaults to
 * 0.5 while early-turn sensed confidence is typically 0.2 or lower. Pins the
 * exact behavior blocks 1.4/6.3 depend on: threshold 0 + confidenceFloor 0
 * passes genuinely once minTurns is met, and confidenceFloor left at its
 * default does not — a regression guard for the bug this stage fixes.
 */
import { describe, expect, it } from "vitest";
import { checkPassCondition } from "../runAssessmentTurn";
import { buildPassedClosingMessage, buildMaxTurnsClosingMessage } from "../buildAssessmentPrompt";
import { mergeAssessmentConfig } from "@/lib/journey-package/mergeAssessmentConfig";
import { journeyPackageSchema } from "@/lib/journey-package/journey-package.schema";
import { aiEssentialsAug2026Package } from "@/lib/journey-package/examples/ai-essentials-aug2026-package";
import type { DimensionState } from "@/lib/ai/sensing/types";

const parsedPackage = journeyPackageSchema.parse(aiEssentialsAug2026Package);

function lowConfidenceState(overrides: Partial<DimensionState> = {}): Record<string, DimensionState> {
  return {
    comprehension: {
      dimensionKey: "comprehension", level: 3, trend: "flat",
      confidence: 0.2, evidence: "early turn, low certainty", updatedAt: new Date(),
      ...overrides,
    },
  };
}

const UNGRADED_PASSING = { dimensionKey: "comprehension", threshold: 0, confidenceFloor: 0, minTurns: 3, maxTurns: 5 };
const DEFAULT_FLOOR_PASSING = { dimensionKey: "comprehension", threshold: 0, confidenceFloor: 0.5, minTurns: 3, maxTurns: 5 };

describe("checkPassCondition — ungraded gate (threshold: 0, confidenceFloor: 0)", () => {
  it("passes genuinely at low confidence once minTurns is met, when confidenceFloor is explicitly 0", () => {
    expect(checkPassCondition(lowConfidenceState(), UNGRADED_PASSING, 3)).toBe(true);
  });

  it("does NOT pass before minTurns, even with threshold/confidenceFloor both 0", () => {
    expect(checkPassCondition(lowConfidenceState(), UNGRADED_PASSING, 2)).toBe(false);
  });

  it("regression guard: threshold 0 alone (confidenceFloor left at the 0.5 default) does NOT pass at realistic early-turn confidence", () => {
    expect(checkPassCondition(lowConfidenceState(), DEFAULT_FLOOR_PASSING, 3)).toBe(false);
  });

  it("threshold 0 alone eventually passes once confidence happens to clear the default 0.5 floor", () => {
    expect(checkPassCondition(lowConfidenceState({ confidence: 0.6 }), DEFAULT_FLOOR_PASSING, 3)).toBe(true);
  });
});

describe("Block 1.4 and 6.3 — authored config merges to the intended always-pass, score-hidden shape", () => {
  const packageAssessment = parsedPackage.config.assessment;
  const lesson1 = parsedPackage.curriculum.lessons.find((l) => l.key === "lesson-1")!;
  const finalLesson = parsedPackage.curriculum.lessons.find((l) => l.key === "final-project");
  const block1_4Raw = lesson1.blocks.find((b) => b.id === "b1-4");
  const block1_4 = block1_4Raw?.blockType === "teach_back" ? block1_4Raw : undefined;
  const block6_3Raw = finalLesson?.blocks.find((b) => b.id === "b6-3");
  const block6_3 = block6_3Raw?.blockType === "teach_back" ? block6_3Raw : undefined;

  it("block 1.4 is authored as teach_back + reteach_gate with threshold/confidenceFloor both 0 and showScoreToLearner false", () => {
    expect(block1_4).toBeDefined();
    expect(block1_4?.assessment?.mode).toBe("reteach_gate");
    expect(block1_4?.assessment?.showScoreToLearner).toBe(false);
    expect(block1_4?.passingOverride).toMatchObject({ threshold: 0, confidenceFloor: 0 });
  });

  it("block 6.3 has confidenceFloor: 0 and showScoreToLearner: false set (the two gaps this stage fixes)", () => {
    expect(block6_3).toBeDefined();
    expect(block6_3?.assessment?.showScoreToLearner).toBe(false);
    expect(block6_3?.passingOverride).toMatchObject({ threshold: 0, confidenceFloor: 0 });
  });

  it("mergeAssessmentConfig resolves block 1.4's authored config to a genuinely always-pass, score-hidden merged shape", () => {
    if (!packageAssessment || !block1_4?.assessment) throw new Error("fixture missing config.assessment");
    const merged = mergeAssessmentConfig(packageAssessment, block1_4.assessment, block1_4.passingOverride);
    expect(merged.passing.threshold).toBe(0);
    expect(merged.passing.confidenceFloor).toBe(0);
    expect(merged.showScoreToLearner).toBe(false);
  });

  it("mergeAssessmentConfig resolves block 6.3's authored config the same way", () => {
    if (!packageAssessment || !block6_3?.assessment) throw new Error("fixture missing config.assessment");
    const merged = mergeAssessmentConfig(packageAssessment, block6_3.assessment, block6_3.passingOverride);
    expect(merged.passing.threshold).toBe(0);
    expect(merged.passing.confidenceFloor).toBe(0);
    expect(merged.showScoreToLearner).toBe(false);
  });
});

describe("showScoreToLearner: false suppresses numeric scores in both closing-message paths (framing itself is a reported, not-fixed gap)", () => {
  const scores = { comprehension: 7.3 };

  it("buildPassedClosingMessage omits the numeric score when showScoreToLearner is false", () => {
    const prompt = buildPassedClosingMessage({
      aiBehavior: {}, studentVisibleScores: scores, passingDimensionKey: "comprehension", showScoreToLearner: false,
    });
    expect(prompt).not.toContain("7.3");
    expect(prompt).toContain("DO NOT mention, estimate, or imply a numeric score");
  });

  it("buildMaxTurnsClosingMessage omits the numeric score when showScoreToLearner is false", () => {
    const prompt = buildMaxTurnsClosingMessage({
      aiBehavior: {}, onMaxTurnsPolicy: "complete_with_scores", studentVisibleScores: scores, showScoreToLearner: false,
    });
    expect(prompt).not.toContain("7.3");
    expect(prompt).toContain("DO NOT show scores");
  });
});
