/**
 * B.2 Stage 2: completeBlock's wiring of a reteach_gate teach_back block onto
 * AssessmentSession.passedAt, via tenantRepo.getAssessmentSessionsForSocioLesson
 * (the Stage 1 choke point — enrollment-scoped, tenant-isolated, no direct
 * AssessmentSession query anywhere in this path).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contentLessonFindMany: vi.fn(),
  blockProgressFindUnique: vi.fn(),
  blockProgressFindMany: vi.fn(),
  blockProgressUpsert: vi.fn(),
  messageFindFirst: vi.fn(),
  getAssessmentSessionsForSocioLesson: vi.fn(),
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

vi.mock("@/lib/repo", () => ({
  tenantRepo: { getAssessmentSessionsForSocioLesson: mocks.getAssessmentSessionsForSocioLesson },
}));

import { completeBlock } from "@/lib/player/service";
import type { PlayerAccess } from "@/lib/player/service";

const LESSON_BODY = {
  key: "l1", title: "l1", keyConcepts: [], selfCheckQuestions: [],
  blocks: [
    {
      id: "teach1", order: 1, blockType: "teach", contentVersion: 1, concepts: [],
      role: "explanation", content: "Some content",
    },
    {
      id: "tb1", order: 2, blockType: "teach_back", contentVersion: 1, concepts: [],
      prompt: "Explain it back", evaluatesConcepts: [], dimensionKey: "comprehension",
      assessment: { mode: "reteach_gate" as const },
    },
  ],
};

function access(): PlayerAccess {
  return {
    socioId: "socio-a", collectionKey: "ai-essentials", organizationId: "org-a",
    programVersionId: "pv-a", programVersion: "1.1.2", enrollmentId: "enrollment-a",
    introMessage: null,
    config: {
      assessment: {
        passing: { dimensionKey: "comprehension", threshold: 7, confidenceFloor: 0.5, minTurns: 2, maxTurns: 12 },
        allowRetake: true, blocking: true, onMaxTurnsWithoutPass: "complete_with_scores",
        autoAppendTeachBack: false, showScoreToLearner: true,
      },
    },
  } as unknown as PlayerAccess;
}

function assessmentSession(overrides: Partial<{ passedAt: Date | null; scores: Record<string, unknown> | null }>) {
  return {
    id: "session-1", organizationId: "org-a", socioId: "socio-a", lessonKey: "l1", blockId: "tb1",
    kind: "gated_session" as const, channel: "web", status: "completed" as const, attemptNumber: 1,
    turnCount: 3, liveState: null, scores: overrides.scores ?? null, passedAt: overrides.passedAt ?? null,
    completedAt: new Date(), configSnapshot: {}, createdAt: new Date(), updatedAt: new Date(),
    enrollmentId: "enrollment-a",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contentLessonFindMany.mockResolvedValue([
    { slug: "l1", orderIndex: 0, versions: [{ body: LESSON_BODY }] },
  ]);
  mocks.blockProgressFindUnique.mockResolvedValue(null); // no prior progress row
  mocks.blockProgressFindMany.mockResolvedValue([]);
  mocks.blockProgressUpsert.mockResolvedValue({});
  mocks.messageFindFirst.mockResolvedValue(null); // no main-thread message for this block
});

describe("completeBlock — reteach_gate teach_back", () => {
  it("stays incomplete when no AssessmentSession exists yet for this enrollment+lesson+block", async () => {
    mocks.getAssessmentSessionsForSocioLesson.mockResolvedValue([]);

    await completeBlock(access(), "l1", "tb1", {});

    expect(mocks.getAssessmentSessionsForSocioLesson).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a" }),
      "enrollment-a",
      "l1",
      "tb1",
    );
    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ completedAt: null, score: null }),
    }));
  });

  it("stays incomplete when a session exists but has not passed", async () => {
    mocks.getAssessmentSessionsForSocioLesson.mockResolvedValue([assessmentSession({ passedAt: null })]);

    await completeBlock(access(), "l1", "tb1", {});

    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ completedAt: null, score: null }),
    }));
  });

  it("completes once a session with passedAt exists, exposing the score when showScoreToLearner is true", async () => {
    mocks.getAssessmentSessionsForSocioLesson.mockResolvedValue([
      assessmentSession({ passedAt: new Date(), scores: { comprehension: 0.9 } }),
    ]);

    const result = await completeBlock(access(), "l1", "tb1", {});

    expect(result.completed).toBe(true);
    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ completedAt: expect.any(Date), score: 0.9 }),
    }));
  });

  it("withholds the score when showScoreToLearner is false, even with a passed session carrying one", async () => {
    const noScoreAccess = access();
    noScoreAccess.config.assessment!.showScoreToLearner = false;
    mocks.getAssessmentSessionsForSocioLesson.mockResolvedValue([
      assessmentSession({ passedAt: new Date(), scores: { comprehension: 0.9 } }),
    ]);

    const result = await completeBlock(noScoreAccess, "l1", "tb1", {});

    expect(result.completed).toBe(true);
    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ score: null }),
    }));
  });

  it("never issues a direct AssessmentSession query — only the Stage 1 tenantRepo method", async () => {
    mocks.getAssessmentSessionsForSocioLesson.mockResolvedValue([assessmentSession({ passedAt: new Date() })]);
    await completeBlock(access(), "l1", "tb1", {});
    // The only assertion that matters structurally: nothing in this test's
    // mock surface exposes a raw prisma.assessmentSession — the mocked
    // @/lib/repo module only has the one method, so any direct-query attempt
    // would throw "not a function" rather than silently succeed.
    expect(mocks.getAssessmentSessionsForSocioLesson).toHaveBeenCalledTimes(1);
  });
});
