/**
 * Project dashboard — what renders, and what must not.
 * ═══════════════════════════════════════════════════════════════════════════
 * The null cases carry the compatibility guarantee. A course without
 * `projectSelection` and a learner without a confirmed project both have to
 * produce `null`, because null is what leaves MI, PB&J, and mid-setup learners
 * with the player exactly as it was.
 *
 * The milestone cases cover the two ends plus the middle, which is where the
 * lesson-gated set behaves least like the sequential one it will become.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from "vitest";
import {
  buildLessonDashboard,
  selectNextMilestone,
  type DashboardMilestoneInput,
  type DashboardProjectInput,
} from "@/lib/player/dashboard";

const LESSONS = [
  { lessonKey: "l1", title: "AI in a GSCM Day", complete: false },
  { lessonKey: "l2", title: "Prompting and Iteration", complete: false },
  { lessonKey: "l3", title: "Tool Shapes", complete: false },
  { lessonKey: "l4", title: "Safety and Deploy", complete: false },
  { lessonKey: "l5", title: "Prospering Gameplan", complete: false },
];

function project(overrides: Partial<DashboardProjectInput> = {}): DashboardProjectInput {
  return {
    title: "Morning brief",
    oneLiner: "Know what is due before I open my laptop",
    context: "A full class load plus a job",
    status: "ACTIVE",
    ...overrides,
  };
}

/**
 * Five lesson-gated milestones, matching the published 1.1.2 shape. `reached`
 * counts from the front, which is what sequential completion produces.
 */
function milestones(reachedCount: number): DashboardMilestoneInput[] {
  const defs = [
    { key: "capstone-1", name: "Frame the decision and success criteria", lessonKey: "l1" },
    { key: "capstone-2", name: "Draft and improve the prompt", lessonKey: "l2" },
    { key: "capstone-3", name: "Design the tools and harness", lessonKey: "l3" },
    { key: "capstone-4", name: "Build guardrails and evaluation tests", lessonKey: "l4" },
    { key: "capstone-5", name: "Synthesize the final operating brief", lessonKey: "l5" },
  ];
  let currentAssigned = false;
  return defs.map((def, index) => {
    const reached = index < reachedCount;
    // Mirrors `milestoneStates`: eligible once its gating lesson is done, and
    // only the first eligible unreached milestone becomes `current`.
    const eligible = index <= reachedCount;
    const available = !reached && eligible && !currentAssigned;
    if (available) currentAssigned = true;
    return {
      key: def.key,
      name: def.name,
      availability: { type: "after_lesson" as const, lessonKey: def.lessonKey },
      reached,
      available,
      status: reached ? ("reached" as const) : available ? ("current" as const) : ("locked" as const),
    };
  });
}

const titles = new Map(LESSONS.map((l) => [l.lessonKey, l.title]));

describe("selectNextMilestone", () => {
  it("names the current milestone when one is unblocked", () => {
    const next = selectNextMilestone(milestones(2), titles);
    expect(next).toEqual({
      key: "capstone-3",
      name: "Design the tools and harness",
      locked: false,
      unlocksAfterLessonTitle: null,
    });
  });

  it("falls back to the first locked milestone when nothing is unblocked yet", () => {
    // The 0-of-5 case on a lesson-gated set: `milestoneStates` marks everything
    // locked and the capstone DTO's own `nextMilestone` is null. A new learner
    // must still be told what they are working toward.
    const allLocked = milestones(0).map((m) => ({
      ...m,
      available: false,
      status: "locked" as const,
    }));
    expect(selectNextMilestone(allLocked, titles)).toEqual({
      key: "capstone-1",
      name: "Frame the decision and success criteria",
      locked: true,
      unlocksAfterLessonTitle: "AI in a GSCM Day",
    });
  });

  it("falls back to the raw lesson key when the title cannot be resolved", () => {
    const allLocked = milestones(0).map((m) => ({ ...m, available: false, status: "locked" as const }));
    expect(selectNextMilestone(allLocked, new Map())?.unlocksAfterLessonTitle).toBe("l1");
  });

  it("returns null at 5 of 5 — a graduated learner has no next", () => {
    expect(selectNextMilestone(milestones(5), titles)).toBeNull();
  });

  it("returns null for a course with no milestones", () => {
    expect(selectNextMilestone([], titles)).toBeNull();
  });

  it("omits the unlock hint for a non-lesson gate", () => {
    const next = selectNextMilestone(
      [{
        key: "ship-it",
        name: "Ship it",
        availability: { type: "after_milestone", milestoneKey: "pick-it" },
        reached: false,
        available: false,
        status: "locked",
      }],
      titles,
    );
    expect(next).toMatchObject({ key: "ship-it", locked: true, unlocksAfterLessonTitle: null });
  });
});

