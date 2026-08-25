/**
 * E.3: `project` blocks fall through gradePlayerBlock's generic default
 * (service.ts, the final `return` after the blockType switch) — no dedicated
 * branch exists, and none is added, since the default already does exactly
 * what an ungraded, always-completing block needs. This test pins that
 * fallthrough for `project` specifically, the same way completeBlockWebQuiz
 * pins its own dedicated branch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contentLessonFindMany: vi.fn(),
  blockProgressFindUnique: vi.fn(),
  blockProgressFindMany: vi.fn(),
  blockProgressUpsert: vi.fn(),
  messageFindFirst: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    contentLesson: { findMany: mocks.contentLessonFindMany },
    blockProgress: {
      findUnique: mocks.blockProgressFindUnique,
      findMany: mocks.blockProgressFindMany,
      upsert: mocks.blockProgressUpsert,
    },
    message: { findFirst: mocks.messageFindFirst },
  },
}));

import { completeBlock } from "@/lib/player/service";
import type { PlayerAccess } from "@/lib/player/service";

function lessonBody(project: Record<string, unknown>) {
  return {
    key: "l1", title: "l1", keyConcepts: [], selfCheckQuestions: [],
    blocks: [
      { id: "teach1", order: 1, blockType: "teach", contentVersion: 1, concepts: [], role: "explanation", content: "Some content" },
      { id: "proj1", order: 2, blockType: "project", contentVersion: 1, concepts: [], content: "Go build the thing.", ...project },
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
  mocks.messageFindFirst.mockResolvedValue(null);
});

describe("completeBlock — project", () => {
  it("completes a non-submission brief (requiresSubmission: false) via plain Continue", async () => {
    mocks.contentLessonFindMany.mockResolvedValue([
      { slug: "l1", orderIndex: 0, versions: [{ body: lessonBody({ requiresSubmission: false }) }] },
    ]);

    const result = await completeBlock(access(), "l1", "proj1", { acknowledged: true });

    expect(result.completed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.feedback).toBeNull();
    expect(result.reviewPending).toBe(false);
    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ score: 1, response: { acknowledged: true } }),
    }));
  });

  it("completes a submission-required brief (requiresSubmission: true) the same way, ungraded", async () => {
    mocks.contentLessonFindMany.mockResolvedValue([
      { slug: "l1", orderIndex: 0, versions: [{ body: lessonBody({ requiresSubmission: true, blocking: true }) }] },
    ]);

    const result = await completeBlock(access(), "l1", "proj1", { acknowledged: true });

    expect(result.completed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.feedback).toBeNull();
    expect(result.reviewPending).toBe(false);
  });

  it("stores the submitted response verbatim, same as any other unlisted block type", async () => {
    mocks.contentLessonFindMany.mockResolvedValue([
      { slug: "l1", orderIndex: 0, versions: [{ body: lessonBody({ requiresSubmission: true, blocking: true }) }] },
    ]);

    await completeBlock(access(), "l1", "proj1", { acknowledged: true, note: "submitted via chat" });

    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ response: { acknowledged: true, note: "submitted via chat" } }),
    }));
  });
});
