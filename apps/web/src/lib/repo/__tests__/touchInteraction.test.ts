import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), update: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { socioProgress: { upsert: mocks.upsert, update: mocks.update } },
}));

import { prismaRepo } from "../prismaRepo";

/**
 * `touchInteraction` must not assume a SocioProgress row exists
 * ═══════════════════════════════════════════════════════════════════════════
 * The row is created lazily by `getSocioProgress` → `ensureSocioProgressRow`,
 * but `handleIncomingMessage` calls `touchInteraction` before anything reaches
 * that path. A learner who signed up and joined a player course therefore has
 * no row on their first tutor turn, and the original bare `update` threw
 * P2025 — turning every first turn into a 500.
 *
 * The in-memory repo creates a default row when one is missing, so it cannot
 * reproduce this. That gap is why the bug reached a live click-through, and it
 * is why this test mocks Prisma directly instead.
 */
beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsert.mockResolvedValue({
    socioId: "socio-1", currentLessonNumber: 1, currentMessageIndex: 0,
    completedLessons: [], lastInteractionAt: new Date(), remindersSent: 0,
  });
});

describe("touchInteraction", () => {
  it("upserts, so a learner with no progress row does not 500", async () => {
    await prismaRepo.touchInteraction("socio-1");

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const call = mocks.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ socioId: "socio-1" });
    expect(call.create).toMatchObject({ socioId: "socio-1" });
    expect(call.create.lastInteractionAt).toBeInstanceOf(Date);
    expect(call.update.lastInteractionAt).toBeInstanceOf(Date);
  });

  it("creates the row with defaults rather than inventing progress", async () => {
    await prismaRepo.touchInteraction("socio-1");
    const { create } = mocks.upsert.mock.calls[0][0];
    // Anything beyond the id and the timestamp would fabricate a position in a
    // course the learner has not started.
    expect(Object.keys(create).sort()).toEqual(["lastInteractionAt", "socioId"]);
  });
});
