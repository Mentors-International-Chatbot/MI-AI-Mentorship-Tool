/**
 * Mentor tenancy anchoring
 * ═══════════════════════════════════════════════════════════════════════════
 * `MentorProfile.organizationId` is the tenancy anchor for a mentor. Every
 * mentor-facing page begins with `getOrganizationIdByMentorId`, which reads it
 * and returns null when there is no profile — and null renders an EMPTY roster,
 * not an error. So an unanchored mentor sees nothing, however many socios point
 * at them.
 *
 * This module is the single definition of "which org does this mentor belong
 * to", shared by the runtime anchoring path and
 * `scripts/backfill-mentor-profiles.ts`. They were written days apart and would
 * otherwise be two implementations of one rule — which is the exact defect this
 * codebase keeps producing (see the ParticipantProfile/Socio.mentorId split).
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Write the profile at the first moment a real org signal exists, never before.
 * Three cases, and the third is not a bug:
 *
 *   signal at creation  → write immediately   (admin creates a mentor)
 *   signal arrives later → write then          (first socio assignment)
 *   no signal ever      → stay unanchored, invisible to org-scoped queries
 *
 * The tempting middle path — default to DEFAULT_ORGANIZATION_ID now and correct
 * later — is deliberately absent. That is tier-3 guessing, and it is worse than
 * staying unanchored: reads short-circuit on the profile, so a wrong anchor is
 * permanent and silently authoritative. Unlike the socio chain there is
 * therefore no tier-3 analogue here at all.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { createTenantContext } from '@/lib/repo/tenantContext';
import { logEvent } from '@/lib/logging/logger';

/** Which signal produced the answer, most authoritative first. */
export type MentorOrgSignal =
  /** An authorized human in a known tenant created this mentor. */
  | 'creating_admin'
  /** Explicit OrganizationMembership row. Empty table as of 2026-08-08. */
  | 'membership'
  /** Inferred from the orgs of the socios assigned to them. */
  | 'assigned_socios';

export type MentorOrgResolution =
  | { kind: 'resolved'; signal: MentorOrgSignal; organizationId: string; detail: string }
  | { kind: 'ambiguous'; detail: string }
  | { kind: 'no_signal'; detail: string };

export const MENTOR_SIGNAL_LABEL: Record<MentorOrgSignal, string> = {
  creating_admin: 'signal 0 (creating admin org)',
  membership: 'signal 1 (org membership)',
  assigned_socios: 'signal 2 (assigned socios)',
};

/**
 * Resolves a mentor's organization, or explains why it cannot.
 *
 * `explicitOrganizationId` is the caller-supplied signal — today that is the
 * org of the admin performing a create. It outranks the rest because it is a
 * deliberate act by an authorized human in a known tenant, rather than an
 * inference from surrounding data.
 *
 * Pure read. Never writes, never throws on a normal miss.
 */
export async function resolveMentorOrg(
  mentorId: string,
  explicitOrganizationId?: string | null,
): Promise<MentorOrgResolution> {
  if (explicitOrganizationId) {
    return {
      kind: 'resolved',
      signal: 'creating_admin',
      organizationId: explicitOrganizationId,
      detail: 'org of the admin performing the create',
    };
  }

  const signals = await tenantPrismaRepo.getMentorAnchorInputs(mentorId);

  // ── 1. Explicit organization membership ──────────────────────────────────
  const membershipOrgs = [...new Set(signals.memberships.map((m) => m.organizationId))];

  if (membershipOrgs.length === 1) {
    return {
      kind: 'resolved',
      signal: 'membership',
      organizationId: membershipOrgs[0],
      detail: `membership role=${signals.memberships[0].role}`,
    };
  }
  if (membershipOrgs.length > 1) {
    return {
      kind: 'ambiguous',
      detail: `belongs to ${membershipOrgs.length} orgs by membership (${membershipOrgs.join(', ')})`,
    };
  }

  // ── 2. Inferred from the orgs of the socios assigned to them ─────────────
  if (signals.assignedSocioCount === 0) {
    return { kind: 'no_signal', detail: 'no membership, no assigned socios' };
  }

  const socioOrgs = signals.assignedSocioOrganizationIds;

  if (socioOrgs.length === 1) {
    return {
      kind: 'resolved',
      signal: 'assigned_socios',
      organizationId: socioOrgs[0],
      detail: `${signals.assignedSocioCount} socio(s), all in one org`,
    };
  }
  if (socioOrgs.length > 1) {
    return {
      kind: 'ambiguous',
      detail: `${signals.assignedSocioCount} socio(s) span ${socioOrgs.length} orgs (${socioOrgs.join(', ')})`,
    };
  }

  // Socios exist but none is anchored. Mentor anchoring chains off socio
  // anchoring, so this mentor becomes resolvable only once their socios are —
  // it is not a dead end, just not yet.
  return {
    kind: 'no_signal',
    detail: `${signals.assignedSocioCount} socio(s), none anchored to an org yet`,
  };
}

