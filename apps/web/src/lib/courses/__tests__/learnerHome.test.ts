import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  socioFindUnique: vi.fn(),
  programVersionFindFirst: vi.fn(),
  diagnosticAttemptCount: vi.fn(),
  blockProgressFindMany: vi.fn(),
  learnerProjectSelectionRequired: vi.fn(),
  resolveDelivery: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    socio: { findUnique: mocks.socioFindUnique },
    programVersion: { findFirst: mocks.programVersionFindFirst },
    diagnosticAttempt: { count: mocks.diagnosticAttemptCount },
    blockProgress: { findMany: mocks.blockProgressFindMany },
  },
}));

vi.mock("@/lib/journey-package/delivery", () => ({
  resolveDelivery: mocks.resolveDelivery,
}));

vi.mock("@/lib/player/learnerProject", () => ({
  learnerProjectSelectionRequired: mocks.learnerProjectSelectionRequired,
}));

import { resolveLearnerHome } from "../learnerHome";

/**
 * A.5 (Platform Restructure Phase A, Stage 5): resolveLearnerHome no longer
 * makes a separate `enrollment.findFirst` call at all — it selects each
 * ACTIVE enrollment (id, programVersionId, collectionKey) directly off the
 * socio query, then resolves each one's version by exact id. This is what
 * makes multi-course possible: the function can enumerate every active
 * enrollment instead of asking "does the one matching curriculumCollectionKey
 * exist."
 */
function socioWithEnrollments(enrollments: Array<{ id: string; programVersionId: string; collectionKey: string; listed?: boolean }>, curriculumCollectionKey: string | null = "ai-essentials") {
  return {
    id: "learner-1",
    curriculumCollectionKey,
    participantProfile: {
      id: "participant-1",
      enrollments: enrollments.map(({ listed, ...enrollment }) => ({
        ...enrollment,
        // D4: mirrors resolveListed()'s source of truth (ProgramVersion.metadata.listed).
        programVersion: listed === undefined ? null : { metadata: { listed } },
      })),
    },
  };
}

