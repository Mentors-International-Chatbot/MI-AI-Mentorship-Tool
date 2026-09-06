/**
 * L5 stage 2 — the collapse.
 * ═══════════════════════════════════════════════════════════════════════════
 * Before this file, "which socios does this mentor see or act on" had four
 * independent implementations (`getSociosForMentor`, `mentorCaseloadScope`,
 * `verifyMentorOwnership`, `getUnresolvedFlagsByMentor`) plus three more
 * inline duplicates of a narrower one-off check (the three flag-action
 * routes) and a sixth (the learner detail page). See
 * reports/l0.2.6-mentorid-reader-classification.md for the full census.
 *
 * This is stage 2, not stage 4: the predicate below is today's semantics,
 * unchanged — a strict `Socio.mentorId` match, `status: 'ACTIVE'`,
 * `archivedAt: null`. Nothing about what any caller sees is different after
 * this file exists; only how many places implement it. The existing test
 * suite passing unchanged is the proof. Stage 4 is the one that swaps this
 * predicate's body for the `Enrollment ⋈ CourseStaffAssignment` join — by
 * design, a one-function change at that point, isolated from this stage's
 * refactor, so a wrong roster after the swap tells you which half broke it.
 *
 * `verifyMentorOwnership`'s org-wide fallback for an unassigned socio is
 * deliberately NOT folded into `mentorSocioWhere` — that predicate backs the
 * roster list, the caseload scope, and the flags list, none of which should
 * silently start including unassigned socios too. The fallback is real,
 * shared behavior of its own, though — `verifyMentorOwnership` and the
 * learner detail page each independently reimplemented the same two-part
 * check (own it outright, or reach it org-wide if unassigned). That pair
 * collapses onto `mentorCanReachSocio` below, exactly as duplicated before.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { tenantPrismaRepo } from './tenantPrismaRepo';

/** The shared predicate every visibility reader composes with. */
export function mentorSocioWhere(mentorId: string, organizationId?: string): Prisma.SocioWhereInput {
  return {
    mentorId,
    status: 'ACTIVE',
    archivedAt: null, // A.3: an archived socio never appears in any mentor-facing surface
    ...(organizationId ? { participantProfile: { organizationId } } : {}),
  };
}

/** For a single-socio check when the caller has no already-fetched socio to compare against. */
export async function isSocioVisibleToMentor(socioId: string, mentorId: string): Promise<boolean> {
  const match = await prisma.socio.findFirst({
    where: { id: socioId, ...mentorSocioWhere(mentorId) },
    select: { id: true },
  });
  return match !== null;
}

/**
 * The *other* existing pattern, found while collapsing: `verifyMentorOwnership`'s
 * primary check, the three flag-action routes (acknowledge/resolve/snooze),
 * and the learner detail page all inline the exact same bare comparison on a
 * socio they've already fetched for some other reason — no `status`/
 * `archivedAt` filter at all, unlike `mentorSocioWhere`'s DB-query pattern
 * above. Not a bug being smuggled through as a "collapse": preserving it
 * exactly, since stage 2's whole point is proving equivalence via the
 * existing suite before anything semantic changes. Whether an archived or
 * non-ACTIVE socio *should* stay ownable this way is a real question, worth
 * carrying into stage 4's design — under the Enrollment ⋈
 * CourseStaffAssignment join, "ACTIVE" naturally comes from Enrollment.status,
 * so this discrepancy resolves by construction there rather than needing a
 * separate decision now.
 */
export function mentorOwnsSocio(socio: { mentorId?: string | null }, mentorId: string): boolean {
  return socio.mentorId === mentorId;
}

/**
 * `verifyMentorOwnership`'s full check — primary comparison plus the
 * org-wide fallback for an unassigned socio — found duplicated whole a
 * second time in the learner detail page (`dashboard/learners/[id]/page.tsx`),
 * which can't call `verifyMentorOwnership` directly because that returns a
 * `NextResponse`-shaped result built for API routes, not a page. Both callers
 * now share this one implementation instead of two copies of the same
 * two-part logic.
 */
export async function mentorCanReachSocio(
  socio: { id: string; mentorId?: string | null },
  mentorId: string,
): Promise<boolean> {
  if (mentorOwnsSocio(socio, mentorId)) return true;
  if (socio.mentorId !== null) return false; // strict, matching the original check exactly

  const mentorOrgId = await tenantPrismaRepo.getOrganizationIdByMentorId(mentorId);
  if (!mentorOrgId) return false;
  try {
    const { organizationId } = await tenantPrismaRepo.resolveOrganizationForSocio(socio.id);
    return organizationId === mentorOrgId;
  } catch {
    return false;
  }
}

/** For callers that only need the id set (getUnresolvedFlagsByMentor). */
export async function getSocioIdsVisibleToMentor(mentorId: string): Promise<string[]> {
  const rows = await prisma.socio.findMany({
    where: mentorSocioWhere(mentorId),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export type MentorCaseloadSocio = {
  id: string;
  participantProfile: {
    organizationId: string;
    enrollments: { collectionKey: string | null }[];
  } | null;
};

/** For `mentorCaseloadScope` — the one caller that needs org/enrollment data per socio, not just ids. */
export async function getMentorCaseloadSocios(mentorId: string): Promise<MentorCaseloadSocio[]> {
  return prisma.socio.findMany({
    where: mentorSocioWhere(mentorId),
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
}
