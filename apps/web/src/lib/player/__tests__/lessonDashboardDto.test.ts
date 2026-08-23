/**
 * The dashboard's place in the lesson DTO.
 *
 * Two things worth holding at this level rather than the pure-function level:
 * that a course without `projectSelection` never even reads project state — the
 * guarantee that keeps MI and PB&J untouched and costs them nothing — and that
 * the project read is enrollment-scoped, so one learner's dashboard cannot be
 * built from another tenant's project.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentLearnerProject: vi.fn(),
  selectionRequired: vi.fn(),
  contentLessonFindMany: vi.fn(),
  blockProgressFindMany: vi.fn(),
  milestoneProgressFindMany: vi.fn(),
  diagnosticAttemptCount: vi.fn(),
}));

vi.mock("@/lib/player/learnerProject", () => ({
  getCurrentLearnerProject: mocks.getCurrentLearnerProject,
  learnerProjectSelectionRequired: mocks.selectionRequired,
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    contentLesson: { findMany: mocks.contentLessonFindMany },
    blockProgress: { findMany: mocks.blockProgressFindMany },
    milestoneProgress: { findMany: mocks.milestoneProgressFindMany },
    diagnosticAttempt: { count: mocks.diagnosticAttemptCount },
  },
}));

import { getLessonDto } from "@/lib/player/service";
import type { PlayerAccess } from "@/lib/player/service";

const LESSON_BODY = {
  key: "l1",
  title: "AI in a GSCM Day",
  keyConcepts: [],
  selfCheckQuestions: [],
  blocks: [{
    id: "b1", order: 1, blockType: "teach", contentVersion: 1,
    concepts: [], role: "explanation", content: "Hello",
  }],
};

const PROJECT_SELECTION = { presets: [], interestTopics: [] };

const OUTCOME = {
  project: { title: "Capstone", deliverables: [] },
  milestones: [
    { key: "m1", name: "Frame it", availability: { type: "after_lesson", lessonKey: "l1" } },
    { key: "m2", name: "Ship it", availability: { type: "after_lesson", lessonKey: "l2" } },
  ],
};

function access(config: Record<string, unknown>): PlayerAccess {
  return {
    socioId: "socio-a",
    collectionKey: "ai-essentials",
    organizationId: "org-a",
    programVersionId: "pv-a",
    programVersion: "1.1.2",
    enrollmentId: "enrollment-a",
    config,
  } as unknown as PlayerAccess;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectionRequired.mockResolvedValue(false);
  mocks.diagnosticAttemptCount.mockResolvedValue(1);
  mocks.contentLessonFindMany.mockResolvedValue([
    { slug: "l1", orderIndex: 0, versions: [{ body: LESSON_BODY }] },
  ]);
  mocks.blockProgressFindMany.mockResolvedValue([]);
  mocks.milestoneProgressFindMany.mockResolvedValue([]);
  mocks.getCurrentLearnerProject.mockResolvedValue(null);
});

describe("getLessonDto — courses without project selection", () => {
  it("returns a null dashboard and never reads project state (MI, PB&J)", async () => {
    const dto = await getLessonDto(access({}), "l1");

    expect(dto.dashboard).toBeNull();
    expect(mocks.getCurrentLearnerProject).not.toHaveBeenCalled();
    expect(mocks.milestoneProgressFindMany).not.toHaveBeenCalled();
  });

  it("leaves the rest of the lesson payload untouched", async () => {
    const dto = await getLessonDto(access({}), "l1");

    expect(dto.lesson.title).toBe("AI in a GSCM Day");
    expect(dto.lesson.blocks).toHaveLength(1);
    expect(dto.progress).toHaveLength(1);
    expect(dto.nextLessonKey).toBeNull();
  });
});

describe("getLessonDto — learner without a confirmed project", () => {
  it("returns a null dashboard when no project row exists", async () => {
    const dto = await getLessonDto(access({ projectSelection: PROJECT_SELECTION }), "l1");

    expect(dto.dashboard).toBeNull();
    expect(mocks.getCurrentLearnerProject).toHaveBeenCalledTimes(1);
  });

  it("returns a null dashboard while the project is still DRAFT", async () => {
    mocks.getCurrentLearnerProject.mockResolvedValue({
      title: null, oneLiner: null, context: null, status: "DRAFT",
    });

    const dto = await getLessonDto(access({ projectSelection: PROJECT_SELECTION }), "l1");
    expect(dto.dashboard).toBeNull();
  });
});

describe("getLessonDto — learner with an active project", () => {
  beforeEach(() => {
    mocks.getCurrentLearnerProject.mockResolvedValue({
      title: "Morning brief",
      oneLiner: "Know what is due",
      context: "Class plus a job",
      status: "ACTIVE",
    });
  });

  it("builds the dashboard with lesson progress leading", async () => {
    const dto = await getLessonDto(
      access({ projectSelection: PROJECT_SELECTION, outcome: OUTCOME }), "l1");

    expect(dto.dashboard).not.toBeNull();
    expect(dto.dashboard!.project.title).toBe("Morning brief");
    expect(dto.dashboard!.lessonsComplete).toBe(0);
    expect(dto.dashboard!.lessonsTotal).toBe(1);
    expect(dto.dashboard!.milestones).toHaveLength(2);
    // Nothing is unblocked at zero completions, so the first locked milestone
    // is named with what unlocks it.
    expect(dto.dashboard!.nextMilestone).toMatchObject({
      key: "m1", locked: true, unlocksAfterLessonTitle: "AI in a GSCM Day",
    });
  });

  it("scopes the project read to this learner's enrollment", async () => {
    await getLessonDto(access({ projectSelection: PROJECT_SELECTION }), "l1");

    expect(mocks.getCurrentLearnerProject).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", enrollmentId: "enrollment-a" }),
    );
  });

  it("scopes progress reads to this learner's enrollment, not the collection at large", async () => {
    // A.6.1 addendum: was socioId+collectionKey, which would have carried an
    // archived enrollment's completed milestones into a fresh retake's
    // dashboard. enrollmentId is strictly narrower — it still protects the
    // original intent here (this learner's dashboard cannot be built from
    // another socio's progress, since a socio's enrollments are never
    // shared) while also isolating one enrollment from another of the same
    // socio's in the same collection.
    await getLessonDto(access({ projectSelection: PROJECT_SELECTION, outcome: OUTCOME }), "l1");

    expect(mocks.milestoneProgressFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enrollmentId: "enrollment-a" },
        select: { milestoneKey: true },
      }),
    );
  });

  it("counts a milestone as reached from this learner's own progress rows", async () => {
    mocks.milestoneProgressFindMany.mockResolvedValue([{ milestoneKey: "m1" }]);

    const dto = await getLessonDto(
      access({ projectSelection: PROJECT_SELECTION, outcome: OUTCOME }), "l1");

    expect(dto.dashboard!.milestonesReached).toBe(1);
    expect(dto.dashboard!.milestones[0].status).toBe("reached");
  });

  it("still renders the project card when the course declares no outcome", async () => {
    const dto = await getLessonDto(access({ projectSelection: PROJECT_SELECTION }), "l1");

    expect(dto.dashboard!.milestones).toEqual([]);
    expect(dto.dashboard!.nextMilestone).toBeNull();
    expect(dto.dashboard!.project.title).toBe("Morning brief");
  });

  it("degrades to no dashboard rather than failing the lesson", async () => {
    // A dashboard is decoration around the thing the learner came for.
    mocks.getCurrentLearnerProject.mockRejectedValue(new Error("project read failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const dto = await getLessonDto(access({ projectSelection: PROJECT_SELECTION }), "l1");

    expect(dto.dashboard).toBeNull();
    expect(dto.lesson.title).toBe("AI in a GSCM Day");
    warn.mockRestore();
  });
});
