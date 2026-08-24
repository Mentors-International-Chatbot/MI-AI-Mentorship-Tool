/**
 * B.1: the course intro message's place in the lesson DTO.
 *
 * Surfaced only on the course's first lesson (curriculum order, not lesson
 * content) — a course-level opener, not a per-lesson one — AND only before
 * the learner has completed anything in it, so it doesn't reappear on every
 * reload/revisit of lesson 1. Resolved to the learner's language by
 * `resolvePlayerAccess` before `getLessonDto` ever sees it (so this suite
 * only has to prove the placement gates, not language resolution — that's
 * `introMessage.test.ts`'s job).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectionRequired: vi.fn(),
  contentLessonFindMany: vi.fn(),
  blockProgressFindMany: vi.fn(),
  diagnosticAttemptCount: vi.fn(),
}));

vi.mock("@/lib/player/learnerProject", () => ({
  getCurrentLearnerProject: vi.fn(),
  learnerProjectSelectionRequired: mocks.selectionRequired,
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    contentLesson: { findMany: mocks.contentLessonFindMany },
    blockProgress: { findMany: mocks.blockProgressFindMany },
    milestoneProgress: { findMany: vi.fn().mockResolvedValue([]) },
    diagnosticAttempt: { count: mocks.diagnosticAttemptCount },
  },
}));

import { getLessonDto } from "@/lib/player/service";
import type { PlayerAccess } from "@/lib/player/service";

function lessonBody(key: string) {
  return {
    key, title: key, keyConcepts: [], selfCheckQuestions: [],
    blocks: [{ id: "b1", order: 1, blockType: "teach", contentVersion: 1, concepts: [], role: "explanation", content: "Hello" }],
  };
}

function access(introMessage: string | null): PlayerAccess {
  return {
    socioId: "socio-a",
    collectionKey: "ai-essentials",
    organizationId: "org-a",
    programVersionId: "pv-a",
    programVersion: "1.1.2",
    enrollmentId: "enrollment-a",
    introMessage,
    config: {},
  } as unknown as PlayerAccess;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectionRequired.mockResolvedValue(false);
  mocks.diagnosticAttemptCount.mockResolvedValue(1);
  mocks.contentLessonFindMany.mockResolvedValue([
    { slug: "l1", orderIndex: 0, versions: [{ body: lessonBody("l1") }] },
    { slug: "l2", orderIndex: 1, versions: [{ body: lessonBody("l2") }] },
  ]);
  mocks.blockProgressFindMany.mockResolvedValue([]);
});

describe("getLessonDto — introMessage placement", () => {
  it("surfaces the resolved intro message on the course's first lesson", async () => {
    const dto = await getLessonDto(access("Welcome!"), "l1");
    expect(dto.introMessage).toBe("Welcome!");
  });

  it("never surfaces the intro message on a later lesson, even with one authored", async () => {
    const dto = await getLessonDto(access("Welcome!"), "l2");
    expect(dto.introMessage).toBeNull();
  });

  it("is null on the first lesson when no intro message is authored", async () => {
    const dto = await getLessonDto(access(null), "l1");
    expect(dto.introMessage).toBeNull();
  });

  it("does not reappear once any block in the first lesson is completed (reload/revisit)", async () => {
    mocks.blockProgressFindMany.mockResolvedValue([
      { blockId: "b1", contentVersion: 1, completedAt: new Date(), score: 1, response: {}, state: {} },
    ]);
    const dto = await getLessonDto(access("Welcome!"), "l1");
    expect(dto.introMessage).toBeNull();
  });

  it("reappears under a fresh enrollment (retake) with no completions yet", async () => {
    mocks.blockProgressFindMany.mockResolvedValue([]); // fresh enrollment, no BlockProgress rows
    const dto = await getLessonDto(access("Welcome!"), "l1");
    expect(dto.introMessage).toBe("Welcome!");
  });
});
