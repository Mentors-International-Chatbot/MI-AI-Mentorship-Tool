import { NextRequest, NextResponse } from 'next/server';
import { createSession, type SessionIdentity } from '@/lib/auth/session';

/**
 * POST /api/auth/test-login
 * Body: { role: 'socio' | 'mentor' | 'admin' }
 *
 * Mints a session for a hardcoded test user with no password and no database
 * lookup. Local development only.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * This shipped to production unguarded. `/api/auth` is in PUBLIC_PATHS
 * (src/proxy.ts), so it required no session at all: an unauthenticated POST of
 * `{"role":"admin"}` from anyone on the internet minted a valid admin JWT and
 * handed over the platform. Wider than the eleven unguarded /api/admin routes,
 * because those at least required *a* session first.
 *
 * The gate is two independent conditions and production is refused outright
 * rather than merely defaulting to off: a single env flag would mean one
 * mis-set Vercel variable re-opens full admin access to the public internet,
 * and a dev convenience is not worth that risk profile. If this is ever needed
 * against a deployed environment, seed a real account instead of relaxing it.
 * ─────────────────────────────────────────────────────────────────────────
 */
function testLoginEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.ENABLE_TEST_LOGIN === 'true';
}

export async function POST(req: NextRequest) {
  // 404, not 403: a disabled endpoint should be indistinguishable from one that
  // does not exist, so probing cannot confirm it is here.
  if (!testLoginEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const { role } = (await req.json()) as { role: string };

    const sessions: Record<string, SessionIdentity> = {
      socio: { userId: 'test-socio-001', role: 'socio', name: 'Test Socio' },
      mentor: { userId: 'test-mentor-001', role: 'mentor', name: 'Test Mentor' },
      admin: { userId: 'test-admin-001', role: 'admin', name: 'Test Admin' },
    };

    const session = sessions[role];
    if (!session) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    await createSession(session, false);
    console.warn(`[TestLogin] minted a ${session.role} session — development only`);

    return NextResponse.json({
      success: true,
      role: session.role,
      name: session.name,
    });
  } catch (error) {
    console.error('Test login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
