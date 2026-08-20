import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  getSocio: vi.fn(),
  setSocioCurriculum: vi.fn(),
  participantFindUnique: vi.fn(),
  programVersionFindMany: vi.fn(),
  cohortUpsert: vi.fn(),
  enrollmentUpsert: vi.fn(),
  createParticipant: vi.fn(),
  resolveOrganizationForSocio: vi.fn(),
  preloadCollection: vi.fn(),
  resolveLearnerHome: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ verifySession: mocks.verifySession }));
vi.mock("@/lib/repo", () => ({
  repo: { getSocio: mocks.getSocio, setSocioCurriculum: mocks.setSocioCurriculum },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    participantProfile: { findUnique: mocks.participantFindUnique },
    programVersion: { findMany: mocks.programVersionFindMany },
    cohort: { upsert: mocks.cohortUpsert },
    enrollment: { upsert: mocks.enrollmentUpsert },
  },
}));
vi.mock("@/lib/repo/tenantPrismaRepo", () => ({
  tenantPrismaRepo: {
    createParticipant: mocks.createParticipant,
    resolveOrganizationForSocio: mocks.resolveOrganizationForSocio,
  },
}));
vi.mock("@/lib/lessons/db-lesson-service", () => ({
  preloadCollection: mocks.preloadCollection,
}));
vi.mock("@/lib/courses/resolver", () => ({
  resolveCourseCode: () => "ai-essentials",
  getAvailableCourseCodes: () => ["AIESS"],
  getAvailableCourses: () => [],
}));
vi.mock("@/lib/courses/learnerHome", () => ({
  resolveLearnerHome: mocks.resolveLearnerHome,
}));
vi.mock("@/lib/logging/logger", () => ({ logEvent: mocks.logEvent }));

import { POST } from "../route";

const request = () => new NextRequest("http://localhost:3000/api/auth/curriculum", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ courseCode: "AIESS" }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifySession.mockResolvedValue({
    userId: "learner-a",
    role: "socio",
    name: "Learner A",
    rememberMe: false,
    sessionStart: 0,
  });
  mocks.getSocio.mockResolvedValue({
    id: "learner-a",
    channelType: "web",
    externalId: "learner-a",
    language: "en",
    name: "Learner A",
    status: "ACTIVE",
    aiPaused: false,
    curriculumCollectionKey: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  mocks.participantFindUnique.mockResolvedValue({ id: "participant-a", organizationId: "org-a" });
  mocks.programVersionFindMany.mockResolvedValue([{
    id: "version-b",
    programId: "program-b",
    metadata: { delivery: { surface: "player", supportedChannels: ["web"] } },
    program: {
      organizationId: "org-b",
      organization: { settings: null },
    },
  }]);
});

describe("POST /api/auth/curriculum — AI Essentials tenant isolation", () => {
  it("refuses a published version owned by a different organization before any write", async () => {
    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      // Course-neutral copy: the same refusal now serves every player course,
      // so it must not name one of them.
      error: "This course is not currently published for your organization",
    });
    expect(mocks.setSocioCurriculum).not.toHaveBeenCalled();
    expect(mocks.createParticipant).not.toHaveBeenCalled();
    expect(mocks.cohortUpsert).not.toHaveBeenCalled();
    expect(mocks.enrollmentUpsert).not.toHaveBeenCalled();
  });

  it("does not expose a synthetic publication to an unanchored learner", async () => {
    mocks.participantFindUnique.mockResolvedValue(null);
    mocks.programVersionFindMany.mockResolvedValue([{
      id: "verification-version",
      programId: "verification-program",
      metadata: { delivery: { surface: "player", supportedChannels: ["web"] } },
      program: {
        organizationId: "verification-org",
        organization: { settings: { syntheticDataOnly: true } },
      },
    }]);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.setSocioCurriculum).not.toHaveBeenCalled();
    expect(mocks.enrollmentUpsert).not.toHaveBeenCalled();
  });

  it("lets an unanchored learner join a synthetic publication whose org opts into open enrollment", async () => {
    mocks.participantFindUnique.mockResolvedValueOnce(null);
    mocks.programVersionFindMany.mockResolvedValue([{
      id: "verification-version",
      programId: "verification-program",
      metadata: { delivery: { surface: "player", supportedChannels: ["web"] } },
      program: {
        organizationId: "verification-org",
        organization: { settings: { syntheticDataOnly: true, openEnrollment: true } },
      },
    }]);
    mocks.resolveOrganizationForSocio.mockResolvedValue({ organizationId: "verification-org", source: "collection_key" });
    mocks.createParticipant.mockResolvedValue({ id: "participant-new", organizationId: "verification-org" });
    mocks.participantFindUnique.mockResolvedValueOnce({ id: "participant-new", organizationId: "verification-org" });
    mocks.cohortUpsert.mockResolvedValue({ id: "cohort-1", programId: "verification-program" });
    mocks.enrollmentUpsert.mockResolvedValue({ id: "enrollment-1" });
    mocks.resolveLearnerHome.mockResolvedValue("/learn/ai-essentials");

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.setSocioCurriculum).toHaveBeenCalledWith("learner-a", "ai-essentials");
    // The learner is anchored into the course's own org, not a shared or
    // caller-supplied one — resolveOrganizationForSocio (tier 2, keyed off the
    // curriculumCollectionKey just written) is the sole source of that org.
    expect(mocks.createParticipant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ socioId: "learner-a" }),
    );
    expect(mocks.enrollmentUpsert).toHaveBeenCalled();
  });
});
