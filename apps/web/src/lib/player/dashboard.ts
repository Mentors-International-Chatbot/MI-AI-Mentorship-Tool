/**
 * The lesson player's project dashboard
 * ═══════════════════════════════════════════════════════════════════════════
 * The course is being restructured so that lessons exist to unblock a learner's
 * own automation project. This is the surface that makes that legible while
 * they work: what they're building, how far along the shape of the work they
 * are, and a way to reach a person.
 *
 * Pure over already-fetched data. Everything here is decided from a project
 * row, the milestone states the capstone already computes, and lesson
 * completion — no queries — so the cases that matter (no project, no
 * milestones, nothing reached, everything reached) are testable without a
 * database. `service.ts` does the I/O and calls in here.
 *
 * ── Why lesson progress leads and milestones follow ─────────────────────────
 * On the published 1.1.2 release every milestone gates on `after_lesson`, so
 * milestone attainment is a strict function of lesson completion. Showing a
 * milestone bar as the primary metric would be the lesson bar drawn twice under
 * a different name — motion without information. So lessons lead here and
 * milestones are the secondary structure.
 *
 * That inverts once the sequential (`after_milestone`) set lands, where reaching
 * a milestone is a conversation with the mentor rather than a side effect of
 * finishing pages. When it does, this is the comment that should change first.
 *
 * ── NAME COLLISION, not the same system ──────────────────────────────────
 * `dashboardPanelSchema` (journey-package.schema.ts) is a different, unrelated
 * "dashboard": mentor-facing, config-driven panels rendered on
 * src/app/dashboard/learners/[id] for mentors reviewing one participant. This
 * file is the learner-facing lesson sidebar, code-driven, with no
 * relationship to that schema. Confirmed by direct investigation (course-wide
 * progress panel, Aug 2026) before extending this file — don't rediscover it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** One milestone as the capstone service already computes it. */
export type DashboardMilestoneInput = {
  key: string;
  name: string;
  availability:
    | { type: "immediate" }
    | { type: "after_lesson"; lessonKey: string }
    | { type: "after_milestone"; milestoneKey: string };
  reached: boolean;
  available: boolean;
  status: "reached" | "current" | "locked";
};

export type DashboardMilestone = {
  key: string;
  name: string;
  status: "reached" | "current" | "locked";
};

/**
 * The milestone to name on the card, and why it isn't reachable yet.
 *
 * `status: "current"` is the ordinary case — one milestone is unblocked and it
 * is the one to name. But on a lesson-gated milestone set a learner who has
 * completed nothing has *no* current milestone at all: `milestoneStates` marks
 * every entry `locked` and `nextMilestone` comes back null. Naming nothing
 * would leave a new learner staring at a blank where the point of the course is
 * supposed to be, so this falls back to the first locked milestone and says
 * what unblocks it.
 */
export type NextMilestone = {
  key: string;
  name: string;
  /** True when this is the fallback rather than a genuinely unblocked milestone. */
  locked: boolean;
  /** Lesson title that unblocks it, when the gate is a lesson and it is locked. */
  unlocksAfterLessonTitle: string | null;
};

export type LessonDashboard = {
  /**
   * B.3 Stage 2: nullable, not required — a dashboard can now exist without a
   * project (once `hasAttemptsData` below is real). Every consumer (start
   * with `PlayerDashboard.tsx`) must guard this, even though `project` is
   * non-null in every case that exists today.
   */
  project: {
    title: string;
    oneLiner: string | null;
    context: string | null;
  } | null;
  /**
   * Primary metric. Lesson-level, because that is what a learner moves
   * one action at a time.
   */
  lessonsComplete: number;
  lessonsTotal: number;
  /**
   * The whole course journey, in course order — every lesson this course
   * declares, not just the current one. `buildLessonDashboard` already
   * computed this for `lessonsComplete`/`lessonsTotal` above; this is the
   * same list, not a second read.
   */
  lessons: Array<{ lessonKey: string; title: string; complete: boolean }>;
  /** Secondary structure. Empty when the course declares no outcome. */
  milestones: DashboardMilestone[];
  milestonesReached: number;
  nextMilestone: NextMilestone | null;
  graduated: boolean;
};

/** The project fields the dashboard reads. Structural, so a repo row fits. */
export type DashboardProjectInput = {
  title: string | null;
  oneLiner: string | null;
  context: string | null;
  status: string;
};