describe("buildLessonDashboard — renders with a project", () => {
  it("carries the project and both progress readings", () => {
    const lessons = LESSONS.map((l, i) => ({ ...l, complete: i < 3 }));
    const dashboard = buildLessonDashboard({
      project: project(),
      milestones: milestones(3),
      lessons,
      graduated: false,
    });

    expect(dashboard).not.toBeNull();
    expect(dashboard!.project).toEqual({
      title: "Morning brief",
      oneLiner: "Know what is due before I open my laptop",
      context: "A full class load plus a job",
    });
    // Lessons lead, milestones follow.
    expect(dashboard!.lessonsComplete).toBe(3);
    expect(dashboard!.lessonsTotal).toBe(5);
    expect(dashboard!.milestonesReached).toBe(3);
    expect(dashboard!.milestones).toHaveLength(5);
    expect(dashboard!.nextMilestone?.key).toBe("capstone-4");
  });

  it("reports 0 of 5 for a learner who has just confirmed a project", () => {
    const dashboard = buildLessonDashboard({
      project: project(),
      milestones: milestones(0).map((m) => ({ ...m, available: false, status: "locked" as const })),
      lessons: LESSONS,
      graduated: false,
    });

    expect(dashboard!.lessonsComplete).toBe(0);
    expect(dashboard!.milestonesReached).toBe(0);
    expect(dashboard!.nextMilestone).toMatchObject({ key: "capstone-1", locked: true });
  });

  it("reports 5 of 5 and no next once graduated", () => {
    const lessons = LESSONS.map((l) => ({ ...l, complete: true }));
    const dashboard = buildLessonDashboard({
      project: project(),
      milestones: milestones(5),
      lessons,
      graduated: true,
    });

    expect(dashboard!.lessonsComplete).toBe(5);
    expect(dashboard!.milestonesReached).toBe(5);
    expect(dashboard!.nextMilestone).toBeNull();
    expect(dashboard!.graduated).toBe(true);
    expect(dashboard!.milestones.every((m) => m.status === "reached")).toBe(true);
  });

  it("renders the project card for a course with no outcome at all", () => {
    const dashboard = buildLessonDashboard({
      project: project(),
      milestones: [],
      lessons: LESSONS,
      graduated: false,
    });

    expect(dashboard).not.toBeNull();
    expect(dashboard!.milestones).toEqual([]);
    expect(dashboard!.nextMilestone).toBeNull();
    expect(dashboard!.lessonsTotal).toBe(5);
  });

  it("tolerates a project with no one-liner or context", () => {
    const dashboard = buildLessonDashboard({
      project: project({ oneLiner: null, context: null }),
      milestones: milestones(0),
      lessons: LESSONS,
      graduated: false,
    });
    expect(dashboard!.project).toEqual({ title: "Morning brief", oneLiner: null, context: null });
  });
});

describe("buildLessonDashboard — renders nothing without a project", () => {
  it("returns null when the learner has no project row", () => {
    expect(buildLessonDashboard({
      project: null,
      milestones: milestones(0),
      lessons: LESSONS,
      graduated: false,
    })).toBeNull();
  });

  it("returns null mid-setup, while the project is still DRAFT", () => {
    // A DRAFT has no confirmed title; a card headed by a half-chosen name is
    // worse than no card.
    expect(buildLessonDashboard({
      project: project({ status: "DRAFT", title: null }),
      milestones: milestones(0),
      lessons: LESSONS,
      graduated: false,
    })).toBeNull();
  });

  it.each(["DRAFT", "CHANGED", "ABANDONED"])("returns null for a %s project", (status) => {
    expect(buildLessonDashboard({
      project: project({ status }),
      milestones: milestones(0),
      lessons: LESSONS,
      graduated: false,
    })).toBeNull();
  });

  it("returns null for an ACTIVE project with no title", () => {
    expect(buildLessonDashboard({
      project: project({ title: null }),
      milestones: milestones(0),
      lessons: LESSONS,
      graduated: false,
    })).toBeNull();
  });
});
