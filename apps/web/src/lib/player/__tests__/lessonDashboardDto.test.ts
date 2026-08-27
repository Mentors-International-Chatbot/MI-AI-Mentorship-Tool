/**
 * The dashboard's place in the lesson DTO.
 *
 * Three independent gates, not one: `progressPanel.enabled` (lesson progress
 * + whole-course list — opt-in per course, since PB&J and skills-tool-calls
 * are live courses that have never shown this panel), `outcome` (milestones
 * + capstone link), and `projectSelection` (the project card, sourced from
 * the learner's own AI-guided project selection). These used to be one gate
 * (`projectSelection`), which meant no course could get lesson-progress
 * visibility without also taking on project selection's separate mandatory
 * pre-course conversation and 403 entry gate.
 *
 * Two things worth holding at this level rather than the pure-function level:
 * that a course with `progressPanel` off never reads any progress state at
 * all — the guarantee that keeps every course untouched until it opts in —
 * and that the project read is enrollment-scoped, so one learner's dashboard
 * cannot be built from another tenant's project.
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

const PROGRESS_PANEL = { enabled: true };
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

describe("getLessonDto — progressPanel not enabled", () => {
  it("returns a null dashboard and reads no course-wide progress state, even with projectSelection/outcome configured", async () => {
    const dto = await getLessonDto(
      access({ projectSelection: PROJECT_SELECTION, outcome: OUTCOME }), "l1");

    expect(dto.dashboard).toBeNull();
    expect(mocks.getCurrentLearnerProject).not.toHaveBeenCalled();
    // blockProgressFindMany is still called once here — that's getLessonDto's
    // own per-lesson progress read (`{enrollmentId, lessonKey}`, unconditional,
    // needed for `dto.progress` regardless of the dashboard). The dashboard's
    // own course-wide read (`{enrollmentId}` only, via computeCourseProgress)
    // is what stays untouched — milestoneProgressFindMany has no other caller,
    // so this is still the clean signal that the dashboard path never ran.
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

describe("getLessonDto — progressPanel enabled, no projectSelection, no outcome (skills-tool-calls shape)", () => {
  it("renders lesson progress with no project card and no milestones", async () => {
    const dto = await getLessonDto(access({ progressPanel: PROGRESS_PANEL }), "l1");

    expect(dto.dashboard).not.toBeNull();
    expect(dto.dashboard!.project).toBeNull();
    expect(dto.dashboard!.lessonsTotal).toBe(1);
    expect(dto.dashboard!.lessons).toEqual([{ lessonKey: "l1", title: "AI in a GSCM Day", complete: false }]);
    expect(dto.dashboard!.milestones).toEqual([]);
    expect(mocks.getCurrentLearnerProject).not.toHaveBeenCalled();
  });
});

describe("getLessonDto — progressPanel enabled, outcome only, no projectSelection (PB&J shape)", () => {
  it("renders milestones with no project card", async () => {
    const dto = await getLessonDto(access({ progressPanel: PROGRESS_PANEL, outcome: OUTCOME }), "l1");

    expect(dto.dashboard!.project).toBeNull();
    expect(dto.dashboard!.milestones).toHaveLength(2);
    expect(dto.dashboard!.nextMilestone).toMatchObject({ key: "m1", locked: true });
    expect(mocks.getCurrentLearnerProject).not.toHaveBeenCalled();
  });
});

describe("getLessonDto — progressPanel + projectSelection, learner without a confirmed project", () => {
  it("still renders progress; only the project card is absent", async () => {
    const dto = await getLessonDto(
      access({ progressPanel: PROGRESS_PANEL, projectSelection: PROJECT_SELECTION }), "l1");

    expect(dto.dashboard).not.toBeNull();
    expect(dto.dashboard!.project).toBeNull();
    expect(dto.dashboard!.lessonsTotal).toBe(1);
    expect(mocks.getCurrentLearnerProject).toHaveBeenCalledTimes(1);
  });

  it("renders progress without a project card while the project is still DRAFT", async () => {
    mocks.getCurrentLearnerProject.mockResolvedValue({
      title: null, oneLiner: null, context: null, status: "DRAFT",
    });

    const dto = await getLessonDto(
      access({ progressPanel: PROGRESS_PANEL, projectSelection: PROJECT_SELECTION }), "l1");

    expect(dto.dashboard).not.toBeNull();
    expect(dto.dashboard!.project).toBeNull();
  });
});

describe("getLessonDto — progressPanel + projectSelection, learner with an active project", () => {
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
      access({ progressPanel: PROGRESS_PANEL, projectSelection: PROJECT_SELECTION, outcome: OUTCOME }), "l1");

    expect(dto.dashboard).not.toBeNull();
    expect(dto.dashboard!.project!.title).toBe("Morning brief");
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
    await getLessonDto(access({ progressPanel: PROGRESS_PANEL, projectSelection: PROJECT_SELECTION }), "l1");

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
    //
    // The query itself runs through computeCourseProgress, shared with
    // getCourseProgress (the capstone page) — no `select:
    // {milestoneKey: true}` narrowing, since getCourseProgress's own output
    // contract needs `reachedAt` too. getLessonDashboard still only reads
    // `.key` off the result.
    await getLessonDto(
      access({ progressPanel: PROGRESS_PANEL, projectSelection: PROJECT_SELECTION, outcome: OUTCOME }), "l1");

    expect(mocks.milestoneProgressFindMany).toHaveBeenCalledWith({
      where: { enrollmentId: "enrollment-a" },
      orderBy: { reachedAt: "asc" },
    });
  });

  it("counts a milestone as reached from this learner's own progress rows", async () => {
    mocks.milestoneProgressFindMany.mockResolvedValue([{ milestoneKey: "m1" }]);

    const dto = await getLessonDto(
      access({ progressPanel: PROGRESS_PANEL, projectSelection: PROJECT_SELECTION, outcome: OUTCOME }), "l1");

    expect(dto.dashboard!.milestonesReached).toBe(1);
    expect(dto.dashboard!.milestones[0].status).toBe("reached");
  });

  it("still renders the project card when the course declares no outcome", async () => {
    const dto = await getLessonDto(
      access({ progressPanel: PROGRESS_PANEL, projectSelection: PROJECT_SELECTION }), "l1");

    expect(dto.dashboard!.milestones).toEqual([]);
    expect(dto.dashboard!.nextMilestone).toBeNull();
    expect(dto.dashboard!.project!.title).toBe("Morning brief");
  });

  it("degrades to no project card — not no dashboard — when the project read fails", async () => {
    // A broken project read must not cost the learner the progress bar and
    // milestone list, which don't depend on it.
    mocks.getCurrentLearnerProject.mockRejectedValue(new Error("project read failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const dto = await getLessonDto(
      access({ progressPanel: PROGRESS_PANEL, projectSelection: PROJECT_SELECTION, outcome: OUTCOME }), "l1");

    expect(dto.dashboard).not.toBeNull();
    expect(dto.dashboard!.project).toBeNull();
    expect(dto.dashboard!.lessonsTotal).toBe(1);
    expect(dto.dashboard!.milestones).toHaveLength(2);
    warn.mockRestore();
  });

  it("degrades to no dashboard when the progress read itself fails", async () => {
    // Unlike a broken project read, a broken blockProgress/milestoneProgress
    // read leaves nothing to build a dashboard from at all. Only fails
    // computeCourseProgress's course-wide read (`{enrollmentId}` alone) —
    // getLessonDto's own per-lesson read (`{enrollmentId, lessonKey}`) must
    // keep succeeding, or the whole lesson load fails, not just the dashboard.
    mocks.blockProgressFindMany.mockImplementation((args: { where: { lessonKey?: string } }) => {
      if (args.where.lessonKey) return Promise.resolve([]);
      return Promise.reject(new Error("progress read failed"));
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const dto = await getLessonDto(
      access({ progressPanel: PROGRESS_PANEL, projectSelection: PROJECT_SELECTION, outcome: OUTCOME }), "l1");

    expect(dto.dashboard).toBeNull();
    expect(dto.lesson.title).toBe("AI in a GSCM Day");
    warn.mockRestore();
  });
});
