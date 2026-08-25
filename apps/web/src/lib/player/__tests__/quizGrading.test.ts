import { describe, expect, it } from "vitest";
import { quizQuestionSchema } from "@/lib/journey-package/journey-package.schema";
import { gradeQuizQuestion } from "../quizGrading";

const parse = (question: Record<string, unknown>) => quizQuestionSchema.parse({ explanation: "Because.", ...question });

describe("gradeQuizQuestion", () => {
  it("preserves raw multiple-choice equality", () => {
    const question = parse({ id: "mc", prompt: "Pick", format: "multiple_choice", options: ["A", "B"], answerKey: "A" });
    expect(gradeQuizQuestion(question, "A")).toEqual({ valid: true, correct: true });
    expect(gradeQuizQuestion(question, "a")).toEqual({ valid: false, reason: "invalid" });
  });

  it("preserves raw short-answer equality", () => {
    const question = parse({ id: "short", prompt: "Type A", format: "short_answer", answerKey: "A" });
    expect(gradeQuizQuestion(question, "A")).toEqual({ valid: true, correct: true });
    expect(gradeQuizQuestion(question, "a")).toEqual({ valid: true, correct: false });
  });

  it("grades fill answers with Unicode, whitespace, and case normalization", () => {
    const question = parse({ id: "fill", prompt: "Next ___", format: "fill_in_blank", answerKey: ["AI model", "model"] });
    expect(gradeQuizQuestion(question, "  ai   MODEL ")).toEqual({ valid: true, correct: true });
    expect(gradeQuizQuestion(question, "system")).toEqual({ valid: true, correct: false });
  });

  it("grades an exact drag sequence and rejects a non-permutation", () => {
    const question = parse({ id: "order", prompt: "Order", format: "drag_to_order", options: ["B", "C", "A"], answerKey: ["A", "B", "C"] });
    expect(gradeQuizQuestion(question, ["A", "B", "C"])).toEqual({ valid: true, correct: true });
    expect(gradeQuizQuestion(question, ["A", "C", "B"])).toEqual({ valid: true, correct: false });
    expect(gradeQuizQuestion(question, ["A", "A", "B"])).toEqual({ valid: false, reason: "invalid" });
  });

  it("grades an exact matching map and rejects reused choices", () => {
    const question = parse({
      id: "match", prompt: "Match", format: "matching",
      matchingPrompts: [{ id: "train", text: "Training" }, { id: "infer", text: "Inference" }],
      options: ["Use", "Build"], answerKey: { train: "Build", infer: "Use" },
    });
    expect(gradeQuizQuestion(question, { train: "Build", infer: "Use" })).toEqual({ valid: true, correct: true });
    expect(gradeQuizQuestion(question, { train: "Use", infer: "Build" })).toEqual({ valid: true, correct: false });
    expect(gradeQuizQuestion(question, { train: "Use", infer: "Use" })).toEqual({ valid: false, reason: "invalid" });
  });

  it("distinguishes missing from malformed answers", () => {
    const question = parse({ id: "fill", prompt: "Next ___", format: "fill_in_blank", answerKey: "token" });
    expect(gradeQuizQuestion(question, undefined)).toEqual({ valid: false, reason: "incomplete" });
    expect(gradeQuizQuestion(question, [])).toEqual({ valid: false, reason: "invalid" });
  });
});
