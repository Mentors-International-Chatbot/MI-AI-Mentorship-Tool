/**
 * Course outcome for the conversational path
 * ═══════════════════════════════════════════════════════════════════════════
 * `outcome.project` is what a participant is trying to DO — the completable
 * thing the whole course builds toward, as distinct from what they are
 * learning. Coach stance needs it; tutor stance deliberately does not get it.
 *
 * Until 2026-08-08 it was unreachable: `import-journey-package.ts` validated
 * `pkg.outcome` (including cross-checking that every mentorResource's
 * milestoneKey resolved), pushed a warning, and dropped it, because there were
 * no Outcome/Milestone tables. Authors could write a project and no code could
 * ever read one. It now rides in `ProgramVersion.config.outcome`.
 *
 * Reads through the same tier walk and the same cache discipline as
 * `resolveCourseAiBehavior` — a published version's config does not change in
 * place, so one lookup per course is enough.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { tenantRepo } from '@/lib/repo';
import { createTenantContext } from '@/lib/repo/tenantContext';
import type { ConfigScope } from './scope';

export type CourseMilestone = {
  key: string;
  name: string;
  afterLessonKey: string;
  checkDescription?: string;
};

export type CourseProject = {
  title: string;
  description?: string;
  deliverables: { name: string; description?: string }[];
};

/** Cached per course: a published version's config does not change in place. */
const cache = new Map<string, CourseProject | null>();
const milestoneCache = new Map<string, CourseMilestone[]>();

/** Test seam. */
export function clearCourseOutcomeCache(): void {
  cache.clear();
  milestoneCache.clear();
}

function parseProject(raw: unknown): CourseProject | null {
  if (!raw || typeof raw !== 'object') return null;
  const project = (raw as Record<string, unknown>).project;
  if (!project || typeof project !== 'object') return null;

  const p = project as Record<string, unknown>;
  const title = typeof p.title === 'string' ? p.title.trim() : '';
  // A project with no title is not a project. Emitting an empty heading into a
  // prompt is worse than emitting nothing, because the model will try to use it.
  if (!title) return null;

  const deliverables = Array.isArray(p.deliverables)
    ? p.deliverables
        .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
        .map((d) => ({
          name: typeof d.name === 'string' ? d.name : '',
          description: typeof d.description === 'string' ? d.description : undefined,
        }))
        .filter((d) => d.name.length > 0)
    : [];

  return {
    title,
    description: typeof p.description === 'string' && p.description.trim() ? p.description : undefined,
    deliverables,
  };
}

/**
 * The course's project, or null when there is nothing to say.
 *
 * Returns null rather than throwing on every failure path: a course with no
 * published version, an unresolvable organization, or a config with no
 * `outcome` block is a normal state, and the conversation must continue exactly
 * as it did before.
 */
export async function resolveCourseProject(
  scope: ConfigScope,
): Promise<CourseProject | null> {
  const { organizationId, collectionKey } = scope;
  // No organization means `resolvePromptScope` refused to guess one. Reading
  // another tenant's project is worse than reading none.
  if (!organizationId || !collectionKey) return null;

  const cacheKey = `${organizationId}:${collectionKey}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;

  try {
    const ctx = createTenantContext(organizationId);
    const version = await tenantRepo.getActiveProgramVersionByCollection(ctx, collectionKey);
    const project = parseProject(version?.config?.outcome);
    cache.set(cacheKey, project);
    return project;
  } catch (err) {
    console.error(`[CourseOutcome] lookup failed for "${collectionKey}":`, err);
    return null;
  }
}

function parseMilestones(raw: unknown): CourseMilestone[] {
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as Record<string, unknown>).milestones;
  if (!Array.isArray(list)) return [];

  return list
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => ({
      key: typeof m.key === 'string' ? m.key : '',
      name: typeof m.name === 'string' ? m.name : '',
      afterLessonKey: typeof m.afterLessonKey === 'string' ? m.afterLessonKey : '',
      checkDescription:
        typeof m.checkDescription === 'string' ? m.checkDescription : undefined,
    }))
    .filter((m) => m.key.length > 0 && m.name.length > 0);
}

/**
 * The milestones this course declares, or an empty list.
 *
 * Two callers, and they need it for opposite reasons: the coach prompt renders
 * them so the AI can tell a participant what is left, and `handler.ts` uses the
 * key set to reject a `[MILESTONE:...]` key the model invented. The second is
 * why this returns declarations rather than just names — an unrecognised key
 * must be refusable, not merely unrenderable.
 */
export async function resolveCourseMilestones(
  scope: ConfigScope,
): Promise<CourseMilestone[]> {
  const { organizationId, collectionKey } = scope;
  if (!organizationId || !collectionKey) return [];

  const cacheKey = `${organizationId}:${collectionKey}`;
  const hit = milestoneCache.get(cacheKey);
  if (hit !== undefined) return hit;

  try {
    const ctx = createTenantContext(organizationId);
    const version = await tenantRepo.getActiveProgramVersionByCollection(ctx, collectionKey);
    const milestones = parseMilestones(version?.config?.outcome);
    milestoneCache.set(cacheKey, milestones);
    return milestones;
  } catch (err) {
    console.error(`[CourseOutcome] milestone lookup failed for "${collectionKey}":`, err);
    return [];
  }
}
