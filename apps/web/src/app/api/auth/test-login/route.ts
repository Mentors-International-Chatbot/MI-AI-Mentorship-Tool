import { NextRequest, NextResponse } from 'next/server';
import { createSession, type SessionIdentity } from '@/lib/auth/session';
import { findOrCreatePrincipal } from '@/lib/auth/principal';
import {
  DevTestLearnerProvisionError,
  provisionDevAiEssentialsLearner,
} from '@/lib/repo/devTestLearnerRepo';

/**
 * POST /api/auth/test-login
 * Body: { role: 'socio' | 'mentor' | 'admin' }
 *
 * Mints a session for a development test identity with no password. The learner
 * role is backed by an idempotently provisioned synthetic Socio and
 * ParticipantProfile; staff roles remain hardcoded identities. Local
 * development only.
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
      mentor: { userId: 'test-mentor-001', role: 'mentor', name: 'Test Mentor' },
      admin: { userId: 'test-admin-001', role: 'admin', name: 'Test Admin' },
    };

    const learner = role === 'socio'
      ? await provisionDevAiEssentialsLearner()
      : null;
    const session = learner
      ? { userId: learner.socioId, role: 'socio' as const, name: learner.name }
      : sessions[role];
    if (!session) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Only the learner branch has a real backing Socio row (provisioned
    // above). The hardcoded mentor/admin test identities ('test-mentor-001',
    // 'test-admin-001') have no corresponding Mentor row and never will —
    // giving them a Principal here would violate Principal.mentorId's FK on
    // every single test-login call, not just eventually. Left claim-less
    // instead: resolvePrincipalForSession's on-the-fly fallback hits the
    // same FK constraint on refresh, but that failure is already non-fatal
    // there (see proxy.ts's withRefreshedSession) — acceptable for
    // development-only tooling that these sessions already are.
    if (learner) {
      const principal = await findOrCreatePrincipal({
        provider: 'password',
        subject: session.userId,
        role: session.role,
        socioId: session.userId,
      });
      session.principalId = principal.id;
    }

    await createSession(session, false);
    console.warn(`[TestLogin] minted a ${session.role} session — development only`);

    return NextResponse.json({
      success: true,
      role: session.role,
      name: session.name,
    });
  } catch (error) {
    if (error instanceof DevTestLearnerProvisionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Test login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