export type AnchorOutcome = 'created' | 'already_anchored' | 'unresolved' | 'failed';

/**
 * Gives a mentor a MentorProfile if — and only if — an org signal exists.
 *
 * Contract mirrors `anchorParticipantProfile` in the curriculum route:
 *
 * - **Never throws.** The triggering action (assigning a socio, creating a
 *   mentor) must succeed regardless. An unanchored mentor is a backfillable
 *   state; a failed assignment is a dead end for the admin doing it.
 * - **Fails closed.** No signal means no row, not a guessed one.
 * - **Reports through logEvent → SystemLog → /admin/logs**, not the console.
 *   An unanchored mentor is invisible by construction, and Vercel function logs
 *   are not somewhere anyone looks.
 * - **Idempotent.** Upserts on the unique `mentorId`, so repeated assignment
 *   never produces a duplicate or a P2002.
 */
export async function anchorMentorProfile(params: {
  mentorId: string;
  /** What caused this attempt. Recorded on the row and in any log line. */
  trigger: string;
  /** Caller-supplied org, e.g. the creating admin's. Outranks inference. */
  explicitOrganizationId?: string | null;
}): Promise<AnchorOutcome> {
  const { mentorId, trigger, explicitOrganizationId } = params;

  try {
    // getOrganizationIdByMentorId IS the existence check: a non-null answer
    // means a profile is already there and already anchored.
    const existingOrg = await tenantPrismaRepo.getOrganizationIdByMentorId(mentorId);
    if (existingOrg) return 'already_anchored';

    const { identity } = await tenantPrismaRepo.getMentorAnchorInputs(mentorId);
    if (!identity) return 'unresolved';

    const resolution = await resolveMentorOrg(mentorId, explicitOrganizationId);

    if (resolution.kind !== 'resolved') {
      await logEvent(
        'warn',
        'system',
        `[MentorAnchor] mentor ${mentorId} not anchored after "${trigger}" — ` +
          `${resolution.kind === 'ambiguous' ? 'AMBIGUOUS' : 'no org signal'}: ${resolution.detail}. ` +
          `They will see an empty roster until an org signal exists.`,
        { mentorId, trigger, resolution: resolution.kind, detail: resolution.detail },
      );
      return 'unresolved';
    }

    await tenantPrismaRepo.createMentorProfile(createTenantContext(resolution.organizationId), {
      mentorId,
      displayName: identity.name,
      specialties: [],
      metadata: {
        email: identity.email,
        legacyRole: identity.role,
        anchoredBy: trigger,
        anchoredAt: new Date().toISOString(),
        orgResolutionSignal: resolution.signal,
      },
    });

    return 'created';
  } catch (error) {
    // Nothing in here may throw — see the contract above. logEvent guards only
    // its own Prisma write, so it gets a wrapper of its own.
    try {
      await logEvent(
        'error',
        'system',
        `[MentorAnchor] could not anchor mentor ${mentorId} after "${trigger}" — ` +
          `they remain invisible to org-scoped queries until backfilled.`,
        { mentorId, trigger, error: error instanceof Error ? error.message : String(error) },
      );
    } catch {
      // If the cause was an unreachable database, the SystemLog write fails for
      // the same reason. /admin/logs is NOT a complete list of unanchored
      // mentors — the count on /admin is the authoritative view.
    }
    return 'failed';
  }
}
