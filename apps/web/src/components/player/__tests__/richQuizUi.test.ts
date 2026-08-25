import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isCompleteQuizAnswer, type QuizQuestionDto } from "../QuizQuestionField";

const question = (format: QuizQuestionDto["format"], extra: Partial<QuizQuestionDto> = {}): QuizQuestionDto => ({
  id: format, prompt: format, format, graded: true, ...extra,
});

describe("rich quiz answer completeness", () => {
  it("checks scalar answers", () => {
    expect(isCompleteQuizAnswer(question("fill_in_blank"), " token ")).toBe(true);
    expect(isCompleteQuizAnswer(question("fill_in_blank"), "  ")).toBe(false);
  });

  it("checks ordered answers", () => {
    const order = question("drag_to_order", { options: ["A", "B"] });
    expect(isCompleteQuizAnswer(order, ["B", "A"])).toBe(true);
    expect(isCompleteQuizAnswer(order, ["A"])).toBe(false);
  });

  it("checks complete one-to-one matches", () => {
    const matching = question("matching", { matchingPrompts: [{ id: "a", text: "A" }, { id: "b", text: "B" }] });
    expect(isCompleteQuizAnswer(matching, { a: "One", b: "Two" })).toBe(true);
    expect(isCompleteQuizAnswer(matching, { a: "One", b: "One" })).toBe(false);
  });
});

describe("rich quiz payload seam", () => {
  const fieldSource = readFileSync(resolve(process.cwd(), "src/components/player/QuizQuestionField.tsx"), "utf8");
  const shellSource = readFileSync(resolve(process.cwd(), "src/components/player/BoundedAssessmentContainer.tsx"), "utf8");

  it.each(["multiple_choice", "short_answer", "fill_in_blank", "drag_to_order", "matching"])("renders %s in the payload dispatcher", (format) => {
    expect(fieldSource).toContain(`question.format === "${format}"`);
  });

  it("keeps format logic out of the generic shell", () => {
    expect(shellSource).not.toMatch(/fill_in_blank|drag_to_order|matching|QuizQuestionField/);
  });
});
