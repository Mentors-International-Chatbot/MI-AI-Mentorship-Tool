/**
 * C.1: the block-level milestoneRef write path — the mechanism this phase's
 * investigation found entirely missing on the player surface (recordMilestoneReached
 * was only ever called from the chat-surface handler). These pin that a `teach`
 * block carrying `milestoneRef`/`interleavePrompt` actually writes MilestoneProgress
 * via the player surface now, and that the write only happens on an explicit
 * "done" — never implicitly on ordinary block completion.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contentLessonFindMany: vi.fn(),
  blockProgressFindUnique: vi.fn(),
  blockProgressFindMany: vi.fn(),
  blockProgressUpsert: vi.fn(),
  blockProgressUpdate: vi.fn(),
  messageFindFirst: vi.fn(),
  milestoneProgressFindFirst: vi.fn(),
  recordMilestoneReached: vi.fn(),
  queueMilestoneGrade: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    contentLesson: { findMany: mocks.contentLessonFindMany },
    blockProgress: {
      findUnique: mocks.blockProgressFindUnique,
      findMany: mocks.blockProgressFindMany,
      upsert: mocks.blockProgressUpsert,
      update: mocks.blockProgressUpdate,
    },
    message: { findFirst: mocks.messageFindFirst },
    milestoneProgress: { findFirst: mocks.milestoneProgressFindFirst },
  },
}));

vi.mock("@/lib/repo", () => ({
  repo: { recordMilestoneReached: mocks.recordMilestoneReached },
  tenantRepo: {},
}));

// The other half of the same gap: queueMilestoneGrade reads MilestoneProgress
// and enqueues the Canvas score. It was, like recordMilestoneReached, only
// ever called from the chat-surface handler — mocked here so "done" writing
// a milestone with no grade queued (the silent-zero-grade risk) is asserted
// against directly, not left to an unmocked real call in a unit test.
vi.mock("@/lib/lti/grades", () => ({ queueMilestoneGrade: mocks.queueMilestoneGrade }));

import { completeBlock, PlayerError } from "@/lib/player/service";
import type { PlayerAccess } from "@/lib/player/service";

function lessonBody(teachOverrides: Record<string, unknown> = {}) {
  return {
    key: "l1", title: "l1", keyConcepts: [], selfCheckQuestions: [],
    blocks: [
      {
        id: "teach1", order: 1, blockType: "teach", contentVersion: 1, concepts: [],
        role: "explanation", content: "Some content",
        milestoneRef: "milestone-1", interleavePrompt: "Go work on your project process now.",
        ...teachOverrides,
      },
      { id: "teach2", order: 2, blockType: "teach", contentVersion: 1, concepts: [], role: "explanation", content: "Next block" },
    ],
  };
}

function access(): PlayerAccess {
  return {
    socioId: "socio-a", collectionKey: "ai-essentials", organizationId: "org-a",
    programVersionId: "pv-a", programVersion: "1.1.2", enrollmentId: "enrollment-a",
    introMessage: null,
    config: {},
  } as unknown as PlayerAccess;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.blockProgressFindUnique.mockResolvedValue(null);
  mocks.blockProgressFindMany.mockResolvedValue([]);
  mocks.blockProgressUpsert.mockResolvedValue({});
  mocks.blockProgressUpdate.mockResolvedValue({});
  mocks.messageFindFirst.mockResolvedValue(null);
  mocks.milestoneProgressFindFirst.mockResolvedValue(null);
  mocks.queueMilestoneGrade.mockResolvedValue(undefined);
  mocks.contentLessonFindMany.mockResolvedValue([
    { slug: "l1", orderIndex: 0, versions: [{ body: lessonBody() }] },
  ]);
});

describe("completeBlock — milestoneRef interleave", () => {
  it("completing the block never writes MilestoneProgress on its own", async () => {
    await completeBlock(access(), "l1", "teach1", { acknowledged: true });
    expect(mocks.recordMilestoneReached).not.toHaveBeenCalled();
  });

  it("returns the authored interleave prompt when the milestone isn't reached yet", async () => {
    const result = await completeBlock(access(), "l1", "teach1", { acknowledged: true });
    expect(result.interleave).toEqual({ milestoneKey: "milestone-1", prompt: "Go work on your project process now." });
  });

  it("returns no interleave once the milestone is already reached", async () => {
    mocks.milestoneProgressFindFirst.mockResolvedValue({ id: "mp-1" });
    const result = await completeBlock(access(), "l1", "teach1", { acknowledged: true });
    expect(result.interleave).toBeNull();
  });

  it("a plain teach block with no milestoneRef never returns an interleave", async () => {
    const result = await completeBlock(access(), "l1", "teach2", { acknowledged: true });
    expect(result.interleave).toBeNull();
    expect(mocks.milestoneProgressFindFirst).not.toHaveBeenCalled();
  });

  it('interleaveAction "done" records the milestone, scoped to this enrollment/org/collection', async () => {
    mocks.blockProgressFindUnique.mockResolvedValue({ contentVersion: 1, completedAt: new Date(), score: 1, response: {}, state: null });

    const result = await completeBlock(access(), "l1", "teach1", undefined, { interleaveAction: "done" });

    expect(mocks.recordMilestoneReached).toHaveBeenCalledWith({
      socioId: "socio-a",
      organizationId: "org-a",
      collectionKey: "ai-essentials",
      milestoneKey: "milestone-1",
      enrollmentId: "enrollment-a",
      source: "learner_confirmed",
    });
    expect(result.interleave).toBeNull();
    expect(result.completed).toBe(true);
  });

  it('interleaveAction "done" also queues the Canvas grade — the other half of the same gap', async () => {
    // recordMilestoneReached alone writes the row; queueMilestoneGrade is
    // what actually enqueues the score delivery. Missing this call is
    // exactly how a BYU learner's capstone line item stays silently
    // un-posted even after "done" recorded the milestone.
    mocks.blockProgressFindUnique.mockResolvedValue({ contentVersion: 1, completedAt: new Date(), score: 1, response: {}, state: null });

    await completeBlock(access(), "l1", "teach1", undefined, { interleaveAction: "done" });

    expect(mocks.queueMilestoneGrade).toHaveBeenCalledWith("socio-a", "ai-essentials");
  });

  it('interleaveAction "skip" advances without recording anything or queuing a grade', async () => {
    mocks.blockProgressFindUnique.mockResolvedValue({ contentVersion: 1, completedAt: new Date(), score: 1, response: {}, state: null });

    const result = await completeBlock(access(), "l1", "teach1", undefined, { interleaveAction: "skip" });

    expect(mocks.recordMilestoneReached).not.toHaveBeenCalled();
    expect(mocks.queueMilestoneGrade).not.toHaveBeenCalled();
    expect(result.completed).toBe(true);
  });

  it('a grade-queueing failure does not fail the learner\'s "done" action', async () => {
    mocks.blockProgressFindUnique.mockResolvedValue({ contentVersion: 1, completedAt: new Date(), score: 1, response: {}, state: null });
    mocks.queueMilestoneGrade.mockRejectedValue(new Error("Canvas token request failed"));

    const result = await completeBlock(access(), "l1", "teach1", undefined, { interleaveAction: "done" });

    expect(result.completed).toBe(true);
  });

  it("interleaveAction on a not-yet-completed block is rejected, not silently accepted", async () => {
    mocks.blockProgressFindUnique.mockResolvedValue(null);

    await expect(
      completeBlock(access(), "l1", "teach1", undefined, { interleaveAction: "done" }),
    ).rejects.toBeInstanceOf(PlayerError);
    expect(mocks.recordMilestoneReached).not.toHaveBeenCalled();
  });

  it("interleaveAction on a block with no milestoneRef is rejected", async () => {
    mocks.blockProgressFindUnique.mockResolvedValue({ contentVersion: 1, completedAt: new Date(), score: 1, response: {}, state: null });

    await expect(
      completeBlock(access(), "l1", "teach2", undefined, { interleaveAction: "done" }),
    ).rejects.toBeInstanceOf(PlayerError);
    expect(mocks.recordMilestoneReached).not.toHaveBeenCalled();
  });
});
