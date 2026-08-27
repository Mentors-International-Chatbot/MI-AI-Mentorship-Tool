/**
 * getCourseProgress (the capstone page's course-wide read) and
 * getCapstoneDto now share computeCourseProgress with getLessonDashboard
 * (lessonDashboardDto.test.ts covers that side) instead of each hand-rolling
 * its own blockProgress/milestoneProgress queries and per-lesson-completion
 * logic. These tests pin the pre-refactor output shape so the extraction
 * stays byte-identical: lessons carry orderIndex (getLessonDashboard's own
 * copy never did), milestones carry reachedAt, and getCapstoneDto's derived
 * fields (status, nextMilestone, completedMilestones, graduated,
 * currentLessonKey) are unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contentLessonFindMany: vi.fn(),
  blockProgressFindMany: vi.fn(),
  milestoneProgressFindMany: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    contentLesson: { findMany: mocks.contentLessonFindMany },
    blockProgress: { findMany: mocks.blockProgressFindMany },
    milestoneProgress: { findMany: mocks.milestoneProgressFindMany },
  },
}));

import { getCapstoneDto, getCourseProgress } from "@/lib/player/service";
import type { PlayerAccess } from "@/lib/player/service";

const LESSON_1 = {
  key: "lesson-1", title: "Lesson One", keyConcepts: [], selfCheckQuestions: [],
  blocks: [{ id: "b1", order: 1, blockType: "teach", contentVersion: 1, concepts: [], role: "explanation", content: "Hi" }],
};
const LESSON_2 = {
  key: "lesson-2", title: "Lesson Two", keyConcepts: [], selfCheckQuestions: [],
  blocks: [{ id: "b2", order: 1, blockType: "teach", contentVersion: 1, concepts: [], role: "explanation", content: "Hi" }],
};

const OUTCOME = {
  project: { title: "Capstone", description: "Build a thing", deliverables: [] },
  milestones: [
    { key: "m1", name: "Frame it", availability: { type: "after_lesson", lessonKey: "lesson-1" } },
    { key: "m2", name: "Ship it", availability: { type: "after_lesson", lessonKey: "lesson-2" } },
  ],
};

function access(config: Record<string, unknown>): PlayerAccess {
  return {
    socioId: "socio-a",
    collectionKey: "ai-essentials",
    organizationId: "org-a",
    programVersionId: "pv-a",
    programVersion: "1.0.0",
    enrollmentId: "enrollment-a",
    config,
  } as unknown as PlayerAccess;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contentLessonFindMany.mockResolvedValue([
    { slug: "lesson-1", orderIndex: 0, versions: [{ body: LESSON_1 }] },
    { slug: "lesson-2", orderIndex: 1, versions: [{ body: LESSON_2 }] },
  ]);
  mocks.blockProgressFindMany.mockResolvedValue([]);
  mocks.milestoneProgressFindMany.mockResolvedValue([]);
});

describe("getCourseProgress", () => {
  it("reports every lesson with orderIndex, title, and completion", async () => {
    mocks.blockProgressFindMany.mockResolvedValue([
      { lessonKey: "lesson-1", blockId: "b1", contentVersion: 1, completedAt: new Date("2026-01-01") },
    ]);

    const progress = await getCourseProgress(access({}));

    expect(progress.lessons).toEqual([
      { lessonKey: "lesson-1", orderIndex: 0, title: "Lesson One", complete: true },
      { lessonKey: "lesson-2", orderIndex: 1, title: "Lesson Two", complete: false },
    ]);
    expect(progress.completedBlocks).toBe(1);
  });

  it("reports milestones with key and reachedAt", async () => {
    const reachedAt = new Date("2026-02-01");
    mocks.milestoneProgressFindMany.mockResolvedValue([{ milestoneKey: "m1", reachedAt }]);

    const progress = await getCourseProgress(access({}));

    expect(progress.milestones).toEqual([{ key: "m1", reachedAt }]);
  });

  it("queries milestoneProgress by enrollment, ordered by reachedAt (the shape getLessonDashboard now shares)", async () => {
    await getCourseProgress(access({}));

    expect(mocks.milestoneProgressFindMany).toHaveBeenCalledWith({
      where: { enrollmentId: "enrollment-a" },
      orderBy: { reachedAt: "asc" },
    });
  });
});

describe("getCapstoneDto", () => {
  it("passes the project through verbatim and derives milestone status", async () => {
    const dto = await getCapstoneDto(access({ outcome: OUTCOME }));

    expect(dto.project).toEqual(OUTCOME.project);
    // Both milestones gate on after_lesson, and no lesson is complete yet, so
    // neither is eligible — milestoneStates.test.ts (grading.test.ts) covers
    // the "current" case for an immediate-availability first milestone.
    expect(dto.milestones.map((m) => m.status)).toEqual(["locked", "locked"]);
    expect(dto.nextMilestone).toBeNull();
    expect(dto.completedMilestones).toBe(0);
    expect(dto.graduated).toBe(false);
  });

  it("marks m1 current once lesson-1 is complete", async () => {
    mocks.blockProgressFindMany.mockResolvedValue([
      { lessonKey: "lesson-1", blockId: "b1", contentVersion: 1, completedAt: new Date() },
    ]);

    const dto = await getCapstoneDto(access({ outcome: OUTCOME }));

    expect(dto.milestones.map((m) => m.status)).toEqual(["current", "locked"]);
    expect(dto.nextMilestone).toMatchObject({ key: "m1" });
  });

  it("computes currentLessonKey as the first incomplete lesson, reusing the already-fetched progress", async () => {
    mocks.blockProgressFindMany.mockResolvedValue([
      { lessonKey: "lesson-1", blockId: "b1", contentVersion: 1, completedAt: new Date() },
    ]);

    const dto = await getCapstoneDto(access({ outcome: OUTCOME }));

    expect(dto.currentLessonKey).toBe("lesson-2");
    // One blockProgress read total — currentLessonKey did not trigger a second query.
    expect(mocks.blockProgressFindMany).toHaveBeenCalledTimes(1);
  });

  it("falls back currentLessonKey to the last lesson once the whole course is complete", async () => {
    mocks.blockProgressFindMany.mockResolvedValue([
      { lessonKey: "lesson-1", blockId: "b1", contentVersion: 1, completedAt: new Date() },
      { lessonKey: "lesson-2", blockId: "b2", contentVersion: 1, completedAt: new Date() },
    ]);

    const dto = await getCapstoneDto(access({ outcome: OUTCOME }));

    expect(dto.currentLessonKey).toBe("lesson-2");
  });

  it("marks graduated once every milestone is reached", async () => {
    mocks.milestoneProgressFindMany.mockResolvedValue([
      { milestoneKey: "m1", reachedAt: new Date() },
      { milestoneKey: "m2", reachedAt: new Date() },
    ]);

    const dto = await getCapstoneDto(access({ outcome: OUTCOME }));

    expect(dto.graduated).toBe(true);
    expect(dto.completedMilestones).toBe(2);
  });
});
