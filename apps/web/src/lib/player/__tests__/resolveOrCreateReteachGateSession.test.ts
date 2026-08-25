/**
 * Stage 1 of the reteach-gate write path (reports/reteach-gate-write-path-design.md
 * §a): resolveOrCreateReteachGateSession mirrors router.checkGatePosition's
 * find-or-create shape — an open session is returned as-is, a new one is
 * created only when none exists. createAssessmentSession itself (session
 * creation internals — config resolution, attempt numbering) is mocked at
 * the module boundary here; it already has its own test coverage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contentLessonFindMany: vi.fn(),
  getAssessmentSessionsForSocioLesson: vi.fn(),
  createAssessmentSession: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    contentLesson: { findMany: mocks.contentLessonFindMany },
  },
}));

vi.mock("@/lib/repo", () => ({
  tenantRepo: { getAssessmentSessionsForSocioLesson: mocks.getAssessmentSessionsForSocioLesson },
}));

vi.mock("@/lib/ai/assessment/createAssessmentSession", () => ({
  createAssessmentSession: mocks.createAssessmentSession,
  AssessmentConfigError: class AssessmentConfigError extends Error {},
}));

import { resolveOrCreateReteachGateSession, PlayerError } from "@/lib/player/service";
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
    {
      id: "tb2", order: 3, blockType: "teach_back", contentVersion: 1, concepts: [],
      prompt: "Explain it back too", evaluatesConcepts: [], dimensionKey: "comprehension",
    },
  ],
};

function access(): PlayerAccess {
  return {
    socioId: "socio-a", collectionKey: "ai-essentials", organizationId: "org-a",
    programVersionId: "pv-a", programVersion: "1.1.2", enrollmentId: "enrollment-a",
    introMessage: null,
    config: { assessment: undefined },
  } as unknown as PlayerAccess;
}

function assessmentSession(overrides: Partial<{ id: string; status: "pending" | "in_progress" | "completed" }>) {
  return {
    id: overrides.id ?? "session-1", organizationId: "org-a", socioId: "socio-a", lessonKey: "l1", blockId: "tb1",
    kind: "gated_session" as const, channel: "web", status: overrides.status ?? "in_progress", attemptNumber: 1,
    turnCount: 1, liveState: null, scores: null, passedAt: null,
    completedAt: null, configSnapshot: {}, createdAt: new Date(), updatedAt: new Date(),
    enrollmentId: "enrollment-a",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contentLessonFindMany.mockResolvedValue([
    { slug: "l1", orderIndex: 0, versions: [{ body: LESSON_BODY }] },
  ]);
});

describe("resolveOrCreateReteachGateSession", () => {
  it("returns the existing open session on a second call — no duplicate creation", async () => {
    mocks.getAssessmentSessionsForSocioLesson.mockResolvedValue([assessmentSession({ id: "session-existing", status: "in_progress" })]);

    const first = await resolveOrCreateReteachGateSession(access(), "l1", "tb1");
    const second = await resolveOrCreateReteachGateSession(access(), "l1", "tb1");

    expect(first).toEqual({ sessionId: "session-existing", resumed: true });
    expect(second).toEqual({ sessionId: "session-existing", resumed: true });
    expect(mocks.createAssessmentSession).not.toHaveBeenCalled();
  });

  it("creates a new session when none is open, using PlayerAccess-sourced arguments", async () => {
    mocks.getAssessmentSessionsForSocioLesson.mockResolvedValue([]);
    mocks.createAssessmentSession.mockResolvedValue(assessmentSession({ id: "session-new" }));

    const result = await resolveOrCreateReteachGateSession(access(), "l1", "tb1");

    expect(result).toEqual({ sessionId: "session-new", resumed: false });
    expect(mocks.createAssessmentSession).toHaveBeenCalledWith(expect.objectContaining({
      socioId: "socio-a",
      lessonKey: "l1",
      blockId: "tb1",
      channel: "web",
      enrollmentId: "enrollment-a",
      collectionKey: "ai-essentials",
    }));
  });

  it("treats a completed session as cleared, not open — a fresh call still creates a new one", async () => {
    mocks.getAssessmentSessionsForSocioLesson.mockResolvedValue([assessmentSession({ id: "session-done", status: "completed" })]);
    mocks.createAssessmentSession.mockResolvedValue(assessmentSession({ id: "session-retake" }));

    const result = await resolveOrCreateReteachGateSession(access(), "l1", "tb1");

    expect(result).toEqual({ sessionId: "session-retake", resumed: false });
    expect(mocks.createAssessmentSession).toHaveBeenCalledTimes(1);
  });

  it("rejects a block that is not a reteach_gate teach_back", async () => {
    await expect(resolveOrCreateReteachGateSession(access(), "l1", "tb2")).rejects.toThrow(PlayerError);
    expect(mocks.getAssessmentSessionsForSocioLesson).not.toHaveBeenCalled();
    expect(mocks.createAssessmentSession).not.toHaveBeenCalled();
  });
});
