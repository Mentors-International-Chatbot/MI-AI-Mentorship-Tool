/**
 * Dashboard panel resolution
 * ═══════════════════════════════════════════════════════════════════════════
 * Which panels a mentor sees for a participant is a property of the course,
 * not of the dashboard. A course declares its panels in its journey package
 * (`config.dashboard.panels`); this module resolves that declaration for a
 * given course and hands the page an ordered list to render.
 *
 * Lives in the journey-package layer because it reads a published
 * ProgramVersion.config — shared program content, same as the rest of this
 * directory. That also means the tenant-isolation lint rule does not apply
 * here, so the organization scope below is load-bearing: ContentCollection is
 * unique on (organizationId, slug), NOT on slug alone.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/db";
import type { OrgResolutionSource } from "@/lib/repo/tenantRepo.types";
import { dashboardSchema, type DashboardPanel } from "./journey-package.schema";

/**
 * Panels for a course that declares none.
 *
 * Deliberately course-agnostic: every course tracks lesson progress, and every
 * course that gates lessons produces assessment results. Anything
 * course-specific — revenue, weekly rollups, a particular dimension — must be
 * declared by the course that wants it, so a new course never inherits another
 * course's assumptions.
 */
export const DEFAULT_DASHBOARD_PANELS: readonly DashboardPanel[] = [
  { type: "lesson_progress" },
  { type: "assessment_scores" },
];

export type ResolvedDashboardPanels = {
  /** Ordered panel list. Array order is render order. */
  panels: readonly DashboardPanel[];
  /** Lessons in the course's collection; 0 when the collection can't be resolved. */
  lessonCount: number;
};

/**
 * Resolves the ordered panel list and lesson count for a course.
 *
 * The org scopes the collection lookup. A slug is only unique within an
 * organization, so resolving by slug alone can read another tenant's course.
 * Pass the full resolution result — not just the id — because a tier-3
 * (`"default"`) resolution is a guess rather than a tenant identification and
 * is refused outright.
 *
 * Falls back to {@link DEFAULT_DASHBOARD_PANELS} when the course is unknown,
 * has no published version, or its stored config predates the `dashboard`
 * field. A malformed stored config also falls back rather than throwing — a
 * bad panel declaration should not take down a dashboard a mentor is using —
 * but it is logged rather than swallowed. `lessonCount` is still returned
 * whenever the collection itself resolved, independent of the panel outcome.
 */
export async function resolveDashboardPanels(
  org: { organizationId: string; source: OrgResolutionSource; socioId?: string },
  curriculumCollectionKey: string | null | undefined,
): Promise<ResolvedDashboardPanels> {
  // Fail closed on an unresolved tenant. Tier 3 does not identify the socio's
  // organization — it names whatever DEFAULT_ORGANIZATION_ID points at. Looking
  // up a collection by slug inside that org would read a different tenant's
  // panel config, so decline to query at all. Generic panels are an acceptable
  // degradation; cross-tenant config is not.
  if (org.source === "default") {
    console.warn(
      `[DashboardPanels] socio ${org.socioId ?? "(unknown)"} has an unresolved ` +
        `organization (fell through to DEFAULT_ORGANIZATION_ID) — serving default ` +
        `panels instead of reading collection "${curriculumCollectionKey ?? "(none)"}" ` +
        `from org ${org.organizationId}.`,
    );
    return { panels: DEFAULT_DASHBOARD_PANELS, lessonCount: 0 };
  }

  if (!curriculumCollectionKey) {
    return { panels: DEFAULT_DASHBOARD_PANELS, lessonCount: 0 };
  }

  const { organizationId } = org;

  // One call: the collection carries both its lesson count and its newest
  // published version, so the lesson count survives a course that has content
  // but nothing published yet.
  const collection = await prisma.contentCollection.findUnique({
    where: {
      organizationId_slug: { organizationId, slug: curriculumCollectionKey },
    },
    select: {
      _count: { select: { lessons: true } },
      programVersions: {
        where: { status: "published" },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: { config: true },
      },
    },
  });

  if (!collection) {
    return { panels: DEFAULT_DASHBOARD_PANELS, lessonCount: 0 };
  }

  const lessonCount = collection._count.lessons;
  const config = collection.programVersions[0]?.config as { dashboard?: unknown } | undefined;
  const raw = config?.dashboard;
  if (!raw) {
    return { panels: DEFAULT_DASHBOARD_PANELS, lessonCount };
  }

  const parsed = dashboardSchema.safeParse(raw);
  if (!parsed.success) {
    // A Course Lead's typo should be visible, not silently replaced by defaults.
    console.warn(
      `[DashboardPanels] collection "${curriculumCollectionKey}" (org ${organizationId}) ` +
        `has a malformed config.dashboard — falling back to default panels.`,
      parsed.error.issues,
    );
    return { panels: DEFAULT_DASHBOARD_PANELS, lessonCount };
  }

  if (parsed.data.panels.length === 0) {
    return { panels: DEFAULT_DASHBOARD_PANELS, lessonCount };
  }

  return { panels: parsed.data.panels, lessonCount };
}
