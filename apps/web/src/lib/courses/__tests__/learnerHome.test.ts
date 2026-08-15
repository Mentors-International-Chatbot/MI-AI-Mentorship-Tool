import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  socioFindUnique: vi.fn(),
  enrollmentFindFirst: vi.fn(),
  programVersionFindFirst: vi.fn(),
  diagnosticAttemptCount: vi.fn(),
  blockProgressFindMany: vi.fn(),
  learnerProjectSelectionRequired: vi.fn(),
  resolveDelivery: vi.fn(),
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
  resolveDelivery: mocks.resolveDelivery,
}));

vi.mock("@/lib/player/learnerProject", () => ({
  learnerProjectSelectionRequired: mocks.learnerProjectSelectionRequired,
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
      program: { organizationId: "org-1" },
      collection: { lessons: [] },
    });
    mocks.learnerProjectSelectionRequired.mockResolvedValue(false);
    mocks.resolveDelivery.mockReturnValue({ surface: "player", supportedChannels: ["web"] });
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

  it("routes project setup before consulting the baseline diagnostic", async () => {
    mocks.programVersionFindFirst.mockResolvedValueOnce({
      id: "published-version",
      status: "published",
      metadata: { delivery: { surface: "player", supportedChannels: ["web"] } },
      config: {
        projectSelection: {
          presets: [{ key: "brief", family: "routine", label: "Brief", defaultLevel: "L1", exampleContexts: ["Class"] }],
          interestTopics: [
            { key: "one", label: "One", dimensions: ["working_with_ai"], presetAffinity: ["brief"] },
            { key: "two", label: "Two", dimensions: ["how_ai_works"], presetAffinity: ["brief"] },
          ],
        },
        onboarding: { mode: "baseline_quiz" },
      },
      program: { organizationId: "org-1" },
      collection: { lessons: [] },
    });
    mocks.enrollmentFindFirst.mockResolvedValueOnce({ id: "enrollment-1", programVersionId: "published-version" });
    mocks.learnerProjectSelectionRequired.mockResolvedValueOnce(true);

    await expect(resolveLearnerHome("learner-1")).resolves.toBe("/learn/AIESS/project-setup");
    expect(mocks.diagnosticAttemptCount).not.toHaveBeenCalled();
  });

  it.each(["mi-colombia-curriculum", "pbj-basics"])("keeps legacy chat routing unchanged for %s", async (collectionKey) => {
    mocks.socioFindUnique.mockResolvedValueOnce({
      id: "learner-1",
      curriculumCollectionKey: collectionKey,
      participantProfile: { id: "participant-1" },
    });
    mocks.programVersionFindFirst.mockResolvedValueOnce({
      id: "legacy-version",
      status: "published",
      metadata: {},
      config: {},
      program: { organizationId: "org-1" },
      collection: { lessons: [] },
    });
    mocks.enrollmentFindFirst.mockResolvedValueOnce({ id: "enrollment-1", programVersionId: "legacy-version" });
    mocks.resolveDelivery.mockReturnValueOnce({ surface: "chat", supportedChannels: ["web"] });

    await expect(resolveLearnerHome("learner-1")).resolves.toBe("/chat");
    expect(mocks.learnerProjectSelectionRequired).not.toHaveBeenCalled();
  });
});
