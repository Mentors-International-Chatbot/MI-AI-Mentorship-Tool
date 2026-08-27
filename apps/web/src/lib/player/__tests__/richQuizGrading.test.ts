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
  webQuizMaxAttempts: 3,
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

  it("keeps a below-threshold block open and redacted before the attempt cap", () => {
    const result = gradePlayerBlock(block, { ...threeOfFour, order: ["Collect", "Send", "Check"] }, 2, undefined, packageAssessment);
    expect(result.complete).toBe(false);
    expect(result.score).toBe(0.5);
    expect(result.feedback).toEqual(expect.objectContaining({
      kind: "quiz", correct: false, retryAvailable: true,
    }));
    expect(JSON.stringify(result.feedback)).not.toContain("Build");
    expect(JSON.stringify(result.feedback)).not.toContain("Collect,Check,Send");
  });

  it("caps, reveals, and completes on the attempt the cap is reached — never permanently stuck", () => {
    const result = gradePlayerBlock(block, { ...threeOfFour, order: ["Collect", "Send", "Check"] }, packageAssessment.webQuizMaxAttempts, undefined, packageAssessment);
    expect(result.complete).toBe(true);
    expect(result.score).toBe(0.5);
    expect(result.feedback).toEqual(expect.objectContaining({
      kind: "quiz", correct: false, passed: false, retryAvailable: false,
    }));
    expect(JSON.stringify(result.feedback)).toContain("Build");
    expect(JSON.stringify(result.feedback)).toContain('["Collect","Check","Send"]');
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

describe("fill_in_blank word bank", () => {
  const bankBlock = lessonBlockSchema.parse({
    id: "bank", order: 1, blockType: "quiz_checkpoint", title: "Word bank quiz",
    assessment: { mode: "web_quiz" },
    questions: [{
      id: "fill", prompt: "Physical labor-saving led to physical atrophy, which is why ___ became popular.",
      format: "fill_in_blank", answerKey: "Gyms", explanation: "Gyms.",
      wordBank: ["Gyms", "Home cooking", "Public transit", "Reading"],
    }],
  });

  it("grades a bank-selected answer through the exact same path as typed free text — no grading changes needed", () => {
    // The correct chip's own label, submitted verbatim (what QuizQuestionField
    // sends onChange), grades identically to a learner who typed "Gyms".
    const correct = gradePlayerBlock(bankBlock, { fill: "Gyms" }, 1, undefined, packageAssessment);
    expect(correct.feedback).toEqual(expect.objectContaining({ correct: true }));

    const wrong = gradePlayerBlock(bankBlock, { fill: "Reading" }, 1, undefined, packageAssessment);
    expect(wrong.feedback).toEqual(expect.objectContaining({ correct: false }));
  });

  it("shuffles the word bank on sanitize, same as multiple_choice options, and still redacts the answer key", () => {
    const safe = sanitizePlayerBlock(bankBlock) as { questions: Array<Record<string, unknown>> };
    expect(safe.questions[0]).not.toHaveProperty("answerKey");
    expect(safe.questions[0]).not.toHaveProperty("explanation");
    expect(safe.questions[0].wordBank).toEqual(expect.arrayContaining(["Gyms", "Home cooking", "Public transit", "Reading"]));
    expect((safe.questions[0].wordBank as string[])).toHaveLength(4);
  });

  it("leaves a fill_in_blank question with no wordBank untouched by the shuffle", () => {
    const safe = sanitizePlayerBlock(block) as { questions: Array<Record<string, unknown>> };
    const fillQuestion = safe.questions.find((q) => q.id === "fill")!;
    expect(fillQuestion).not.toHaveProperty("wordBank");
  });
});
