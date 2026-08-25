/**
 * Stage E.5 acceptance check: real blocks from the authored AI Essentials
 * Aug 2026 package (not synthetic fixtures) actually complete through
 * completeBlock — one reteach_gate teach_back (b1-12) resolving via
 * AssessmentSession.passedAt (mirrors completeBlockReteachGate.test.ts), and
 * one project motivating activity (b1-1) completing on submission (mirrors
 * completeBlockProject.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiEssentialsAug2026Package } from "@/lib/journey-package/examples/ai-essentials-aug2026-package";

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

const lesson1 = aiEssentialsAug2026Package.curriculum.lessons.find((l) => l.key === "lesson-1")!;

function access(): PlayerAccess {
  return {
    socioId: "socio-a", collectionKey: "ai-essentials-aug2026", organizationId: "org-a",
    programVersionId: "pv-a", programVersion: "2026.8", enrollmentId: "enrollment-a",
    introMessage: null,
    config: aiEssentialsAug2026Package.config,
  } as unknown as PlayerAccess;
}

function assessmentSession(overrides: Partial<{ passedAt: Date | null; scores: Record<string, unknown> | null }>) {
  return {
    id: "session-1", organizationId: "org-a", socioId: "socio-a", lessonKey: "lesson-1", blockId: "b1-12",
    kind: "gated_session" as const, channel: "web", status: "completed" as const, attemptNumber: 1,
    turnCount: 3, liveState: null, scores: overrides.scores ?? null, passedAt: overrides.passedAt ?? null,
    completedAt: new Date(), configSnapshot: {}, createdAt: new Date(), updatedAt: new Date(),
    enrollmentId: "enrollment-a",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contentLessonFindMany.mockResolvedValue([
    { slug: "lesson-1", orderIndex: 0, versions: [{ body: lesson1 }] },
  ]);
  mocks.blockProgressFindUnique.mockResolvedValue(null);
  mocks.blockProgressFindMany.mockResolvedValue([]);
  mocks.blockProgressUpsert.mockResolvedValue({});
  mocks.messageFindFirst.mockResolvedValue(null);
});

describe("completeBlock — b1-12, reteach_gate teach_back", () => {
  it("stays incomplete with no AssessmentSession yet", async () => {
    mocks.getAssessmentSessionsForSocioLesson.mockResolvedValue([]);

    const result = await completeBlock(access(), "lesson-1", "b1-12", {});

    expect(result.completed).toBe(false);
  });

  it("completes once a passed session exists, with a score visible (package sets showScoreToLearner: true)", async () => {
    mocks.getAssessmentSessionsForSocioLesson.mockResolvedValue([
      assessmentSession({ passedAt: new Date(), scores: { comprehension: 0.8 } }),
    ]);

    const result = await completeBlock(access(), "lesson-1", "b1-12", {});

    expect(result.completed).toBe(true);
    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ completedAt: expect.any(Date), score: 0.8 }),
    }));
  });
});

describe("completeBlock — b1-1, project motivating activity (requiresSubmission: true, blocking: true)", () => {
  it("completes on submission, ungraded, response stored verbatim", async () => {
    const result = await completeBlock(access(), "lesson-1", "b1-1", {
      acknowledged: true,
      tasks: "Listed 6 tasks, marked A/B/C.",
    });

    expect(result.completed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.feedback).toBeNull();
    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ score: 1, response: { acknowledged: true, tasks: "Listed 6 tasks, marked A/B/C." } }),
    }));
  });
});
