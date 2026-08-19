import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enrollmentFindFirst: vi.fn(),
  versionFindFirst: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    enrollment: { findFirst: mocks.enrollmentFindFirst },
    programVersion: { findFirst: mocks.versionFindFirst },
  },
}));

import { resolveLearnerDelivery } from "../deliverySurface";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enrollmentFindFirst.mockResolvedValue(null);
  mocks.versionFindFirst.mockResolvedValue(null);
});

describe("resolveLearnerDelivery", () => {
  it("uses the learner's enrolled version instead of a course-code rule", async () => {
    mocks.enrollmentFindFirst.mockResolvedValue({
      programVersion: {
        metadata: { delivery: { surface: "player", supportedChannels: ["web"] } },
      },
    });

    await expect(resolveLearnerDelivery("socio-1", "skills-tool-calls")).resolves.toEqual({
      surface: "player",
      supportedChannels: ["web"],
    });
    expect(mocks.versionFindFirst).not.toHaveBeenCalled();
  });

  it("keeps metadata-less legacy curricula on the chat surface", async () => {
    await expect(resolveLearnerDelivery("socio-mi", "mi-colombia-curriculum")).resolves.toEqual({
      surface: "chat",
      supportedChannels: ["web", "whatsapp"],
    });
  });
});
