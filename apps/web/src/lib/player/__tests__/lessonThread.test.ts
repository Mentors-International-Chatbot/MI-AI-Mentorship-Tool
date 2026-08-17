import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: { message: { findMany: mocks.findMany } },
}));

import { getLessonThread } from "../service";

/**
 * Lesson thread scoping
 * ═══════════════════════════════════════════════════════════════════════════
 * `/api/chat/history` returns a socio's last 50 messages across every context,
 * so a learner who ever used the chat surface would find MI turns inside a
 * player lesson. That cross-course bleed is what this query exists to avoid,
 * and the three metadata predicates are the whole of the fix.
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
    // Gate turns live on their own session and are not lesson conversation.
    expect(where.assessmentSessionId).toBeNull();
    expect(where.AND).toEqual([
      { metadata: { path: ["surface"], equals: "player" } },
      { metadata: { path: ["collectionKey"], equals: "skills-tool-calls" } },
      { metadata: { path: ["lessonKey"], equals: "skills-and-tool-calls" } },
    ]);
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
    expect(where.AND[2]).toEqual({ metadata: { path: ["lessonKey"], equals: "other-lesson" } });
  });
});
