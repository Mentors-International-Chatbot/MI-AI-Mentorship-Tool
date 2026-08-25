import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { learnerVisibleAssessmentScores } from "../learnerVisibility";

const scores = { comprehension: 8.5, confidence: 6, hidden_dimension: 9 };

describe("learnerVisibleAssessmentScores", () => {
  it("suppresses the complete score object when showScoreToLearner is false", () => {
    expect(learnerVisibleAssessmentScores({
      showScoreToLearner: false,
      studentVisibleDimensionKeys: ["comprehension"],
    }, scores)).toBeNull();
  });

  it("applies the dimension allowlist after the coarse visibility gate", () => {
    expect(learnerVisibleAssessmentScores({
      showScoreToLearner: true,
      studentVisibleDimensionKeys: ["comprehension", "confidence"],
    }, scores)).toEqual({ comprehension: 8.5, confidence: 6 });
  });

  it("never turns a missing stored score object into visible data", () => {
    expect(learnerVisibleAssessmentScores({
      showScoreToLearner: true,
      studentVisibleDimensionKeys: ["comprehension"],
    }, null)).toBeNull();
  });

  it("is the response gate used by GET, message, and complete routes", () => {
    const routeRoot = resolve(process.cwd(), "src/app/api/assessment/[sessionId]");
    for (const relative of ["route.ts", "message/route.ts", "complete/route.ts"]) {
      const source = readFileSync(resolve(routeRoot, relative), "utf8");
      expect(source).toContain("learnerVisibleAssessmentScores(");
    }
  });
});
