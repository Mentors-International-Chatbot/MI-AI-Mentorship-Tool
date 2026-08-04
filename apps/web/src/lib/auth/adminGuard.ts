import { NextResponse } from 'next/server';
import { verifySession, type SessionPayload } from '@/lib/auth/session';

/**
 * Authorization for `/api/admin/*`.
 * ═══════════════════════════════════════════════════════════════════════════
 * These routes were unguarded. `src/proxy.ts` requires a session for every
 * non-public path, but its role checks key off the `/dashboard` and `/admin`
 * path prefixes — and an API route starts with `/api`, so it matched neither.
 * The practical effect was that any authenticated user, including a learner,
 * could call every admin endpoint: rewrite program config, activate prompts,
 * enumerate users, delete learners, and set an arbitrary learner's password.
 *
 * Every admin route now opens with one of these guards. They are deliberately
 * boring and identical so a missing one is visible in review.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type AdminAuthResult =
  | { authorized: true; session: SessionPayload }
  | { authorized: false; response: NextResponse };

function unauthorized(): AdminAuthResult {
  return {
    authorized: false,
    response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
}

function forbidden(): AdminAuthResult {
  return {
    authorized: false,
    response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
  };
}

/**
 * Platform administrators only.
 *
 * Use for anything that reaches across tenants or touches credentials and
 * accounts: users, mentors, password resets, cross-org analytics, deletes.
 */
export async function requireAdmin(): Promise<AdminAuthResult> {
  const session = await verifySession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();
  return { authorized: true, session };
}

/**
 * Administrators and course leads.
 *
 * Use for the course-configuration surfaces — config and prompts — where a
 * course lead has a legitimate role. Passing this check means the caller may
 * act on *some* course; it says nothing about *which*. Callers must still
 * narrow writes to a scope the caller owns via `assertScopeWritable`.
 */
export async function requireCourseConfigurer(): Promise<AdminAuthResult> {
  const session = await verifySession();
  if (!session) return unauthorized();
  if (session.role !== 'admin' && session.role !== 'course_lead') return forbidden();
  return { authorized: true, session };
}
