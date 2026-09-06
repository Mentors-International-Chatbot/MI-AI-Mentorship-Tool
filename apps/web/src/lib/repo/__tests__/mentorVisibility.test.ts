import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  socioFindFirst: vi.fn(),
  socioFindMany: vi.fn(),
  getOrganizationIdByMentorId: vi.fn(),
  resolveOrganizationForSocio: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    socio: { findFirst: mocks.socioFindFirst, findMany: mocks.socioFindMany },
  },
}));

vi.mock("../tenantPrismaRepo", () => ({
  tenantPrismaRepo: {
    getOrganizationIdByMentorId: mocks.getOrganizationIdByMentorId,
    resolveOrganizationForSocio: mocks.resolveOrganizationForSocio,
  },
}));

import { mentorSocioWhere, mentorOwnsSocio, mentorCanReachSocio, isSocioVisibleToMentor } from "../mentorVisibility";

/**
 * L5 stage 2 — the collapse's own tests.
 * ═══════════════════════════════════════════════════════════════════════════
 * `mentorCanReachSocio`'s fallback cases below were previously tested only
 * through `ownership.test.ts` (the sole caller at the time). Moved here so
 * the shared predicate has its own coverage, independent of any one caller —
 * `dashboard/learners/[id]/page.tsx` depends on the exact same logic and
 * would have had zero test coverage of it otherwise, despite duplicating it
 * in full before this collapse.
 * ═══════════════════════════════════════════════════════════════════════════
 */
beforeEach(() => {
  vi.clearAllMocks();
});

describe("mentorSocioWhere", () => {
  it("builds the strict-match predicate, no org filter when none is given", () => {
    expect(mentorSocioWhere("mentor-1")).toEqual({
      mentorId: "mentor-1",
      status: "ACTIVE",
      archivedAt: null,
    });
  });

  it("adds the participantProfile.organizationId filter when given one", () => {
    expect(mentorSocioWhere("mentor-1", "org-a")).toEqual({
      mentorId: "mentor-1",
      status: "ACTIVE",
      archivedAt: null,
      participantProfile: { organizationId: "org-a" },
    });
  });
});

describe("mentorOwnsSocio", () => {
  it("is a bare equality check, no status/archival constraint", () => {
    expect(mentorOwnsSocio({ mentorId: "mentor-1" }, "mentor-1")).toBe(true);
    expect(mentorOwnsSocio({ mentorId: "mentor-2" }, "mentor-1")).toBe(false);
    expect(mentorOwnsSocio({ mentorId: null }, "mentor-1")).toBe(false);
    expect(mentorOwnsSocio({}, "mentor-1")).toBe(false);
  });
});

describe("isSocioVisibleToMentor", () => {
  it("is true only when the DB match exists under the strict predicate", async () => {
    mocks.socioFindFirst.mockResolvedValue({ id: "socio-1" });
    expect(await isSocioVisibleToMentor("socio-1", "mentor-1")).toBe(true);

    mocks.socioFindFirst.mockResolvedValue(null);
    expect(await isSocioVisibleToMentor("socio-1", "mentor-1")).toBe(false);
  });
});

describe("mentorCanReachSocio — direct ownership", () => {
  it("authorizes when mentorId matches, without touching org resolution", async () => {
    const result = await mentorCanReachSocio({ id: "socio-1", mentorId: "mentor-1" }, "mentor-1");
    expect(result).toBe(true);
    expect(mocks.getOrganizationIdByMentorId).not.toHaveBeenCalled();
  });

  it("refuses when mentorId belongs to a different mentor (not unassigned, no fallback)", async () => {
    const result = await mentorCanReachSocio({ id: "socio-1", mentorId: "mentor-2" }, "mentor-1");
    expect(result).toBe(false);
    expect(mocks.getOrganizationIdByMentorId).not.toHaveBeenCalled();
  });
});

describe("mentorCanReachSocio — unassigned socio (org-wide fallback)", () => {
  it("authorizes a mentor reaching an unassigned socio in their own organization", async () => {
    mocks.getOrganizationIdByMentorId.mockResolvedValue("org-a");
    mocks.resolveOrganizationForSocio.mockResolvedValue({ organizationId: "org-a", source: "collection_key" });

    const result = await mentorCanReachSocio({ id: "socio-1", mentorId: null }, "mentor-1");

    expect(result).toBe(true);
  });

  it("refuses when the unassigned socio resolves to a different organization", async () => {
    mocks.getOrganizationIdByMentorId.mockResolvedValue("org-a");
    mocks.resolveOrganizationForSocio.mockResolvedValue({ organizationId: "org-b", source: "collection_key" });

    const result = await mentorCanReachSocio({ id: "socio-1", mentorId: null }, "mentor-1");

    expect(result).toBe(false);
  });

  it("refuses when the mentor has no resolvable organization at all", async () => {
    mocks.getOrganizationIdByMentorId.mockResolvedValue(null);

    const result = await mentorCanReachSocio({ id: "socio-1", mentorId: null }, "mentor-1");

    expect(result).toBe(false);
    expect(mocks.resolveOrganizationForSocio).not.toHaveBeenCalled();
  });

  it("fails closed when the socio's organization cannot be resolved at all", async () => {
    mocks.getOrganizationIdByMentorId.mockResolvedValue("org-a");
    mocks.resolveOrganizationForSocio.mockRejectedValue(new Error("no resolvable tenant"));

    const result = await mentorCanReachSocio({ id: "socio-1", mentorId: null }, "mentor-1");

    expect(result).toBe(false);
  });
});
