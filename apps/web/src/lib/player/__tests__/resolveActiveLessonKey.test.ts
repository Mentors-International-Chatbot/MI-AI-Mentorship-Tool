import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  blockProgressFindFirst: vi.fn(),
  contentLessonFindFirst: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    blockProgress: { findFirst: mocks.blockProgressFindFirst },
    contentLesson: { findFirst: mocks.contentLessonFindFirst },
  },
}));

import { resolveActiveLessonKey } from "../service";

/**
 * Best-guess lesson for a mentor DM
 * ═══════════════════════════════════════════════════════════════════════════
 * The dashboard message route has no player turn to read a `lessonKey` off,
 * so this is the only source of the metadata `getLessonThread` requires. The
 * case that matters most is the learner with no progress at all: the whole
 * bug being fixed is "written to the database, renders nowhere," and a
 * fallback that quietly returns null for a brand-new learner would reintroduce
 * exactly that.
 * ═══════════════════════════════════════════════════════════════════════════
 */
beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveActiveLessonKey", () => {
  it("prefers the most recently touched lesson when progress exists", async () => {
    mocks.blockProgressFindFirst.mockResolvedValue({ lessonKey: "lesson-04-pricing" });

    const result = await resolveActiveLessonKey("socio-1", "skills-tool-calls", "org-1");

    expect(result).toBe("lesson-04-pricing");
    expect(mocks.blockProgressFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { socioId: "socio-1", collectionKey: "skills-tool-calls" },
        orderBy: { updatedAt: "desc" },
      }),
    );
    // No progress to fall back from — the content-lesson lookup is skipped.
    expect(mocks.contentLessonFindFirst).not.toHaveBeenCalled();
  });

  it("falls back to the collection's first lesson when there is no progress yet", async () => {
    mocks.blockProgressFindFirst.mockResolvedValue(null);
    mocks.contentLessonFindFirst.mockResolvedValue({ slug: "lesson-01-intro" });

    const result = await resolveActiveLessonKey("socio-new", "skills-tool-calls", "org-1");

    expect(result).toBe("lesson-01-intro");
    expect(mocks.contentLessonFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { collection: { slug: "skills-tool-calls", organizationId: "org-1" } },
        orderBy: { orderIndex: "asc" },
      }),
    );
  });

  it("scopes the first-lesson fallback by organization, not slug alone", async () => {
    mocks.blockProgressFindFirst.mockResolvedValue(null);
    mocks.contentLessonFindFirst.mockResolvedValue(null);

    await resolveActiveLessonKey("socio-new", "shared-slug", "org-b");

    const where = mocks.contentLessonFindFirst.mock.calls[0][0].where;
    expect(where.collection.organizationId).toBe("org-b");
  });

  it("returns null, not a guess, when the collection has no lessons authored", async () => {
    mocks.blockProgressFindFirst.mockResolvedValue(null);
    mocks.contentLessonFindFirst.mockResolvedValue(null);

    const result = await resolveActiveLessonKey("socio-new", "empty-course", "org-1");

    expect(result).toBeNull();
  });
});
