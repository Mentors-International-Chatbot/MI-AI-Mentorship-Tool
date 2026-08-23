import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestIdentity } from "@/lib/auth/requestIdentity";

const mocks = vi.hoisted(() => ({
  socioFindUnique: vi.fn(),
  enrollmentFindFirst: vi.fn(),
  ltiContextFindUnique: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    socio: { findUnique: mocks.socioFindUnique },
    enrollment: { findFirst: mocks.enrollmentFindFirst },
    ltiContext: { findUnique: mocks.ltiContextFindUnique },
  },
}));

vi.mock("@/lib/courses/resolver", () => ({
  resolveCourseCode: vi.fn(() => "ai-essentials"),
}));

vi.mock("@/lib/journey-package/delivery", () => ({
  resolveDelivery: vi.fn(() => ({ surface: "player", supportedChannels: ["web", "canvas"] })),
}));

import { resolvePlayerAccess } from "../service";

const programVersion = {
  id: "version-1",
  version: "2",
  status: "published",
  config: {},
  metadata: {},
  collection: { slug: "ai-essentials" },
  program: { organizationId: "org-1" },
};

const webIdentity: RequestIdentity = {
  userId: "learner-1",
  externalId: "external-1",
  role: "socio",
  name: "Learner",
  socioId: "learner-1",
  channel: "web",
};

describe("resolvePlayerAccess enrollment identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the exact latest enrollment selected by the web lookup", async () => {
    mocks.socioFindUnique.mockResolvedValue({
      id: "learner-1",
      curriculumCollectionKey: "ai-essentials",
      participantProfile: {
        id: "participant-1",
        enrollments: [
          { id: "older-enrollment", cohortId: "cohort-1", programVersionId: "version-1", status: "active" },
          { id: "latest-enrollment", cohortId: "cohort-2", programVersionId: "version-1", status: "active" },
        ],
      },
    });
    mocks.enrollmentFindFirst.mockResolvedValue({ id: "latest-enrollment", programVersion });

    const access = await resolvePlayerAccess(webIdentity, "AIESS");

    expect(access.enrollmentId).toBe("latest-enrollment");
  });

  it("selects the enrollment for the exact Canvas cohort context", async () => {
    mocks.socioFindUnique.mockResolvedValue({
      id: "learner-1",
      curriculumCollectionKey: "ai-essentials",
      participantProfile: {
        id: "participant-1",
        enrollments: [
          { id: "other-context", cohortId: "cohort-1", programVersionId: "version-1", status: "active" },
          { id: "canvas-context", cohortId: "cohort-2", programVersionId: "version-1", status: "active" },
        ],
      },
    });
    mocks.ltiContextFindUnique.mockResolvedValue({
      id: "lti-context-2",
      cohortId: "cohort-2",
      programVersionId: "version-1",
      programVersion,
    });

    const access = await resolvePlayerAccess({
      ...webIdentity,
      channel: "canvas",
      ltiContextId: "lti-context-2",
    }, "AIESS");

    expect(access.enrollmentId).toBe("canvas-context");
  });

  it("resolves the exact version pinned by the enrollment, never a separate 'latest published' query (Stage 2 pinning invariant)", async () => {
    // Deliberately an OLDER version than whatever might be "latest published"
    // — the mocked playerRuntimeRepo below exposes no `programVersion`
    // delegate at all, so if this path ever issued an independent
    // "latest published" lookup, it would throw here rather than silently
    // floating an enrolled learner to a newer version.
    const pinnedOldVersion = {
      id: "old-version",
      version: "1",
      status: "archived",
      config: {},
      metadata: {},
      collection: { slug: "ai-essentials" },
      program: { organizationId: "org-1" },
    };
    mocks.socioFindUnique.mockResolvedValue({
      id: "learner-1",
      curriculumCollectionKey: "ai-essentials",
      participantProfile: {
        id: "participant-1",
        enrollments: [{ id: "pinned-enrollment", cohortId: "cohort-1", programVersionId: "old-version", status: "active" }],
      },
    });
    mocks.enrollmentFindFirst.mockResolvedValue({ id: "pinned-enrollment", programVersion: pinnedOldVersion });

    const access = await resolvePlayerAccess(webIdentity, "AIESS");

    expect(access.programVersionId).toBe("old-version");
    expect(access.programVersion).toBe("1");
  });
});
