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
  project: {
    title: string;
    oneLiner: string | null;
    context: string | null;
  };
  /**
   * Primary metric. Lesson-level, because that is what a learner moves
   * one action at a time.
   */
  lessonsComplete: number;
  lessonsTotal: number;
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
 * Assembles the dashboard, or returns null when it must not render at all.
 *
 * Null is the whole compatibility story. A course with no `projectSelection`
 * never gets a project row, so MI and PB&J fall out here and their players are
 * byte-identical to before. A learner mid-setup is null too: a DRAFT project
 * has no confirmed title, and a card headed by a half-chosen name is worse than
 * no card.
 */
export function buildLessonDashboard(input: {
  project: DashboardProjectInput | null;
  milestones: readonly DashboardMilestoneInput[];
  lessons: readonly { lessonKey: string; title: string; complete: boolean }[];
  graduated: boolean;
}): LessonDashboard | null {
  const { project } = input;
  if (!project || project.status !== "ACTIVE" || !project.title) return null;

  const lessonTitles = new Map(input.lessons.map((lesson) => [lesson.lessonKey, lesson.title]));

  return {
    project: {
      title: project.title,
      oneLiner: project.oneLiner,
      context: project.context,
    },
    lessonsComplete: input.lessons.filter((lesson) => lesson.complete).length,
    lessonsTotal: input.lessons.length,
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
