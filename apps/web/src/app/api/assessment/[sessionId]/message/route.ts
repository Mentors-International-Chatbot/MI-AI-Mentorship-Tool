/**
 * POST /api/assessment/[sessionId]/message
 *
 * Runs a turn in the assessment session.
 * All config is read from session.configSnapshot - NO hardcoded defaults.
 *
 * Request body:
 *   - message: string (the student's explanation)
 *
 * Response:
 *   - status: 'continue' | 'passed' | 'max_turns'
 *   - response: string (evaluator's response or closing message)
 *   - scores?: Record<string, number> (only on completion)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { createTenantContext } from '@/lib/repo/tenantContext';
import { runAssessmentTurn, type AssessmentConfig } from '@/lib/ai/assessment/runAssessmentTurn';
import { getSessionConfig, AssessmentConfigError } from '@/lib/ai/assessment/createAssessmentSession';
import type { DimensionStateMap } from '@/lib/ai/sensing/types';

interface MessageRequestBody {
  message: string;
}

type RouteParams = { params: Promise<{ sessionId: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { sessionId } = await params;

    // ─── Auth ───────────────────────────────────────────────────────────────
    const session = await verifySession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (session.role !== 'socio') {
      return NextResponse.json({ error: 'Only participants can send assessment messages' }, { status: 403 });
    }

    // ─── Parse body ─────────────────────────────────────────────────────────
    let body: MessageRequestBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { message } = body;
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // ─── Get organization context ───────────────────────────────────────────
    // resolveOrganizationIdForSocio never fails: tries ParticipantProfile → curriculum → default org
    const socioId = session.userId;
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

    if (assessmentSession.status === 'completed') {
      return NextResponse.json({ error: 'Session is already completed' }, { status: 400 });
    }

    // ─── Get conversation history ───────────────────────────────────────────
    const messages = await tenantPrismaRepo.getAssessmentMessages(ctx, sessionId);
    const conversationHistory = messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // ─── Extract config from session snapshot ───────────────────────────────
    // getSessionConfig throws if snapshot is missing - that's a bug, not a default case
    const configSnapshot = getSessionConfig(assessmentSession);

    const turnConfig: AssessmentConfig = {
      teachBackPrompt: configSnapshot.teachBackPrompt,
      keyConcepts: configSnapshot.keyConcepts,
      evaluatesConcepts: configSnapshot.evaluatesConcepts,
      lessonContext: configSnapshot.lessonContext,
      aiBehavior: configSnapshot.aiBehavior,
      passing: configSnapshot.passing,
      studentVisibleDimensionKeys: configSnapshot.studentVisibleDimensionKeys,
      onMaxTurnsPolicy: configSnapshot.onMaxTurnsWithoutPass,
      dimensions: configSnapshot.trackedDimensions,
    };

    // ─── Store student message ──────────────────────────────────────────────
    await tenantPrismaRepo.addAssessmentMessage(ctx, sessionId, {
      role: 'user',
      content: message,
    });

    // ─── Run turn pipeline ──────────────────────────────────────────────────
    const newTurnCount = assessmentSession.turnCount + 1;
    const priorState = (assessmentSession.liveState as DimensionStateMap) || {};

    const outcome = await runAssessmentTurn({
      studentText: message,
      conversationHistory,
      priorState,
      turnCount: newTurnCount,
      config: turnConfig,
    });

    // ─── Handle outcome ─────────────────────────────────────────────────────
    if (outcome.status === 'continue') {
      // Update session state and store response
      await tenantPrismaRepo.updateAssessmentSession(ctx, sessionId, {
        turnCount: newTurnCount,
        liveState: outcome.updatedState as Record<string, unknown>,
      });

      await tenantPrismaRepo.addAssessmentMessage(ctx, sessionId, {
        role: 'assistant',
        content: outcome.evaluatorResponse,
      });

      return NextResponse.json({
        status: 'continue',
        response: outcome.evaluatorResponse,
      });
    }

    // Terminal outcome (passed or max_turns)
    // CRITICAL: Do NOT auto-complete the session. Just update state and set passedAt if passed.
    // The client must call /complete to finalize and commit scores to the database.
    // NOTE: We do NOT write session.scores here - that field is the completion snapshot,
    // written only by completeAssessment. The score report renders from liveState.
    const sessionUpdate: {
      turnCount: number;
      liveState: Record<string, unknown>;
      passedAt?: Date;
    } = {
      turnCount: newTurnCount,
      liveState: outcome.updatedState as Record<string, unknown>,
    };

    // Set passedAt if the student passed (but leave status as in_progress)
    if (outcome.status === 'passed') {
      sessionUpdate.passedAt = new Date();
    }

    await tenantPrismaRepo.updateAssessmentSession(ctx, sessionId, sessionUpdate);

    // Store closing message
    await tenantPrismaRepo.addAssessmentMessage(ctx, sessionId, {
      role: 'assistant',
      content: outcome.closingMessage,
    });

    // Return the outcome - client should call /complete to finalize
    return NextResponse.json({
      status: outcome.status,
      response: outcome.closingMessage,
      scores: outcome.scores,
      passed: outcome.status === 'passed',
      // Indicate that completion is pending
      requiresCompletion: true,
    });
  } catch (error) {
    // Handle config errors separately - these are deployment bugs
    if (error instanceof AssessmentConfigError) {
      console.error('[Assessment/[sessionId]/message] Config error:', error.message);
      return NextResponse.json(
        { error: `Assessment configuration error: ${error.message}` },
        { status: 500 },
      );
    }

    console.error('[Assessment/[sessionId]/message] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process assessment message' },
      { status: 500 },
    );
  }
}
