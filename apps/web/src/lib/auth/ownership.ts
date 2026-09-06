import { NextResponse } from 'next/server';
import { verifySession, type SessionPayload } from '@/lib/auth/session';
import { repo } from '@/lib/repo';
import { mentorCanReachSocio } from '@/lib/repo/mentorVisibility';

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
  // L5 stage 2: shared predicate — see lib/repo/mentorVisibility.ts. Covers
  // both direct ownership and the org-wide fallback for an unassigned socio
  // (web/`/join` signups and LTI-provisioned player learners never get a
  // `mentorId` — scoping strictly to it would leave them permanently
  // unreachable, worse than a caseload mentor occasionally reaching someone
  // outside their assigned list).
  if (await mentorCanReachSocio(socio, session.userId)) {
    return { authorized: true, session };
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
