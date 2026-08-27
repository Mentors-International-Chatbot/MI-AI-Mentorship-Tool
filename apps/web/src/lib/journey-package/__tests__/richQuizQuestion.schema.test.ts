import { describe, expect, it } from "vitest";
import { journeyPackageSchema, quizQuestionSchema } from "../journey-package.schema";

const fill = {
  id: "fill", prompt: "An AI model predicts the next ___.", format: "fill_in_blank" as const,
  answerKey: ["token", "word"], explanation: "Models predict tokens.",
};
const order = {
  id: "order", prompt: "Put the workflow in order.", format: "drag_to_order" as const,
  options: ["Check", "Send", "Collect"], answerKey: ["Collect", "Check", "Send"],
  explanation: "Collect, check, then send.",
};
const matching = {
  id: "match", prompt: "Match each term.", format: "matching" as const,
  matchingPrompts: [{ id: "training", text: "Training" }, { id: "inference", text: "Inference" }],
  options: ["Using a model", "Building a model"],
  answerKey: { training: "Building a model", inference: "Using a model" },
  explanation: "Training builds; inference uses.",
};

describe("rich quiz question schema", () => {
  it.each([fill, order, matching])("accepts $format", (question) => {
    expect(quizQuestionSchema.safeParse(question).success).toBe(true);
  });

  it("normalizes fill variants when checking uniqueness", () => {
    const result = quizQuestionSchema.safeParse({ ...fill, answerKey: ["Token", "  TOKEN "] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("accepted answers must be unique");
  });

  it("accepts a fill_in_blank question with a word bank that covers every accepted answer", () => {
    const result = quizQuestionSchema.safeParse({ ...fill, wordBank: ["token", "word", "sentence", "letter"] });
    expect(result.success).toBe(true);
  });

  it("accepts a word bank with no distractors — just the accepted answer(s)", () => {
    const result = quizQuestionSchema.safeParse({
      id: "fill2", prompt: "Complete it: ___.", format: "fill_in_blank" as const,
      answerKey: "Gyms", explanation: "Gyms.", wordBank: ["Gyms"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a word bank missing one of the accepted answers", () => {
    const result = quizQuestionSchema.safeParse({ ...fill, wordBank: ["sentence", "letter"] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("must include every accepted answerKey value");
  });

  it("rejects duplicate word bank entries after normalization", () => {
    const result = quizQuestionSchema.safeParse({ ...fill, wordBank: ["token", "word", "Token"] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("wordBank entries must be unique");
  });

  it("rejects an empty word bank", () => {
    const result = quizQuestionSchema.safeParse({ ...fill, wordBank: [] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("must not be empty");
  });

  it("rejects a word bank on any format other than fill_in_blank", () => {
    const result = quizQuestionSchema.safeParse({ ...order, wordBank: ["Check", "Send"] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("only valid on fill_in_blank");
  });

  it("still allows a fill_in_blank question with no word bank — the free-text fallback", () => {
    expect(quizQuestionSchema.safeParse(fill).success).toBe(true);
    expect(quizQuestionSchema.parse(fill)).not.toHaveProperty("wordBank");
  });

  it("requires a complete drag permutation", () => {
    const result = quizQuestionSchema.safeParse({ ...order, answerKey: ["Collect", "Collect", "Send"] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("complete, duplicate-free permutation");
  });

  it("requires a complete one-to-one matching map", () => {
    const result = quizQuestionSchema.safeParse({ ...matching, answerKey: { training: "Building a model" } });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("map every prompt id");
  });

  it("forbids keys on ungraded rich questions", () => {
    const result = quizQuestionSchema.safeParse({ ...fill, graded: false });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("must not declare an answerKey");
  });

  it("preserves the permissive short_answer shape", () => {
    expect(quizQuestionSchema.parse({ id: "short", prompt: "Say something", format: "short_answer" })).toEqual({
      id: "short", prompt: "Say something", format: "short_answer", graded: true,
    });
  });
});

function packageWith(question: unknown, assessment?: { mode: "web_quiz"; webQuizPassingScore?: number }) {
  return {
    schemaVersion: "1.2",
    metadata: { packageId: "rich-quiz", title: "Rich quiz", languages: ["en"], version: "1" },
    config: {
      trackedDimensions: [{
        key: "comprehension", label: "Comprehension", category: "comprehension", primary: true,
        scale: { min: 0, max: 10 }, calibrationMode: "zero_start",
      }],
      assessment: { passing: { dimensionKey: "comprehension", threshold: 7 } },
    },
    curriculum: {
      collectionKey: "rich-quiz",
      lessons: [{
        key: "lesson", title: "Lesson",
        blocks: [
          { id: "teach", order: 1, blockType: "teach", role: "explanation", content: "Learn this." },
          { id: "quiz", order: 2, blockType: "quiz_checkpoint", questions: [question], ...(assessment ? { assessment } : {}) },
        ],
      }],
    },
  };
}

describe("rich quiz reachability", () => {
  it.each([fill, order, matching])("requires web_quiz for $format", (question) => {
    const result = journeyPackageSchema.safeParse(packageWith(question));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('not assessment.mode=\\"web_quiz\\"');
  });

  it.each([fill, order, matching])("accepts $format in web_quiz", (question) => {
    expect(journeyPackageSchema.safeParse(packageWith(question, { mode: "web_quiz", webQuizPassingScore: 0.7 })).success).toBe(true);
  });

  it("rejects an out-of-range normalized passing score", () => {
    expect(journeyPackageSchema.safeParse(packageWith(fill, { mode: "web_quiz", webQuizPassingScore: 70 })).success).toBe(false);
  });
});
