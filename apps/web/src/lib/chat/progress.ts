/**
 * What the learner can see of their own position
 * ═══════════════════════════════════════════════════════════════════════════
 * Every fact here already existed and none of it reached the learner. The web
 * chat knew one number — `currentLesson` — and even that only as a subtitle;
 * how long the course is, how far into the lesson they are, whether they passed
 * the teach-back, and what the project expects of them were all server-side
 * only. A learner asking "am I done?" was asking because nothing on screen
 * could answer it.
 *
 * Assembled here rather than in the route so it can be tested without HTTP, and
 * read on its own cadence rather than folded into `/api/chat/poll`. That poll
 * runs every five seconds per active learner; putting the course, gate and
 * milestone reads on it would put four extra queries on a five-second timer to
 * refresh numbers that move a handful of times per lesson.
 *
 * Nothing here is hardcoded per course. The lesson count comes from the
 * learner's own collection via `getCourseSummaries`, the project and its
 * milestones from the course's declared outcome. A course that declares no
 * outcome gets no project section at all, rather than an empty one.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { repo } from '@/lib/repo';
import { getCourseSummaries } from '@/lib/journey-package/course-summaries';
import { getLessonData, hasLessonData, preloadCollection } from '@/lib/lessons/db-lesson-service';
import { resolvePromptScope } from '@/lib/ai/prompts/resolveScope';
import { resolveCourseProject, resolveCourseMilestones } from '@/lib/ai/prompts/courseOutcome';
import { readGateEvidence } from '@/lib/ai/prompts/stance';
import { canDeliverGatedAssessment } from '@/lib/ai/assessment/channelSupport';
import type { Socio } from '@/lib/repo/types';

/**
 * Where the learner stands on the current lesson's teach-back.
 *
 * `not_reached` is kept distinct from `not_passed` for the same reason stance
 * keeps `no_gates` distinct: "you have not got there yet" and "you got there
 * and did not clear it" are different things to show someone.
 */
export type GateStatus = 'not_reached' | 'passed' | 'not_passed';

export interface ChatProgress {
  /** Course display name, from the collection itself. */
  courseName: string | null;
  lesson: { current: number; total: number };
  /** Position inside the current lesson. Null when the lesson has no messages. */
  position: { part: number; total: number } | null;
  /** Null when the lesson declares no gate, or the channel cannot deliver one. */
  gate: GateStatus | null;
  /** Null when the course declares no outcome. Never an empty array. */
  project: {
    title: string;
    milestones: { key: string; name: string; done: boolean }[];
  } | null;
}

export async function buildChatProgress(socio: Socio): Promise<ChatProgress | null> {
  const collectionKey = socio.curriculumCollectionKey;
  if (!collectionKey) return null;

  await preloadCollection(collectionKey);

  const scope = await resolvePromptScope(collectionKey);
  const [progress, summaries] = await Promise.all([
    repo.getSocioProgress(socio.id),
    getCourseSummaries([collectionKey], scope.organizationId ?? undefined),
  ]);

  const summary = summaries.find((s) => s.collectionKey === collectionKey);
  const lessonNumber = progress.currentLessonNumber;

  // ── Position within the lesson ──────────────────────────────────────────
  // `currentMessageIndex` is 0-based and counts messages *delivered*, so the
  // part the learner is on is one higher — the same +1 the lesson-delivery
  // prompt applies when it renders "Message 3 of 5".
  let position: ChatProgress['position'] = null;
  let gate: GateStatus | null = null;

  if (hasLessonData(collectionKey, lessonNumber)) {
    const lesson = getLessonData(collectionKey, lessonNumber);

    if (lesson.messages.length > 0) {
      position = {
        part: Math.min(progress.currentMessageIndex + 1, lesson.messages.length),
        total: lesson.messages.length,
      };
    }

    if (lesson.gates.length > 0 && canDeliverGatedAssessment(socio.channelType)) {
      // Reached on the same rule the router uses to decide a gate is live.
      const anyReached = lesson.gates.some(
        (g) => progress.currentMessageIndex > g.afterMessageIndex,
      );
      if (!anyReached) {
        gate = 'not_reached';
      } else {
        const evidence = await readGateEvidence(
          socio.id, collectionKey, lessonNumber, undefined, socio.channelType,
        );
        gate = evidence === 'passed' ? 'passed' : 'not_passed';
      }
    }
  }

  // ── Project and milestones ──────────────────────────────────────────────
  // Both reads are cached per course, so a course with no outcome costs two
  // map lookups and never touches milestone_progress.
  let project: ChatProgress['project'] = null;
  const declared = await resolveCourseMilestones(scope);
  const courseProject = await resolveCourseProject(scope);

  if (courseProject && declared.length > 0) {
    const rows = await repo.getMilestoneProgress(socio.id, collectionKey);
    const reached = new Set(rows.map((r) => r.milestoneKey));
    project = {
      title: courseProject.title,
      milestones: declared.map((m) => ({
        key: m.key,
        name: m.name,
        done: reached.has(m.key),
      })),
    };
  }

  return {
    courseName: summary?.displayName ?? null,
    lesson: {
      current: lessonNumber,
      // A collection whose lessons could not be counted reports the learner's
      // own position rather than 0, so the bar never renders "2 of 0".
      total: summary?.lessonCount && summary.lessonCount > 0 ? summary.lessonCount : lessonNumber,
    },
    position,
    gate,
    project,
  };
}
