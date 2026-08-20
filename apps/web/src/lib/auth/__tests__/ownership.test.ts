import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  getSocioById: vi.fn(),
  getOrganizationIdByMentorId: vi.fn(),
  resolveOrganizationForSocio: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ verifySession: mocks.verifySession }));
vi.mock("@/lib/repo", () => ({
  repo: { getSocioById: mocks.getSocioById },
  tenantRepo: {
    getOrganizationIdByMentorId: mocks.getOrganizationIdByMentorId,
    resolveOrganizationForSocio: mocks.resolveOrganizationForSocio,
  },
}));

import { verifyMentorOwnership } from "../ownership";

/**
 * Mentor reachability for player-surface learners
 * ═══════════════════════════════════════════════════════════════════════════
 * `verifyMentorOwnership` gates 8 dashboard routes (message, ai-toggle,
 * conversation, overrides, summaries, ...). Before this fix it 404'd any
 * mentor whose `mentorId` did not exactly match the socio — which every
 * web/`/join` signup and LTI-provisioned player learner fails by
 * construction, since nothing ever sets `mentorId` for them. The fallback
 * here mirrors the alerts-page zone 0 org-wide fallback: an unassigned socio
 * is reachable by any mentor in the same organization, not by nobody.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function socio(overrides: Partial<{ id: string; mentorId: string | null }> = {}) {
  return { id: "socio-1", mentorId: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyMentorOwnership — unauthenticated / wrong role", () => {
  it("401s with no session", async () => {
    mocks.verifySession.mockResolvedValue(null);
    const result = await verifyMentorOwnership("socio-1");
    expect(result.authorized).toBe(false);
  });

  it("403s a socio session outright", async () => {
    mocks.verifySession.mockResolvedValue({ userId: "s1", role: "socio" });
    const result = await verifyMentorOwnership("socio-1");
    expect(result.authorized).toBe(false);
  });
});

describe("verifyMentorOwnership — admin", () => {
  it("bypasses ownership entirely", async () => {
    mocks.verifySession.mockResolvedValue({ userId: "admin-1", role: "admin" });
    const result = await verifyMentorOwnership("socio-1");
    expect(result.authorized).toBe(true);
    expect(mocks.getSocioById).not.toHaveBeenCalled();
  });
});

describe("verifyMentorOwnership — mentor, assigned socio", () => {
  it("authorizes when mentorId matches, without touching org resolution", async () => {
    mocks.verifySession.mockResolvedValue({ userId: "mentor-1", role: "mentor" });
    mocks.getSocioById.mockResolvedValue(socio({ mentorId: "mentor-1" }));

    const result = await verifyMentorOwnership("socio-1");

    expect(result.authorized).toBe(true);
    expect(mocks.getOrganizationIdByMentorId).not.toHaveBeenCalled();
  });

  it("404s when mentorId belongs to a different mentor", async () => {
    mocks.verifySession.mockResolvedValue({ userId: "mentor-1", role: "mentor" });
    mocks.getSocioById.mockResolvedValue(socio({ mentorId: "mentor-2" }));

    const result = await verifyMentorOwnership("socio-1");

    expect(result.authorized).toBe(false);
  });

  it("404s when the socio does not exist", async () => {
    mocks.verifySession.mockResolvedValue({ userId: "mentor-1", role: "mentor" });
    mocks.getSocioById.mockResolvedValue(null);

    const result = await verifyMentorOwnership("socio-1");

    expect(result.authorized).toBe(false);
  });
});

describe("verifyMentorOwnership — mentor, unassigned socio (org-wide fallback)", () => {
  it("authorizes a mentor reaching an unassigned socio in their own organization", async () => {
    mocks.verifySession.mockResolvedValue({ userId: "mentor-1", role: "mentor" });
    mocks.getSocioById.mockResolvedValue(socio({ mentorId: null }));
    mocks.getOrganizationIdByMentorId.mockResolvedValue("org-a");
    mocks.resolveOrganizationForSocio.mockResolvedValue({ organizationId: "org-a", source: "collection_key" });

    const result = await verifyMentorOwnership("socio-1");

    expect(result.authorized).toBe(true);
  });

  it("404s when the unassigned socio resolves to a different organization", async () => {
    mocks.verifySession.mockResolvedValue({ userId: "mentor-1", role: "mentor" });
    mocks.getSocioById.mockResolvedValue(socio({ mentorId: null }));
    mocks.getOrganizationIdByMentorId.mockResolvedValue("org-a");
    mocks.resolveOrganizationForSocio.mockResolvedValue({ organizationId: "org-b", source: "collection_key" });

    const result = await verifyMentorOwnership("socio-1");

    expect(result.authorized).toBe(false);
  });

  it("404s when the mentor has no resolvable organization at all", async () => {
    mocks.verifySession.mockResolvedValue({ userId: "mentor-1", role: "mentor" });
    mocks.getSocioById.mockResolvedValue(socio({ mentorId: null }));
    mocks.getOrganizationIdByMentorId.mockResolvedValue(null);

    const result = await verifyMentorOwnership("socio-1");

    expect(result.authorized).toBe(false);
    expect(mocks.resolveOrganizationForSocio).not.toHaveBeenCalled();
  });

  it("fails closed when the socio's organization cannot be resolved at all", async () => {
    mocks.verifySession.mockResolvedValue({ userId: "mentor-1", role: "mentor" });
    mocks.getSocioById.mockResolvedValue(socio({ mentorId: null }));
    mocks.getOrganizationIdByMentorId.mockResolvedValue("org-a");
    mocks.resolveOrganizationForSocio.mockRejectedValue(new Error("no resolvable tenant"));

    const result = await verifyMentorOwnership("socio-1");

    expect(result.authorized).toBe(false);
  });
});
