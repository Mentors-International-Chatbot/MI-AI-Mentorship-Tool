import { describe, expect, it } from "vitest";
import { lessonBlockSchema } from "@/lib/journey-package/journey-package.schema";
import { gradePlayerBlock, PlayerError, sanitizePlayerBlock } from "../service";

const quiz = lessonBlockSchema.parse({
  id: "quiz", order: 1, blockType: "quiz_checkpoint", concepts: ["ai_impact"],
  questions: [{ id: "q1", prompt: "Pick", format: "multiple_choice", options: ["A", "B"], answerKey: "B", explanation: "B is correct", dimensionKey: "ai_impact" }],
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
