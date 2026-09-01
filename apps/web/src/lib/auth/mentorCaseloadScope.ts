/**
 * A mentor's read scope: the socios assigned to them, not the courses those
 * socios happen to be enrolled in.
 * ═══════════════════════════════════════════════════════════════════════════
 * Two mentors in the same org teaching the same course must not resolve to
 * the same scope — the caseload (the socio ids) is the actual constraint;
 * the course list is derived, convenience data for a picker, never the
 * filter a panel queries on.
 *
 * Derives the mentor's organization from their caseload's own
 * ParticipantProfile anchors, not from MentorProfile.organizationId. The
 * mentor-side anchor is known to be missing for every mentor created since
 * the 2026-08-05 backfill (no tiered fallback on that side), while the
 * socio-side anchor already has the tiered resolution discipline
 * (resolveOrganizationForSocio). A caseload that is itself anchored is a
 * stronger signal than a MentorProfile row that may not exist.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from '@/lib/db';

export type MentorCaseloadResult =
  | { status: 'ok'; organizationId: string; socioIds: string[]; collectionKeys: string[] }
  // Socio.mentorId has zero active, unarchived rows for this mentor.
  | { status: 'no_caseload' }
  // The caseload exists but none of it is anchored to an org yet.
  | { status: 'no_profile' }
  // The caseload's ParticipantProfiles span more than one organization — a
  // tenant-isolation anomaly (mentor assignment should never cross orgs),
  // not a routine empty state. Callers must fail closed on this, not pick one.
  | { status: 'ambiguous_org'; organizationIds: string[] };

export async function mentorCaseloadScope(mentorId: string): Promise<MentorCaseloadResult> {
  const socios = await prisma.socio.findMany({
    where: { mentorId, status: 'ACTIVE', archivedAt: null },
    select: {
      id: true,
      participantProfile: {
        select: {
          organizationId: true,
          enrollments: {
            where: { status: { not: 'dropped' } },
            select: { collectionKey: true },
          },
        },
      },
    },
  });

  if (socios.length === 0) return { status: 'no_caseload' };

  const anchored = socios.filter(
    (s): s is typeof s & { participantProfile: NonNullable<(typeof s)['participantProfile']> } =>
      s.participantProfile !== null,
  );
  if (anchored.length === 0) return { status: 'no_profile' };

  const organizationIds = [...new Set(anchored.map((s) => s.participantProfile.organizationId))];
  if (organizationIds.length > 1) return { status: 'ambiguous_org', organizationIds };

  const socioIds = anchored.map((s) => s.id);
  // Caseload sizes only. If a mentor's roster ever reaches into the
  // thousands, swap the eventual `in: socioIds` filter for a where-fragment
  // builder instead of listing every id.
  const collectionKeys = [...new Set(
    anchored.flatMap((s) =>
      s.participantProfile.enrollments
        .map((e) => e.collectionKey)
        .filter((k): k is string => k !== null),
    ),
  )];

  return { status: 'ok', organizationId: organizationIds[0], socioIds, collectionKeys };
}
