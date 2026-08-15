import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  socioFindUnique: vi.fn(),
  enrollmentFindFirst: vi.fn(),
  programVersionFindFirst: vi.fn(),
  diagnosticAttemptCount: vi.fn(),
  blockProgressFindMany: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    socio: { findUnique: mocks.socioFindUnique },
    enrollment: { findFirst: mocks.enrollmentFindFirst },
    programVersion: { findFirst: mocks.programVersionFindFirst },
    diagnosticAttempt: { count: mocks.diagnosticAttemptCount },
    blockProgress: { findMany: mocks.blockProgressFindMany },
  },
}));

vi.mock("@/lib/journey-package/delivery", () => ({
  resolveDelivery: vi.fn(() => ({ surface: "player", supportedChannels: ["web"] })),
}));

import { resolveLearnerHome } from "../learnerHome";

describe("resolveLearnerHome version pinning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.socioFindUnique.mockResolvedValue({
      id: "learner-1",
      curriculumCollectionKey: "ai-essentials",
      participantProfile: { id: "participant-1" },
    });
    mocks.enrollmentFindFirst.mockResolvedValue({
      id: "enrollment-1",
      programVersionId: "archived-version",
    });
    mocks.programVersionFindFirst.mockResolvedValue({
      id: "archived-version",
      status: "archived",
      metadata: { delivery: { surface: "player", supportedChannels: ["web"] } },
      config: { onboarding: { mode: "baseline_quiz" } },
      collection: { lessons: [] },
    });
    mocks.diagnosticAttemptCount.mockResolvedValue(1);
    mocks.blockProgressFindMany.mockResolvedValue([]);
  });

  it("keeps an existing learner on the archived version pinned by their active enrollment", async () => {
    await expect(resolveLearnerHome("learner-1")).resolves.toBe("/learn/AIESS/capstone");

    expect(mocks.enrollmentFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        programVersion: expect.objectContaining({ status: { in: ["published", "archived"] } }),
      }),
    }));
    expect(mocks.programVersionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "archived-version",
        status: { in: ["published", "archived"] },
      }),
    }));
  });
});
