import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  getSocioById: vi.fn(),
  mentorCanReachSocio: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ verifySession: mocks.verifySession }));
vi.mock("@/lib/repo", () => ({
  repo: { getSocioById: mocks.getSocioById },
}));
vi.mock("@/lib/repo/mentorVisibility", () => ({
  mentorCanReachSocio: mocks.mentorCanReachSocio,
}));

import { verifyMentorOwnership } from "../ownership";

/**
 * Mentor reachability for player-surface learners
 * ═══════════════════════════════════════════════════════════════════════════
 * `verifyMentorOwnership` gates 8 dashboard routes (message, ai-toggle,
 * conversation, overrides, summaries, ...). L5 stage 2 collapsed its
 * ownership decision — including the org-wide fallback for an unassigned
 * socio — into the shared `mentorCanReachSocio` (lib/repo/mentorVisibility.ts),
 * which has its own dedicated tests covering every fallback edge case. This
 * file now only proves `verifyMentorOwnership`'s own job: role gating, and
 * delegating the actual ownership question correctly.
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

describe("verifyMentorOwnership — mentor", () => {
  it("404s when the socio does not exist, without ever calling mentorCanReachSocio", async () => {
    mocks.verifySession.mockResolvedValue({ userId: "mentor-1", role: "mentor" });
    mocks.getSocioById.mockResolvedValue(null);

    const result = await verifyMentorOwnership("socio-1");

    expect(result.authorized).toBe(false);
    expect(mocks.mentorCanReachSocio).not.toHaveBeenCalled();
  });

  it("authorizes when mentorCanReachSocio says yes", async () => {
    mocks.verifySession.mockResolvedValue({ userId: "mentor-1", role: "mentor" });
    const s = socio({ mentorId: "mentor-1" });
    mocks.getSocioById.mockResolvedValue(s);
    mocks.mentorCanReachSocio.mockResolvedValue(true);

    const result = await verifyMentorOwnership("socio-1");

    expect(result.authorized).toBe(true);
    expect(mocks.mentorCanReachSocio).toHaveBeenCalledWith(s, "mentor-1");
  });

  it("404s when mentorCanReachSocio says no", async () => {
    mocks.verifySession.mockResolvedValue({ userId: "mentor-1", role: "mentor" });
    mocks.getSocioById.mockResolvedValue(socio({ mentorId: "mentor-2" }));
    mocks.mentorCanReachSocio.mockResolvedValue(false);

    const result = await verifyMentorOwnership("socio-1");

    expect(result.authorized).toBe(false);
  });
});
