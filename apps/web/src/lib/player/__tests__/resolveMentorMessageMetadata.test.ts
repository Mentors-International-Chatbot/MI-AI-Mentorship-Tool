import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  programVersionFindFirst: vi.fn(),
  blockProgressFindFirst: vi.fn(),
  contentLessonFindFirst: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    programVersion: { findFirst: mocks.programVersionFindFirst },
    blockProgress: { findFirst: mocks.blockProgressFindFirst },
    contentLesson: { findFirst: mocks.contentLessonFindFirst },
  },
}));

import { resolveMentorMessageMetadata } from "../service";

/**
 * What a mentor DM should be stamped with, if anything
 * ═══════════════════════════════════════════════════════════════════════════
 * `curriculumCollectionKey` alone cannot distinguish a player learner from an
 * MI one — `/api/auth/curriculum` writes it for every course, MI included, so
 * an MI socio can carry `curriculumCollectionKey: "mi-colombia-curriculum"`
 * exactly like a player learner carries `"skills-tool-calls"`. The frozen MI
 * fixture (`mi-model-input.json`) has this field set, which is what makes
 * this distinction load-bearing rather than academic: gating on presence
 * alone would have stamped player metadata onto MI's own takeover messages.
 * ═══════════════════════════════════════════════════════════════════════════
 */
beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveMentorMessageMetadata — MI / chat-surface courses", () => {
  it("returns undefined for a chat-surface course, even with a resolvable collection", async () => {
    mocks.programVersionFindFirst.mockResolvedValue({
      metadata: { delivery: { surface: "chat", supportedChannels: ["whatsapp", "web"] } },
    });

    const result = await resolveMentorMessageMetadata("socio-mi", "mi-colombia-curriculum", "org-1");

    expect(result).toBeUndefined();
    // Chat-surface courses never need a lesson guess.
    expect(mocks.blockProgressFindFirst).not.toHaveBeenCalled();
  });

  it("returns undefined for legacy/null delivery metadata (defaults to chat)", async () => {
    mocks.programVersionFindFirst.mockResolvedValue({ metadata: null });

    const result = await resolveMentorMessageMetadata("socio-mi", "mi-colombia-curriculum", "org-1");

    expect(result).toBeUndefined();
  });

  it("returns undefined when no published/archived version exists for the collection", async () => {
    mocks.programVersionFindFirst.mockResolvedValue(null);

    const result = await resolveMentorMessageMetadata("socio-x", "some-key", "org-1");

    expect(result).toBeUndefined();
  });
});

describe("resolveMentorMessageMetadata — player-surface courses", () => {
  beforeEach(() => {
    mocks.programVersionFindFirst.mockResolvedValue({
      metadata: { delivery: { surface: "player", supportedChannels: ["web"] } },
    });
  });

  it("stamps surface, collectionKey and the resolved lessonKey", async () => {
    mocks.blockProgressFindFirst.mockResolvedValue({ lessonKey: "lesson-04-pricing" });

    const result = await resolveMentorMessageMetadata("socio-1", "skills-tool-calls", "org-1");

    expect(result).toEqual({
      surface: "player",
      collectionKey: "skills-tool-calls",
      lessonKey: "lesson-04-pricing",
    });
  });

  it("still returns metadata — without a lessonKey — for a learner with no progress yet", async () => {
    mocks.blockProgressFindFirst.mockResolvedValue(null);
    mocks.contentLessonFindFirst.mockResolvedValue({ slug: "lesson-01-intro" });

    const result = await resolveMentorMessageMetadata("socio-new", "skills-tool-calls", "org-1");

    // The first-lesson fallback resolved something, so it is included.
    expect(result).toEqual({
      surface: "player",
      collectionKey: "skills-tool-calls",
      lessonKey: "lesson-01-intro",
    });
  });

  it("degrades to surface + collectionKey only when even the first-lesson fallback finds nothing", async () => {
    mocks.blockProgressFindFirst.mockResolvedValue(null);
    mocks.contentLessonFindFirst.mockResolvedValue(null);

    const result = await resolveMentorMessageMetadata("socio-new", "empty-course", "org-1");

    // Still written — the whole point is that the message never renders
    // nowhere, even in the degenerate case.
    expect(result).toEqual({ surface: "player", collectionKey: "empty-course" });
  });

  it("scopes the published-version lookup to the resolved organization", async () => {
    await resolveMentorMessageMetadata("socio-1", "shared-slug", "org-b");

    const where = mocks.programVersionFindFirst.mock.calls[0][0].where;
    expect(where.collection).toEqual({ slug: "shared-slug", organizationId: "org-b" });
  });
});
