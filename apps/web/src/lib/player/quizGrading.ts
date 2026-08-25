import { normalizeOption, type QuizQuestion } from "@/lib/journey-package/journey-package.schema";

export type QuizAnswer = string | string[] | Record<string, string>;

export type QuizQuestionGrade =
  | { valid: true; correct: boolean }
  | { valid: false; reason: "incomplete" | "invalid" };

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every((item) => typeof item === "string");
}

function isExactPermutation(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return sortedActual.every((value, index) => value === sortedExpected[index]);
}

/** The single server-side validator/grader for every quiz question format. */
export function gradeQuizQuestion(question: QuizQuestion, answer: unknown): QuizQuestionGrade {
  if (answer === undefined) return { valid: false, reason: "incomplete" };

  if (question.format === "multiple_choice") {
    if (typeof answer !== "string" || !question.options?.includes(answer)) {
      return { valid: false, reason: "invalid" };
    }
    return { valid: true, correct: answer === question.answerKey };
  }

  if (question.format === "short_answer") {
    if (typeof answer !== "string") return { valid: false, reason: "invalid" };
    return { valid: true, correct: answer === question.answerKey };
  }

  if (question.format === "fill_in_blank") {
    if (typeof answer !== "string" || normalizeOption(answer).length === 0) {
      return { valid: false, reason: "invalid" };
    }
    const accepted = typeof question.answerKey === "string"
      ? [question.answerKey]
      : Array.isArray(question.answerKey) ? question.answerKey : [];
    const normalizedAnswer = normalizeOption(answer);
    return { valid: true, correct: accepted.some((value) => normalizeOption(value) === normalizedAnswer) };
  }

  if (question.format === "drag_to_order") {
    const options = question.options ?? [];
    if (!Array.isArray(answer) || !answer.every((item) => typeof item === "string") || !isExactPermutation(answer, options)) {
      return { valid: false, reason: "invalid" };
    }
    const answerKey = Array.isArray(question.answerKey) ? question.answerKey : [];
    return { valid: true, correct: answer.length === answerKey.length && answer.every((value, index) => value === answerKey[index]) };
  }

  if (!isStringRecord(answer)) return { valid: false, reason: "invalid" };
  const prompts = question.matchingPrompts ?? [];
  const promptIds = prompts.map((prompt) => prompt.id);
  const answerIds = Object.keys(answer);
  const answerOptions = Object.values(answer);
  const options = question.options ?? [];
  if (
    answerIds.length !== promptIds.length
    || !isExactPermutation(answerIds, promptIds)
    || !isExactPermutation(answerOptions, options)
  ) {
    return { valid: false, reason: "invalid" };
  }
  const answerKey = question.answerKey && typeof question.answerKey === "object" && !Array.isArray(question.answerKey)
    ? question.answerKey
    : {};
  return { valid: true, correct: promptIds.every((id) => answer[id] === answerKey[id]) };
}
