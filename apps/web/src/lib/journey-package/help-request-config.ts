/**
 * Does any course in this organization offer "request help from a human"?
 * ═══════════════════════════════════════════════════════════════════════════
 * The alerts page needs this to decide whether the zone exists at all, which is
 * not the same question as whether it currently has cards in it.
 *
 * An empty zone is normally information — "nobody needs urgent attention" is a
 * real answer and the page says so rather than rendering a blank panel. But
 * that only holds for a zone that *could* fill. Showing "Nobody has asked to
 * talk to you" to a mentor on a program where no learner has a button to press
 * is not reassurance, it is a false negative: it reports a quiet that was never
 * measured. So the zone renders when the organization has enabled the feature
 * somewhere, and is absent otherwise.
 *
 * This is also what keeps the feature off every existing surface. MI and PB&J
 * configs have no `helpRequest` key, so their mentors' pages are byte-identical
 * to what they were — no new section, no new empty state.
 *
 * Lives in the journey-package layer for the same reason `course-summaries.ts`
 * does: ProgramVersion.config is shared program content, the tenant-isolation
 * lint rule does not apply here, and the organization scope is carried
 * explicitly instead.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/db";

function helpRequestEnabled(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const help = (config as Record<string, unknown>).helpRequest;
  if (!help || typeof help !== "object" || Array.isArray(help)) return false;
  return (help as Record<string, unknown>).enabled === true;
}

/**
 * True when at least one published program version in `organizationId` has help
 * requests turned on.
 *
 * Reads `status: published` only. A draft version's config describes a course
 * nobody is being delivered, so it must not add a zone to a live dashboard.
 */
export async function organizationOffersHelpRequests(
  organizationId: string,
): Promise<boolean> {
  const versions = await prisma.programVersion.findMany({
    where: {
      status: "published",
      program: { organizationId },
    },
    select: { config: true },
  });

  return versions.some((version) => helpRequestEnabled(version.config));
}
