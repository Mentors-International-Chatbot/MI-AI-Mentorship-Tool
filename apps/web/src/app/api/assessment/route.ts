/**
 * GET /api/assessment
 *
 * Returns the current open assessment session with messages.
 * Used for resuming a session after page reload.
 *
 * Query params:
 *   - lessonKey?: string (optional filter by lesson)
 *
 * Response:
 *   - session: AssessmentSession | null
 *   - messages: AssessmentMessage[]
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { createTenantContext } from '@/lib/repo/tenantContext';

// Default organization for development (TODO: proper lookup)
const DEFAULT_ORG_ID = process.env.DEFAULT_ORGANIZATION_ID;

export async function GET(req: NextRequest) {
  try {
    // ─── Auth ───────────────────────────────────────────────────────────────
    const session = await verifySession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (session.role !== 'socio') {
      return NextResponse.json({ error: 'Only participants can access assessments' }, { status: 403 });
    }

    // ─── Get organization context ───────────────────────────────────────────
    const socioId = session.userId;
    const organizationId = await tenantPrismaRepo.getOrganizationIdBySocioId(socioId) ?? DEFAULT_ORG_ID;

    if (!organizationId) {
      return NextResponse.json(
        { error: 'No organization found for user' },
        { status: 400 },
      );
    }

    const ctx = createTenantContext(organizationId);

    // ─── Get optional lessonKey filter ──────────────────────────────────────
    const { searchParams } = new URL(req.url);
    const lessonKey = searchParams.get('lessonKey');

    // ─── Find open session ──────────────────────────────────────────────────
    const sessions = await tenantPrismaRepo.getAssessmentSessionsForSocio(ctx, socioId);

    let openSession = sessions.find((s) => s.status !== 'completed');
    if (lessonKey) {
      openSession = sessions.find((s) => s.lessonKey === lessonKey && s.status !== 'completed');
    }

    if (!openSession) {
      return NextResponse.json({
        session: null,
        messages: [],
      });
    }

    // ─── Get messages for session ───────────────────────────────────────────
    const messages = await tenantPrismaRepo.getAssessmentMessages(ctx, openSession.id);

    return NextResponse.json({
      session: openSession,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    console.error('[Assessment/GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get assessment session' },
      { status: 500 },
    );
  }
}
