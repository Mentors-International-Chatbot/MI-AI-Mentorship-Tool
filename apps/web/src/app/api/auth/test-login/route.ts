import { NextRequest, NextResponse } from 'next/server';
import { createSession, type SessionPayload } from '@/lib/auth/session';

/**
 * POST /api/auth/test-login
 * Body: { role: 'socio' | 'mentor' | 'admin' }
 *
 * Creates a fake session for demo/testing purposes.
 * No database lookup — just mints a JWT with a hardcoded test user.
 */
export async function POST(req: NextRequest) {
  try {
    const { role } = (await req.json()) as { role: string };

    const sessions: Record<string, SessionPayload> = {
      socio: { userId: 'test-socio-001', role: 'socio', name: 'Test Socio' },
      mentor: { userId: 'test-mentor-001', role: 'mentor', name: 'Test Mentor' },
      admin: { userId: 'test-admin-001', role: 'admin', name: 'Test Admin' },
    };

    const session = sessions[role];
    if (!session) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    await createSession(session, false);

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
