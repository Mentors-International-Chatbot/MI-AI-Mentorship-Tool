import { describe, expect, it } from "vitest";
import { lessonBlockSchema } from "@/lib/journey-package/journey-package.schema";
import { aggregateDiagnosticDimensionScores, gradePlayerBlock, matchesExpansionParent, milestoneStates, passingDiagnosticDimensions, PlayerError, sanitizePlayerBlock } from "../service";

const quiz = lessonBlockSchema.parse({
  id: "quiz", order: 1, blockType: "quiz_checkpoint", concepts: ["ai_impact"],
  questions: [{ id: "q1", prompt: "Pick", format: "multiple_choice", options: ["A", "B"], answerKey: "B", explanation: "B is correct", dimensionKey: "ai_impact" }],
});

describe("sequential milestone availability", () => {
  const milestones = [
    { key: "m1", name: "One", availability: { type: "immediate" as const } },
    { key: "m2", name: "Two", availability: { type: "after_milestone" as const, milestoneKey: "m1" } },
    { key: "m3", name: "Three", availability: { type: "after_milestone" as const, milestoneKey: "m2" } },
  ];

  it("shows every milestone but marks only the first as current", () => {
    expect(milestoneStates(milestones, new Set(), new Set()).map((item) => item.status)).toEqual(["current", "locked", "locked"]);
  });

  it("unlocks only the immediate successor on the next snapshot", () => {
    expect(milestoneStates(milestones, new Set(), new Set(["m1"])).map((item) => item.status)).toEqual(["reached", "current", "locked"]);
  });
});

describe("diagnostic dimension aggregation", () => {
  const question = (id: string) => ({ id, dimensionKey: "how_ai_works" });

  it("scores every question in a repeated dimension instead of keeping the last answer", () => {
    expect(aggregateDiagnosticDimensionScores([
      { question: question("q1"), correct: true },
      { question: question("q2"), correct: false },
    ])).toEqual({ how_ai_works: 0.5 });
    expect(aggregateDiagnosticDimensionScores([
      { question: question("q1"), correct: false },
      { question: question("q2"), correct: true },
    ])).toEqual({ how_ai_works: 0.5 });
  });

  it("produces one score per dimension for threshold seeding", () => {
    const scores = aggregateDiagnosticDimensionScores([
      { question: question("q1"), correct: true },
      { question: question("q2"), correct: true },
      { question: { dimensionKey: "working_with_ai" }, correct: true },
      { question: { dimensionKey: "working_with_ai" }, correct: false },
    ]);
    expect(scores).toEqual({ how_ai_works: 1, working_with_ai: 0.5 });
    expect(passingDiagnosticDimensions(scores, 0.75)).toEqual([["how_ai_works", 1]]);
  });
});

describe("expansion parent validation", () => {
  const params = { collectionKey: "ai-essentials", programVersionId: "pv-1", lessonKey: "lesson-1", blockId: "block-1", parentIntent: "teach_back" as const };
  const metadata = { surface: "player", courseCode: "AIESS", ...params, intent: "teach_back" };

  it("requires the same released course, lesson, block, and parent intent", () => {
    expect(matchesExpansionParent(metadata, params)).toBe(true);
    expect(matchesExpansionParent({ ...metadata, programVersionId: "pv-2" }, params)).toBe(false);
    expect(matchesExpansionParent({ ...metadata, blockId: "other" }, params)).toBe(false);
    expect(matchesExpansionParent({ ...metadata, intent: "question" }, params)).toBe(false);
  });
});
const drag = lessonBlockSchema.parse({
  id: "drag", order: 2, blockType: "drag_order", prompt: "Order", items: ["A", "B", "C"], correctOrder: [2, 0, 1],
});

describe("player server grading", () => {
  it("removes answer material from lesson DTO blocks", () => {
    expect(JSON.stringify(sanitizePlayerBlock(quiz))).not.toContain("answerKey");
    expect(JSON.stringify(sanitizePlayerBlock(quiz))).not.toContain("B is correct");
    expect(JSON.stringify(sanitizePlayerBlock(drag))).not.toContain("correctOrder");
  });

  it("completes a submitted quiz regardless of score and returns feedback", () => {
    const result = gradePlayerBlock(quiz, { q1: "A" });
    expect(result).toEqual(expect.objectContaining({ complete: true, score: 0 }));
    expect(result.feedback).toEqual({ questions: [expect.objectContaining({ correct: false, correctAnswer: "B", explanation: "B is correct" })] });
  });

  it("rejects incomplete quiz submissions", () => {
    expect(() => gradePlayerBlock(quiz, {})).toThrow(PlayerError);
  });

  it("keeps drag order incomplete and identifies misplaced positions", () => {
    expect(gradePlayerBlock(drag, [0, 1, 2])).toEqual(expect.objectContaining({ complete: false, feedback: { correct: false, misplacedPositions: [0, 1, 2], correctOrder: undefined } }));
  });

  it("completes drag order only for the exact permutation", () => {
    expect(gradePlayerBlock(drag, [2, 0, 1])).toEqual(expect.objectContaining({ complete: true, score: 1 }));
  });
});
