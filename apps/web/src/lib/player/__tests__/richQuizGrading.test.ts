import { describe, expect, it } from "vitest";
import { lessonBlockSchema } from "@/lib/journey-package/journey-package.schema";
import { gradePlayerBlock, sanitizePlayerBlock } from "../service";

const block = lessonBlockSchema.parse({
  id: "rich", order: 1, blockType: "quiz_checkpoint", title: "Rich quiz",
  assessment: { mode: "web_quiz", webQuizPassingScore: 0.75, showScoreToLearner: true },
  questions: [
    { id: "mc", prompt: "Pick A", format: "multiple_choice", options: ["A", "B"], answerKey: "A", explanation: "A." },
    { id: "fill", prompt: "Next ___", format: "fill_in_blank", answerKey: ["token", "word"], explanation: "Token." },
    { id: "order", prompt: "Order", format: "drag_to_order", options: ["Check", "Send", "Collect"], answerKey: ["Collect", "Check", "Send"], explanation: "Order." },
    {
      id: "match", prompt: "Match", format: "matching",
      matchingPrompts: [{ id: "train", text: "Training" }, { id: "infer", text: "Inference" }],
      options: ["Use", "Build"], answerKey: { train: "Build", infer: "Use" }, explanation: "Match.",
    },
  ],
});

const packageAssessment = {
  passing: { dimensionKey: "comprehension", threshold: 7, confidenceFloor: 0.5, minTurns: 2, maxTurns: 12 },
  allowRetake: true,
  blocking: true,
  onMaxTurnsWithoutPass: "complete_with_scores" as const,
  autoAppendTeachBack: false,
  showScoreToLearner: true,
  webQuizPassingScore: 1,
};

const threeOfFour = {
  mc: "A",
  fill: "TOKEN",
  order: ["Collect", "Check", "Send"],
  match: { train: "Use", infer: "Build" },
};

describe("rich web quiz aggregation", () => {
  it("uses equal, binary question weights and passes at the normalized threshold", () => {
    const result = gradePlayerBlock(block, threeOfFour, 1, undefined, packageAssessment);
    expect(result.complete).toBe(true);
    expect(result.score).toBe(0.75);
    expect(result.feedback).toEqual(expect.objectContaining({
      kind: "quiz", correct: false, passed: true, retryAvailable: false,
    }));
  });

  it("keeps a below-threshold block open after arbitrarily many attempts", () => {
    const result = gradePlayerBlock(block, { ...threeOfFour, order: ["Collect", "Send", "Check"] }, 10_000, undefined, packageAssessment);
    expect(result.complete).toBe(false);
    expect(result.score).toBe(0.5);
    expect(result.feedback).toEqual(expect.objectContaining({
      kind: "quiz", correct: false, retryAvailable: true,
    }));
    expect(JSON.stringify(result.feedback)).not.toContain("Build");
    expect(JSON.stringify(result.feedback)).not.toContain("Collect,Check,Send");
  });

  it("lets the block threshold override the package default", () => {
    expect(gradePlayerBlock(block, threeOfFour, 1, undefined, packageAssessment).complete).toBe(true);
  });

  it("rejects malformed structured responses", () => {
    expect(() => gradePlayerBlock(block, { ...threeOfFour, match: { train: "Use", infer: "Use" } }, 1, undefined, packageAssessment)).toThrow("invalid");
    expect(() => gradePlayerBlock(block, { ...threeOfFour, order: ["Collect", "Collect", "Send"] }, 1, undefined, packageAssessment)).toThrow("invalid");
  });

  it("redacts every answer shape and rotates an accidentally solved initial order", () => {
    const solvedFirst = lessonBlockSchema.parse({
      id: "solved", order: 1, blockType: "quiz_checkpoint", assessment: { mode: "web_quiz" },
      questions: [{ id: "order", prompt: "Order", format: "drag_to_order", options: ["A", "B", "C"], answerKey: ["A", "B", "C"], explanation: "ABC." }],
    });
    const safe = sanitizePlayerBlock(solvedFirst) as { questions: Array<Record<string, unknown>> };
    expect(safe.questions[0]).not.toHaveProperty("answerKey");
    expect(safe.questions[0]).not.toHaveProperty("explanation");
    expect(safe.questions[0].options).toEqual(["B", "C", "A"]);

    expect(JSON.stringify(sanitizePlayerBlock(block))).not.toContain("Building a model");
    expect(JSON.stringify(sanitizePlayerBlock(block))).not.toContain('"train":"Build"');
  });
});
