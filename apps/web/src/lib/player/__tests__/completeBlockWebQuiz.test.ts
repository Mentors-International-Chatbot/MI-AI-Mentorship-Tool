/**
 * B.3 Stage 1: completeBlock/gradePlayerBlock's wiring of a web_quiz
 * quiz_checkpoint block onto mergeBlockAssessmentConfig's showScoreToLearner
 * gate — the same shape B.2 Stage 2 shipped for reteach_gate
 * (resolveReteachGateSignal), applied here to score AND feedback, uniformly
 * on every attempt (not just the final one), with full suppression
 * (feedback: null) rather than field-by-field stripping. See the comment
 * above gradePlayerBlock's web_quiz branch in service.ts for the reasoning.
 *
 * No AssessmentSession/tenantRepo mocking needed — unlike reteach_gate,
 * web_quiz's grading is pure (no I/O): mergeBlockAssessmentConfig only needs
 * access.config.assessment and block.assessment, both already in hand.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contentLessonFindMany: vi.fn(),
  blockProgressFindUnique: vi.fn(),
  blockProgressFindMany: vi.fn(),
  blockProgressUpsert: vi.fn(),
  messageFindFirst: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    contentLesson: { findMany: mocks.contentLessonFindMany },
    blockProgress: {
      findUnique: mocks.blockProgressFindUnique,
      findMany: mocks.blockProgressFindMany,
      upsert: mocks.blockProgressUpsert,
    },
    message: { findFirst: mocks.messageFindFirst },
  },
}));

import { completeBlock } from "@/lib/player/service";
import type { PlayerAccess } from "@/lib/player/service";

function lessonBody(quizBlockAssessment?: { mode: "web_quiz" }) {
  return {
    key: "l1", title: "l1", keyConcepts: [], selfCheckQuestions: [],
    blocks: [
      {
        id: "teach1", order: 1, blockType: "teach", contentVersion: 1, concepts: [],
        role: "explanation", content: "Some content",
      },
      {
        id: "quiz1", order: 2, blockType: "quiz_checkpoint", contentVersion: 1, concepts: [],
        title: "Check yourself",
        questions: [{
          id: "q1", prompt: "Pick one", format: "multiple_choice" as const,
          options: ["A", "B"], answerKey: "A", explanation: "A is correct.", graded: true,
        }],
        ...(quizBlockAssessment ? { assessment: quizBlockAssessment } : {}),
      },
    ],
  };
}

function access(showScoreToLearner: boolean): PlayerAccess {
  return {
    socioId: "socio-a", collectionKey: "ai-essentials", organizationId: "org-a",
    programVersionId: "pv-a", programVersion: "1.1.2", enrollmentId: "enrollment-a",
    introMessage: null,
    config: {
      assessment: {
        passing: { dimensionKey: "comprehension", threshold: 7, confidenceFloor: 0.5, minTurns: 2, maxTurns: 12 },
        allowRetake: true, blocking: true, onMaxTurnsWithoutPass: "complete_with_scores",
        autoAppendTeachBack: false, showScoreToLearner,
      },
    },
  } as unknown as PlayerAccess;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.blockProgressFindUnique.mockResolvedValue(null); // no prior progress row
  mocks.blockProgressFindMany.mockResolvedValue([]);
  mocks.blockProgressUpsert.mockResolvedValue({});
  mocks.messageFindFirst.mockResolvedValue(null);
});

describe("completeBlock — quiz_checkpoint with assessment.mode: web_quiz", () => {
  it("suppresses score and feedback, persisted as null, when showScoreToLearner is false", async () => {
    mocks.contentLessonFindMany.mockResolvedValue([
      { slug: "l1", orderIndex: 0, versions: [{ body: lessonBody({ mode: "web_quiz" }) }] },
    ]);

    const result = await completeBlock(access(false), "l1", "quiz1", { q1: "A" });

    expect(result.completed).toBe(true);
    expect(result.score).toBeNull();
    expect(result.feedback).toBeNull();
    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      // Write-time null, matching B.2's shape exactly — not a response-time
      // redaction. The persisted BlockProgress row carries the same null a
      // later read (getLessonDto's progress array) will inherit for free.
      create: expect.objectContaining({ score: null }),
    }));
  });

  it("leaves score and feedback exactly as today when showScoreToLearner is true", async () => {
    mocks.contentLessonFindMany.mockResolvedValue([
      { slug: "l1", orderIndex: 0, versions: [{ body: lessonBody({ mode: "web_quiz" }) }] },
    ]);

    const result = await completeBlock(access(true), "l1", "quiz1", { q1: "A" });

    expect(result.completed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.feedback).toEqual({
      kind: "quiz",
      correct: true,
      retryAvailable: false,
      questions: [{ questionId: "q1", correct: true, correctAnswer: "A", explanation: "A is correct." }],
    });
    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ score: 1 }),
    }));
  });

  it("regression guard: a quiz_checkpoint with no assessment.mode is unchanged, regardless of showScoreToLearner", async () => {
    mocks.contentLessonFindMany.mockResolvedValue([
      { slug: "l1", orderIndex: 0, versions: [{ body: lessonBody(undefined) }] },
    ]);

    // Same access, showScoreToLearner: false at the package level — must not
    // matter, since this block never opted into web_quiz governance.
    const result = await completeBlock(access(false), "l1", "quiz1", { q1: "A" });

    expect(result.completed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.feedback).toEqual({
      kind: "quiz",
      correct: true,
      retryAvailable: false,
      questions: [{ questionId: "q1", correct: true, correctAnswer: "A", explanation: "A is correct." }],
    });
  });

  it("regression guard: an incorrect first attempt on a plain quiz_checkpoint still offers a retry, unchanged", async () => {
    mocks.contentLessonFindMany.mockResolvedValue([
      { slug: "l1", orderIndex: 0, versions: [{ body: lessonBody(undefined) }] },
    ]);

    const result = await completeBlock(access(true), "l1", "quiz1", { q1: "B" });

    expect(result.completed).toBe(false);
    expect(result.feedback).toEqual({
      kind: "quiz",
      correct: false,
      retryAvailable: true,
      questions: [{ questionId: "q1", correct: false }],
    });
  });

  it("suppressed web_quiz still leaves an incorrect first attempt retriable (complete: false), even with feedback null", async () => {
    mocks.contentLessonFindMany.mockResolvedValue([
      { slug: "l1", orderIndex: 0, versions: [{ body: lessonBody({ mode: "web_quiz" }) }] },
    ]);

    const result = await completeBlock(access(false), "l1", "quiz1", { q1: "B" });

    expect(result.completed).toBe(false);
    expect(result.feedback).toBeNull();
    expect(result.score).toBeNull();
  });
});
