/**
 * Read scope: which organization/course/learner slice a caller may see
 * aggregates for.
 * ═══════════════════════════════════════════════════════════════════════════
 * A discriminated union, not a flat object with optional fields, on purpose:
 * `system` carries no organizationId at all, so it cannot be passed to a
 * tenant-scoped repo method by accident — that's a type error, not a
 * review-time judgment call. Cross-org reads must go through `repo/system/`.
 *
 * This answers "what can this caller SEE," not "what can they configure" —
 * `course_admin` reuses courseScope.ts's `writableScopesFor` query because
 * the two coincide today, not because visibility is defined by write
 * authority. The first caller who should see a course they cannot edit (a
 * co-teacher, a read-only org observer, an accreditation reviewer) is the
 * signal to split this for real. `canWriteScope` stays where it is — read
 * scope and write authority are two separate questions; this type answers
 * only the first.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { SessionPayload } from '@/lib/auth/session';
import { writableScopesFor } from '@/lib/auth/courseScope';
import { mentorCaseloadScope } from '@/lib/auth/mentorCaseloadScope';
import { logEvent } from '@/lib/logging/logger';

export type AdminScope =
  | { kind: 'system'; actorId: string }
  | { kind: 'course_admin'; actorId: string; organizationId: string; collectionKeys: string[] }
  // socioIds is the actual scope a panel filters on; collectionKeys is
  // derived convenience data for a course picker, never the filter itself.
  | { kind: 'mentor'; actorId: string; organizationId: string; socioIds: string[]; collectionKeys: string[] }
  | { kind: 'none'; actorId: string; reason: 'no_profile' | 'no_caseload' | 'no_membership' };

export async function resolveAdminScope(session: SessionPayload): Promise<AdminScope> {
  if (session.role === 'admin') {
    return { kind: 'system', actorId: session.userId };
  }

  if (session.role === 'course_lead') {
    const scopes = await writableScopesFor(session);
    if (scopes.length === 0) return { kind: 'none', actorId: session.userId, reason: 'no_membership' };

    const organizationIds = [...new Set(scopes.map((s) => s.organizationId))];
    if (organizationIds.length > 1) {
      // Nothing in the schema stops a course_lead's ProgramMembership rows
      // from spanning more than one organization (unlike Enrollment, there is
      // no per-row uniqueness tying a membership to a single org globally).
      // AdminScope's course_admin variant carries exactly one organizationId,
      // so picking one here would be the same "absence reads as permission"
      // trap the union exists to avoid. Fails closed instead. Flag for
      // Michael: if a real cross-org course lead is a legitimate case (not
      // just a fixture artifact), this needs its own multi-scope handling.
      await logEvent(
        'warn',
        'system',
        `[AdminScope] course_lead ${session.userId} has writable scopes across multiple organizations: ${organizationIds.join(', ')}.`,
        { userId: session.userId, organizationIds },
      );
      return { kind: 'none', actorId: session.userId, reason: 'no_membership' };
    }

    return {
      kind: 'course_admin',
      actorId: session.userId,
      organizationId: organizationIds[0],
      collectionKeys: scopes.map((s) => s.collectionKey),
    };
  }

  if (session.role === 'mentor') {
    const caseload = await mentorCaseloadScope(session.userId);

    if (caseload.status === 'no_caseload') return { kind: 'none', actorId: session.userId, reason: 'no_caseload' };
    if (caseload.status === 'no_profile') return { kind: 'none', actorId: session.userId, reason: 'no_profile' };

    if (caseload.status === 'ambiguous_org') {
      // Not one of the three ordinary reasons above — a caseload spanning
      // multiple orgs is a tenant-isolation anomaly (mentor assignment
      // should never cross orgs), not a routine "nothing to show" state.
      // Folded under no_profile (same "no usable anchor" contract for
      // callers) rather than adding a fourth union member for something
      // that should not happen; logged loudly so it does not stay silent.
      // Flag for Michael: confirm this fold-in is the right call, or add a
      // dedicated reason if it turns out to fire in practice.
      await logEvent(
        'error',
        'system',
        `[AdminScope] mentor ${session.userId} caseload spans multiple organizations: ${caseload.organizationIds.join(', ')} — mentor assignment should never cross tenants.`,
        { mentorId: session.userId, organizationIds: caseload.organizationIds },
      );
      return { kind: 'none', actorId: session.userId, reason: 'no_profile' };
    }

    return {
      kind: 'mentor',
      actorId: session.userId,
      organizationId: caseload.organizationId,
      socioIds: caseload.socioIds,
      collectionKeys: caseload.collectionKeys,
    };
  }

  // A socio session has no admin-surface scope at all. Should never reach
  // here in practice (requireAdmin/requireCourseConfigurer already gate the
  // route before this runs) — 'no_membership' is the closest fit of the
  // three reasons for "this role has nothing to resolve," not a claim that a
  // socio is a course-membership case.
  return { kind: 'none', actorId: session.userId, reason: 'no_membership' };
}
