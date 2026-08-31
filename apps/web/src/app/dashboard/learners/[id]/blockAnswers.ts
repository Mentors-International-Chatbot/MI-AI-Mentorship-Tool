/**
 * Formats completed BlockProgress rows into the learner's actual answers, for
 * the block types that ask for one: quiz_checkpoint, drag_order, and
 * onboarding_survey.
 *
 * Player-surface courses (e.g. ai-essentials-aug2026) grade these three block
 * types deterministically server-side — the exchange never goes through
 * `/api/chat`, so it never produces a `Message` row. Before this, a mentor
 * could see that a learner finished a quiz (via the activity strip's block
 * count) but not what they actually answered. teach_back and requiresResponse
 * blocks aren't handled here: those DO post through `/api/chat` and so
 * already show up in the full conversation history (see ChatHistory).
 *
 * Pure grouping/formatting, kept separate from the Prisma + lesson-content
 * reads so it's testable without a DB — same split as blockActivity.ts.
 */
import type { ParsedLessonBlock, QuizQuestion } from "@/lib/journey-package/journey-package.schema";
import { gradeQuizQuestion } from "@/lib/player/quizGrading";

export type BlockProgressRow = {
  lessonKey: string;
  blockId: string;
  response: unknown;
  completedAt: Date;
};

export type AnsweredItem = {
  prompt: string;
  answer: string;
  /** undefined when the question has no correct answer to check against (an opinion question, or an ungraded step). */
  correct?: boolean;
};

export type AnsweredBlock = {
  lessonKey: string;
  blockId: string;
  blockType: "quiz_checkpoint" | "drag_order" | "onboarding_survey";
  completedAt: string;
  items: AnsweredItem[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatQuizAnswer(question: QuizQuestion, answer: unknown): string {
  if (answer === undefined || answer === null) return "—";
  if (question.format === "drag_to_order" && Array.isArray(answer)) {
    return answer.filter((item): item is string => typeof item === "string").join(" → ");
  }
  if (question.format === "matching" && answer && typeof answer === "object" && !Array.isArray(answer)) {
    const prompts = question.matchingPrompts ?? [];
    return Object.entries(answer as Record<string, unknown>)
      .map(([promptId, value]) => `${prompts.find((p) => p.id === promptId)?.text ?? promptId}: ${String(value)}`)
      .join("; ");
  }
  return typeof answer === "string" ? answer : JSON.stringify(answer);
}

/** `blocksByKey` is keyed by `${lessonKey}:${blockId}` — a row with no matching block (deleted/renamed content) is skipped. */
export function buildBlockAnswers(
  rows: readonly BlockProgressRow[],
  blocksByKey: ReadonlyMap<string, ParsedLessonBlock>,
): AnsweredBlock[] {
  const result: AnsweredBlock[] = [];

  for (const row of rows) {
    const block = blocksByKey.get(`${row.lessonKey}:${row.blockId}`);
    if (!block) continue;

    if (block.blockType === "quiz_checkpoint") {
      const response = asRecord(row.response);
      const items: AnsweredItem[] = block.questions.map((question) => {
        const answer = response[question.id];
        const grade = gradeQuizQuestion(question, answer);
        return {
          prompt: question.prompt,
          answer: formatQuizAnswer(question, answer),
          correct: question.graded && grade.valid ? grade.correct : undefined,
        };
      });
      result.push({ lessonKey: row.lessonKey, blockId: row.blockId, blockType: "quiz_checkpoint", completedAt: row.completedAt.toISOString(), items });
      continue;
    }

    if (block.blockType === "drag_order") {
      const order = Array.isArray(row.response) ? row.response.filter((item): item is number => typeof item === "number") : [];
      const answer = order.map((index) => block.items[index] ?? `#${index}`).join(" → ");
      const correct = order.length === block.correctOrder.length && order.every((value, index) => value === block.correctOrder[index]);
      result.push({
        lessonKey: row.lessonKey,
        blockId: row.blockId,
        blockType: "drag_order",
        completedAt: row.completedAt.toISOString(),
        items: [{ prompt: block.prompt, answer, correct }],
      });
      continue;
    }

    if (block.blockType === "onboarding_survey") {
      const response = asRecord(row.response);
      const items: AnsweredItem[] = block.steps
        .filter((step) => response[step.field] !== undefined)
        .map((step) => ({ prompt: step.prompt, answer: String(response[step.field]) }));
      if (items.length > 0) {
        result.push({ lessonKey: row.lessonKey, blockId: row.blockId, blockType: "onboarding_survey", completedAt: row.completedAt.toISOString(), items });
      }
    }
  }

  return result;
}
