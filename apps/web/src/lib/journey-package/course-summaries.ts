/**
 * Course summaries for the socios dashboard
 * ═══════════════════════════════════════════════════════════════════════════
 * A course's name and its length are properties of the course, not of the
 * dashboard. This resolves both for a batch of collection keys so the socios
 * list can render per-course rollups without hardcoding a single course name.
 *
 * Same lesson-count path as `resolveDashboardPanels` — the `_count` relation on
 * ContentCollection.lessons. That is deliberate: there is one definition of
 * "how long is this course", and both readers use it.
 *
 * Lives in the journey-package layer for the same reason the panel resolver
 * does: ContentCollection is shared program content, so the tenant-isolation
 * lint rule does not apply here and the organization scope below has to be
 * carried explicitly. ContentCollection is unique on (organizationId, slug),
 * NOT on slug alone.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/db";

export type CourseSummary = {
  /** ContentCollection.slug, matching Socio.curriculumCollectionKey. */
  collectionKey: string;
  /** ContentCollection.name — the human-readable course name, from data. */
  displayName: string;
  /** Lessons in the collection. */
  lessonCount: number;
};

/**
 * Resolves name and lesson count for each of `collectionKeys`.
 *
 * Pass `organizationId` whenever the caller has a resolved tenant; the slug is
 * only unique inside an organization. Omit it only on a deliberately
 * cross-tenant read — the platform-admin socios list, which pairs with
 * `repo.getSociosAcrossAllOrganizations`. In that case a slug held by more than
 * one organization is ambiguous, so the first match wins and the collision is
 * logged rather than silently resolved.
 *
 * Keys with no matching collection are simply absent from the result; callers
 * render them without a lesson total rather than inventing one.
 */
export async function getCourseSummaries(
  collectionKeys: readonly string[],
  organizationId?: string,
): Promise<CourseSummary[]> {
  const slugs = [...new Set(collectionKeys)];
  if (slugs.length === 0) return [];

  const collections = await prisma.contentCollection.findMany({
    where: {
      slug: { in: slugs },
      ...(organizationId ? { organizationId } : {}),
    },
    select: {
      slug: true,
      name: true,
      organizationId: true,
      _count: { select: { lessons: true } },
    },
    orderBy: { slug: "asc" },
  });

  const bySlug = new Map<string, CourseSummary>();
  for (const collection of collections) {
    if (bySlug.has(collection.slug)) {
      console.warn(
        `[CourseSummaries] slug "${collection.slug}" exists in more than one ` +
          `organization (also in ${collection.organizationId}) and the read was ` +
          `not org-scoped — keeping the first match.`,
      );
      continue;
    }
    bySlug.set(collection.slug, {
      collectionKey: collection.slug,
      displayName: collection.name,
      lessonCount: collection._count.lessons,
    });
  }

  return [...bySlug.values()];
}