describe("resolveLearnerHome version pinning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.socioFindUnique.mockResolvedValue(socioWithEnrollments([
      { id: "enrollment-1", programVersionId: "archived-version", collectionKey: "ai-essentials" },
    ]));
    mocks.programVersionFindFirst.mockResolvedValue({
      id: "archived-version",
      status: "archived",
      metadata: { delivery: { surface: "player", supportedChannels: ["web"] } },
      config: { onboarding: { mode: "baseline_quiz" } },
      program: { organizationId: "org-1" },
      collection: { lessons: [] },
    });
    mocks.learnerProjectSelectionRequired.mockResolvedValue(false);
    mocks.resolveDelivery.mockReturnValue({ surface: "player", supportedChannels: ["web"] });
    mocks.diagnosticAttemptCount.mockResolvedValue(1);
    mocks.blockProgressFindMany.mockResolvedValue([]);
  });

  it("keeps an existing learner on the archived version pinned by their active enrollment", async () => {
    await expect(resolveLearnerHome("learner-1")).resolves.toEqual({ kind: "redirect", path: "/learn/AIESS/capstone" });

    expect(mocks.programVersionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "archived-version",
        status: { in: ["published", "archived"] },
      }),
    }));
  });

  it("routes project setup before consulting the baseline diagnostic", async () => {
    mocks.socioFindUnique.mockResolvedValueOnce(socioWithEnrollments([
      { id: "enrollment-1", programVersionId: "published-version", collectionKey: "ai-essentials" },
    ]));
    mocks.programVersionFindFirst.mockResolvedValueOnce({
      id: "published-version",
      status: "published",
      metadata: { delivery: { surface: "player", supportedChannels: ["web"] } },
      config: {
        projectSelection: {
          presets: [{ key: "brief", family: "routine", label: "Brief", defaultLevel: "L1", exampleContexts: ["Class"] }],
          interestTopics: [
            { key: "one", label: "One", dimensions: ["working_with_ai"], presetAffinity: ["brief"] },
            { key: "two", label: "Two", dimensions: ["how_ai_works"], presetAffinity: ["brief"] },
          ],
        },
        onboarding: { mode: "baseline_quiz" },
      },
      program: { organizationId: "org-1" },
      collection: { lessons: [] },
    });
    mocks.learnerProjectSelectionRequired.mockResolvedValueOnce(true);

    await expect(resolveLearnerHome("learner-1")).resolves.toEqual({ kind: "redirect", path: "/learn/AIESS/project-setup" });
    expect(mocks.diagnosticAttemptCount).not.toHaveBeenCalled();
  });

  it("publishing a new ProgramVersion for the collection does not change what an already-enrolled learner sees (Stage 2 pinning invariant)", async () => {
    // The learner's enrollment is pinned to "old-version". A newer version of
    // the same collection has since been published — resolveLearnerHome must
    // never consult it for someone who is already enrolled.
    mocks.socioFindUnique.mockResolvedValue(socioWithEnrollments([
      { id: "enrollment-1", programVersionId: "old-version", collectionKey: "ai-essentials" },
    ]));

    await resolveLearnerHome("learner-1");

    // The version lookup is scoped to the exact pinned id, never an
    // orderBy-latest query unscoped by id — that would be the floating bug
    // this test exists to forbid.
    expect(mocks.programVersionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "old-version" }),
      }),
    );
    // Never called with a "latest published, no id filter" shape.
    for (const call of mocks.programVersionFindFirst.mock.calls) {
      const where = call[0]?.where ?? {};
      if (!('id' in where)) {
        throw new Error("resolveLearnerHome queried programVersion without pinning to an id — this floats an enrolled learner to whatever is latest");
      }
    }
  });

  it.each(["mi-colombia-curriculum", "pbj-basics"])("keeps legacy chat routing unchanged for %s", async (collectionKey) => {
    mocks.socioFindUnique.mockResolvedValueOnce(socioWithEnrollments([
      { id: "enrollment-1", programVersionId: "legacy-version", collectionKey },
    ], collectionKey));
    mocks.programVersionFindFirst.mockResolvedValueOnce({
      id: "legacy-version",
      status: "published",
      metadata: {},
      config: {},
      program: { organizationId: "org-1" },
      collection: { lessons: [] },
    });
    mocks.resolveDelivery.mockReturnValueOnce({ surface: "chat", supportedChannels: ["web"] });

    await expect(resolveLearnerHome("learner-1")).resolves.toEqual({ kind: "redirect", path: "/chat" });
    expect(mocks.learnerProjectSelectionRequired).not.toHaveBeenCalled();
  });

  it("returns 'choose' with a link per course when more than one ACTIVE enrollment exists, never picking one", async () => {
    mocks.socioFindUnique.mockResolvedValueOnce(socioWithEnrollments([
      { id: "enrollment-1", programVersionId: "aiess-version", collectionKey: "ai-essentials" },
      { id: "enrollment-2", programVersionId: "skills-version", collectionKey: "skills-tool-calls" },
    ]));
    mocks.programVersionFindFirst.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === "aiess-version") {
        return { id: "aiess-version", status: "published", metadata: {}, config: {}, program: { organizationId: "org-1" }, collection: { lessons: [] } };
      }
      if (args.where.id === "skills-version") {
        return { id: "skills-version", status: "published", metadata: {}, config: {}, program: { organizationId: "org-1" }, collection: { lessons: [] } };
      }
      return null;
    });
    mocks.resolveDelivery.mockReturnValue({ surface: "player", supportedChannels: ["web"] });
    mocks.learnerProjectSelectionRequired.mockResolvedValue(false);
    mocks.diagnosticAttemptCount.mockResolvedValue(1);

    const result = await resolveLearnerHome("learner-1");

    expect(result.kind).toBe("choose");
    if (result.kind === "choose") {
      expect(result.courses).toHaveLength(2);
      expect(result.courses.map((c) => c.courseCode).sort()).toEqual(["AIESS", "SKILLS"]);
    }
  });

  it("A.6.6: excludes an unlisted course (MI2024) from the choose-list, collapsing to a direct redirect for the one remaining listed course", async () => {
    mocks.socioFindUnique.mockResolvedValueOnce(socioWithEnrollments([
      { id: "enrollment-1", programVersionId: "mi2024-version", collectionKey: "mi-colombia-curriculum", listed: false },
      { id: "enrollment-2", programVersionId: "skills-version", collectionKey: "skills-tool-calls", listed: true },
    ]));
    mocks.programVersionFindFirst.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === "skills-version") {
        return { id: "skills-version", status: "published", metadata: {}, config: {}, program: { organizationId: "org-1" }, collection: { lessons: [] } };
      }
      return null;
    });
    mocks.resolveDelivery.mockReturnValue({ surface: "player", supportedChannels: ["web"] });
    mocks.learnerProjectSelectionRequired.mockResolvedValue(false);
    mocks.diagnosticAttemptCount.mockResolvedValue(1);

    const result = await resolveLearnerHome("learner-1");

    expect(result.kind).toBe("redirect");
    // MI2024's programVersion (mi2024-version) is never even resolved — the
    // unlisted enrollment is filtered out before resolveCoursePath runs.
    expect(mocks.programVersionFindFirst).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "mi2024-version" }) }));
  });

  it("A.6.6: a learner whose only active enrollments are all unlisted falls back like zero enrollments, not an empty choose-list", async () => {
    mocks.socioFindUnique.mockResolvedValueOnce(socioWithEnrollments([
      { id: "enrollment-1", programVersionId: "mi2024-version", collectionKey: "mi-colombia-curriculum", listed: false },
      { id: "enrollment-2", programVersionId: "other-unlisted-version", collectionKey: "some-other-course", listed: false },
    ]));

    const result = await resolveLearnerHome("learner-1");

    expect(result).toEqual({ kind: "redirect", path: "/join?error=not-enrolled" });
    expect(mocks.programVersionFindFirst).not.toHaveBeenCalled();
  });

  it("still resolves straight through when exactly one ACTIVE enrollment exists (unchanged UX)", async () => {
    // Same fixture shape as the default beforeEach — one enrollment — but
    // named explicitly as its own case per the Stage 5 tie-break decision:
    // exactly one must NOT go through the 'choose' path.
    const result = await resolveLearnerHome("learner-1");
    expect(result.kind).toBe("redirect");
  });

  it("resolves to /join when there are zero ACTIVE enrollments", async () => {
    mocks.socioFindUnique.mockResolvedValueOnce(socioWithEnrollments([], null));

    await expect(resolveLearnerHome("learner-1")).resolves.toEqual({ kind: "redirect", path: "/join" });
  });

  it("a specific programVersionId (LTI) always resolves to a single redirect, never 'choose', even with other active enrollments elsewhere", async () => {
    mocks.socioFindUnique.mockResolvedValueOnce(socioWithEnrollments([
      { id: "enrollment-1", programVersionId: "aiess-version", collectionKey: "ai-essentials" },
      { id: "enrollment-2", programVersionId: "skills-version", collectionKey: "skills-tool-calls" },
    ]));
    mocks.programVersionFindFirst.mockResolvedValueOnce({
      id: "skills-version", status: "published", metadata: {}, config: {}, program: { organizationId: "org-1" }, collection: { lessons: [] },
    });
    mocks.resolveDelivery.mockReturnValueOnce({ surface: "player", supportedChannels: ["canvas"] });
    mocks.learnerProjectSelectionRequired.mockResolvedValueOnce(false);
    mocks.diagnosticAttemptCount.mockResolvedValueOnce(1);

    const result = await resolveLearnerHome("learner-1", "canvas", "skills-version");
    expect(result.kind).toBe("redirect");
  });
});
