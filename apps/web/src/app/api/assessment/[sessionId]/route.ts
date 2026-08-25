/**
 * GET /api/assessment/[sessionId]
 *
 * Returns a specific assessment session with messages.
 *
 * Response:
 *   - session: AssessmentSession
 *   - messages: AssessmentMessage[]
 *   - config: { passing, studentVisibleDimensionKeys } (from configSnapshot)
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestIdentity } from '@/lib/auth/requestIdentity';
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { createTenantContext } from '@/lib/repo/tenantContext';
import { getSessionConfig, AssessmentConfigError } from '@/lib/ai/assessment/createAssessmentSession';
import { learnerVisibleAssessmentScores } from '@/lib/ai/assessment/learnerVisibility';

type RouteParams = { params: Promise<{ sessionId: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { sessionId } = await params;

    // ─── Auth ───────────────────────────────────────────────────────────────
    const identity = await resolveRequestIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (identity.role !== 'socio') {
      return NextResponse.json({ error: 'Only participants can access assessments' }, { status: 403 });
    }

    // ─── Get organization context ───────────────────────────────────────────
    // resolveOrganizationIdForSocio never fails: tries ParticipantProfile → curriculum → default org
    const socioId = identity.socioId ?? identity.userId;
    const organizationId = await tenantPrismaRepo.resolveOrganizationIdForSocio(socioId);
    const ctx = createTenantContext(organizationId);

    // ─── Load session ───────────────────────────────────────────────────────
    const assessmentSession = await tenantPrismaRepo.getAssessmentSessionById(ctx, sessionId);
    if (!assessmentSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (assessmentSession.socioId !== socioId) {
      return NextResponse.json({ error: 'Session does not belong to user' }, { status: 403 });
    }

    // ─── Get config from snapshot ───────────────────────────────────────────
    const configSnapshot = getSessionConfig(assessmentSession);

    // ─── Get messages ───────────────────────────────────────────────────────
    const messages = await tenantPrismaRepo.getAssessmentMessages(ctx, sessionId);

    return NextResponse.json({
      session: {
        id: assessmentSession.id,
        lessonKey: assessmentSession.lessonKey,
        blockId: assessmentSession.blockId,
        status: assessmentSession.status,
        turnCount: assessmentSession.turnCount,
        attemptNumber: assessmentSession.attemptNumber,
        passedAt: assessmentSession.passedAt,
        completedAt: assessmentSession.completedAt,
        scores: learnerVisibleAssessmentScores(
          configSnapshot,
          assessmentSession.scores as Record<string, number> | null,
        ),
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
      config: {
        passing: configSnapshot.passing,
        studentVisibleDimensionKeys: configSnapshot.studentVisibleDimensionKeys,
        allowRetake: configSnapshot.allowRetake,
      },
    });
  } catch (error) {
    if (error instanceof AssessmentConfigError) {
      console.error('[Assessment/[sessionId]/GET] Config error:', error.message);
      return NextResponse.json(
        { error: `Assessment configuration error: ${error.message}` },
        { status: 500 },
      );
    }

    console.error('[Assessment/[sessionId]/GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get assessment session' },
      { status: 500 },
    );
  }
}
