import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: { message: { findMany: mocks.findMany } },
}));

import { getLessonThread } from "../service";

/**
 * Lesson thread scoping
 * ═══════════════════════════════════════════════════════════════════════════
 * AI and learner turns remain scoped to one player lesson. Human mentor DMs
 * are learner-level communication, so they are unioned into every player
 * transcript regardless of lesson metadata.
 */
const access = {
  socioId: "socio-1", courseCode: "SKILLS", collectionKey: "skills-tool-calls",
  organizationId: "org-1", programVersionId: "pv-1", programVersion: "2026.2",
  enrollmentId: "e-1", config: { trackedDimensions: [], alertRules: [] },
} as unknown as Parameters<typeof getLessonThread>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
});

describe("getLessonThread", () => {
  it("scopes to the learner, the surface, the collection, and the lesson", async () => {
    await getLessonThread(access, "skills-and-tool-calls");

    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.socioId).toBe("socio-1");
    expect(where.OR[0]).toEqual({ senderType: "mentor" });
    // Gate turns live on their own session and are not lesson conversation.
    expect(where.OR[1].assessmentSessionId).toBeNull();
    expect(where.OR[1].AND).toEqual([
      { metadata: { path: ["surface"], equals: "player" } },
      { metadata: { path: ["collectionKey"], equals: "skills-tool-calls" } },
      { metadata: { path: ["lessonKey"], equals: "skills-and-tool-calls" } },
    ]);
    // The lesson_entry exclusion is NOT expressed as a SQL `NOT` on this
    // query — see the "excludes lesson_entry" and "does not drop a row
    // missing intent" cases below for why, and `resolveMentorMessageMetadata
    // wrote a row the thread never showed` for the incident this pins.
    expect(where.NOT).toBeUndefined();
  });

  it("excludes historical mount-generated lesson_entry rows", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "m1", role: "assistant", content: "intro", senderType: "ai", createdAt: new Date(), metadata: { surface: "player", intent: "lesson_entry" } },
      { id: "m2", role: "assistant", content: "real turn", senderType: "ai", createdAt: new Date(), metadata: { surface: "player", intent: "question" } },
    ]);

    const rows = await getLessonThread(access, "skills-and-tool-calls");
    expect(rows.map((r) => r.id)).toEqual(["m2"]);
  });

  it("does not require lesson metadata on a human mentor DM", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "mentor-1", role: "mentor", content: "Do you see this?", senderType: "mentor", createdAt: new Date(), metadata: null },
    ]);

    const rows = await getLessonThread(access, "skills-and-tool-calls");
    expect(rows.map((r) => r.id)).toEqual(["mentor-1"]);
  });

  it("reads oldest first, so the thread renders in the order it happened", async () => {
    await getLessonThread(access, "skills-and-tool-calls");
    expect(mocks.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "asc" });
  });

  it("selects the metadata the renderer branches on", async () => {
    await getLessonThread(access, "skills-and-tool-calls");
    expect(mocks.findMany.mock.calls[0][0].select).toMatchObject({
      id: true, role: true, content: true, createdAt: true, metadata: true,
    });
  });

  it("does not leak another lesson's key into the filter", async () => {
    await getLessonThread(access, "other-lesson");
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.OR[1].AND[2]).toEqual({ metadata: { path: ["lessonKey"], equals: "other-lesson" } });
  });
});
