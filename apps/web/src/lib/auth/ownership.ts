import { NextResponse } from 'next/server';
import { verifySession, type SessionPayload } from '@/lib/auth/session';
import { repo } from '@/lib/repo';

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
  if (!socio || socio.mentorId !== session.userId) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    };
  }

  return { authorized: true, session };
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
