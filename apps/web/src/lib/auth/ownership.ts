import { NextResponse } from 'next/server';
import { verifySession, type SessionPayload } from '@/lib/auth/session';
import { repo, tenantRepo } from '@/lib/repo';

type OwnershipResult =
  | { authorized: true; session: SessionPayload }
  | { authorized: false; response: NextResponse };

/**
 * Verify the caller is a mentor/admin AND owns the given socio.
 * Admins can access any socio. Mentors can only access socios assigned to them.
 */
export async function verifyMentorOwnership(
  socioId: string,
): Promise<OwnershipResult> {
  const session = await verifySession();

  if (!session) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (session.role === 'socio') {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  if (session.role === 'admin') {
    return { authorized: true, session };
  }

  // Role is 'mentor' — check ownership
  const socio = await repo.getSocioById(socioId);
  if (!socio) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    };
  }
  if (socio.mentorId === session.userId) {
    return { authorized: true, session };
  }

  // Unassigned socios (web/`/join` signups and LTI-provisioned player
  // learners never get a `mentorId`) are reachable by any mentor in their
  // organization — same posture as the alerts-page zone 0 org-wide fallback.
  // Scoping strictly to `mentorId` would leave them permanently unreachable,
  // which is worse than a caseload mentor occasionally reaching someone
  // outside their assigned list.
  if (socio.mentorId === null) {
    const mentorOrgId = await tenantRepo.getOrganizationIdByMentorId(session.userId);
    if (mentorOrgId) {
      try {
        const { organizationId } = await tenantRepo.resolveOrganizationForSocio(socioId);
        if (organizationId === mentorOrgId) {
          return { authorized: true, session };
        }
      } catch {
        // No resolvable tenant for this socio — fail closed below.
      }
    }
  }

  return {
    authorized: false,
    response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
  };
}

/**
 * Verify the caller is a mentor/admin. Returns the session.
 */
export async function verifyMentorOrAdmin(): Promise<OwnershipResult> {
  const session = await verifySession();

  if (!session) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (session.role !== 'mentor' && session.role !== 'admin') {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { authorized: true, session };
}