/**
 * Picks the milestone to name, or null when the course has none.
 *
 * Exported for its own tests: the 0-reached and 5-of-5 cases are the two ends
 * this has to get right, and both are easy to break by reordering the checks.
 */
export function selectNextMilestone(
  milestones: readonly DashboardMilestoneInput[],
  lessonTitles: ReadonlyMap<string, string>,
): NextMilestone | null {
  if (milestones.length === 0) return null;

  const current = milestones.find((milestone) => milestone.status === "current");
  if (current) {
    return { key: current.key, name: current.name, locked: false, unlocksAfterLessonTitle: null };
  }

  // No current milestone means either everything is reached, or nothing is yet
  // unblocked. Only the second deserves a fallback — a graduated learner has no
  // "next" and saying otherwise would invent one.
  const firstLocked = milestones.find((milestone) => milestone.status === "locked");
  if (!firstLocked) return null;

  const gate = firstLocked.availability;
  return {
    key: firstLocked.key,
    name: firstLocked.name,
    locked: true,
    unlocksAfterLessonTitle:
      gate.type === "after_lesson" ? lessonTitles.get(gate.lessonKey) ?? gate.lessonKey : null,
  };
}

/**
/**
 * B.3 Stage 2 placeholder for a future attempts/scores panel trigger.
 * Always false today — no attempts data source is wired in yet, and this
 * stage does not build one. Its only job is to give `buildLessonDashboard`'s
 * return condition its final shape now, so the stage that adds real attempts
 * data only has to fill this function in, not touch the condition again.
 *
 * One thing this stage deliberately leaves as an open, deferred question
 * rather than deciding it here: what "attempts data" should precisely mean
 * if it's ever wired in for `skills-tool-calls` (the one course with real
 * quiz_checkpoint usage, and the reason this exists) — the existing test
 * fixtures prove "milestones array is non-empty" is not it (a lesson-gated
 * course reports 5 milestone entries at zero progress, and those are exactly
 * the cases the "no project" tests pin to no project card). Whether that
 * course's config also turns on `progressPanel` is a separate, later
 * decision — this stub is not what's gating it today.
 */
function hasAttemptsData(): boolean {
  return false;
}

/**
 * Assembles the dashboard, or returns null when it must not render at all.
 *
 * Null is the whole compatibility story, now for a course that opts the panel
 * out entirely: the caller's own `progressPanel.enabled` gate keeps this
 * function from ever being reached for a course that hasn't turned it on
 * (PB&J and skills-tool-calls today), same "byte-identical to before" property
 * this used to get from the `projectSelection` gate. For a course that HAS
 * turned it on, this now renders on lesson data alone — a project (or
 * `hasAttemptsData`) is what additionally unlocks the project card, not a
 * precondition for the panel existing at all. A learner mid-setup still gets
 * no project card: a DRAFT project has no confirmed title, and a card headed
 * by a half-chosen name is worse than no card.
 */
export function buildLessonDashboard(input: {
  project: DashboardProjectInput | null;
  milestones: readonly DashboardMilestoneInput[];
  lessons: readonly { lessonKey: string; title: string; complete: boolean }[];
  graduated: boolean;
}): LessonDashboard | null {
  const { project } = input;
  // Narrowed inline (not via a separate boolean) so `project.title` etc.
  // below are safe without a non-null assertion — a boolean intermediate
  // would need one, since TS can't see through `hasAttemptsData()` to know
  // this branch is unreachable while it stubs to false.
  const projectSection = project && project.status === "ACTIVE" && project.title
    ? { title: project.title, oneLiner: project.oneLiner, context: project.context }
    : null;
  if (!projectSection && !hasAttemptsData() && input.lessons.length === 0) return null;

  const lessonTitles = new Map(input.lessons.map((lesson) => [lesson.lessonKey, lesson.title]));

  return {
    project: projectSection,
    lessonsComplete: input.lessons.filter((lesson) => lesson.complete).length,
    lessonsTotal: input.lessons.length,
    lessons: input.lessons.map((lesson) => ({
      lessonKey: lesson.lessonKey,
      title: lesson.title,
      complete: lesson.complete,
    })),
    milestones: input.milestones.map((milestone) => ({
      key: milestone.key,
      name: milestone.name,
      status: milestone.status,
    })),
    milestonesReached: input.milestones.filter((milestone) => milestone.reached).length,
    nextMilestone: selectNextMilestone(input.milestones, lessonTitles),
    graduated: input.graduated,
  };
}
