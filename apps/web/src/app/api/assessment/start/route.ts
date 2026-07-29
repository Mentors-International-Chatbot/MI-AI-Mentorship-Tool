/**
 * POST /api/assessment/start
 *
 * Starts an assessment session. The gate handler creates the session (status: pending)
 * when the gate fires. This route:
 *   1. Loads the existing pending session for this socio+lesson+block
 *   2. Transitions it to in_progress
 *   3. Generates and stores the evaluator's opening question
 *   4. Returns the session
 *
 * Only creates a NEW session if none exists (e.g., retake after completion).
 *
 * Request body:
 *   - lessonKey: string (the lesson this assessment is for)
 *   - blockId: string (the specific teach_back block - required for gated assessments)
 *
 * Response:
 *   - sessionId: string
 *   - openingMessage: string
 *   - status: 'in_progress'
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';
import { repo } from '@/lib/repo';
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { createTenantContext } from '@/lib/repo/tenantContext';
import { createAssessmentSession, getSessionConfig, AssessmentConfigError } from '@/lib/ai/assessment/createAssessmentSession';
import { generateOpeningMessage } from '@/lib/ai/assessment/runAssessmentTurn';

interface StartRequestBody {
  lessonKey: string;
  blockId: string; // Required for gated assessments
}

export async function POST(req: NextRequest) {
  try {
    // ─── Auth ───────────────────────────────────────────────────────────────
    const session = await verifySession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Only socios can start assessments
    if (session.role !== 'socio') {
      return NextResponse.json({ error: 'Only participants can start assessments' }, { status: 403 });
    }

    // ─── Parse body ─────────────────────────────────────────────────────────
    let body: StartRequestBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { lessonKey, blockId } = body;
    if (!lessonKey) {
      return NextResponse.json({ error: 'lessonKey is required' }, { status: 400 });
    }
    if (!blockId) {
      return NextResponse.json({ error: 'blockId is required for gated assessments' }, { status: 400 });
    }

    // ─── Get organization context ───────────────────────────────────────────
    // resolveOrganizationIdForSocio never fails: tries ParticipantProfile → curriculum → default org
    const socioId = session.userId;
    const organizationId = await tenantPrismaRepo.resolveOrganizationIdForSocio(socioId);
    const ctx = createTenantContext(organizationId);

    // ─── Look up socio's channel type ────────────────────────────────────────
    const socio = await repo.getSocioById(socioId);
    if (!socio) {
      return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
    }
    const channel = socio.channelType;

    // ─── Check for existing session ─────────────────────────────────────────
    // The gate handler creates sessions when the gate fires (status: pending).
    // Look for an existing open session for this lesson+block.
    const allSessions = await tenantPrismaRepo.getAssessmentSessionsForSocio(ctx, socioId);
    const existingSession = allSessions.find(
      (s) => s.lessonKey === lessonKey && s.blockId === blockId && s.status !== 'completed'
    );

    let sessionToUse = existingSession;

    // ─── Create new session only if none exists (retake scenario) ───────────
    if (!sessionToUse) {
      // No open session - this is a retake or the gate handler didn't create one
      sessionToUse = await createAssessmentSession({
        ctx,
        repo: tenantPrismaRepo,
        socioId,
        lessonKey,
        blockId,
        channel,
      });
      console.log(`[Assessment/Start] Created new session ${sessionToUse.id} for socio ${socioId}`);
    } else {
      console.log(`[Assessment/Start] Using existing session ${sessionToUse.id} (status: ${sessionToUse.status}) for socio ${socioId}`);
    }

    // ─── Read config from snapshot ──────────────────────────────────────────
    const configSnapshot = getSessionConfig(sessionToUse);

    // ─── Handle based on session status ─────────────────────────────────────
    if (sessionToUse.status === 'pending') {
      // Transition to in_progress and generate opening message
      await tenantPrismaRepo.updateAssessmentSession(ctx, sessionToUse.id, {
        status: 'in_progress',
      });

      const openingMessage = await generateOpeningMessage({
        teachBackPrompt: configSnapshot.teachBackPrompt,
        aiBehavior: configSnapshot.aiBehavior,
        trace: { socioId, organizationId, assessmentSessionId: sessionToUse.id },
      });

      await tenantPrismaRepo.addAssessmentMessage(ctx, sessionToUse.id, {
        role: 'assistant',
        content: openingMessage,
      });

      return NextResponse.json({
        sessionId: sessionToUse.id,
        openingMessage,
        status: 'in_progress',
      });
    }

    // Session is already in_progress - return existing messages
    const messages = await tenantPrismaRepo.getAssessmentMessages(ctx, sessionToUse.id);
    const firstAssistantMessage = messages.find((m) => m.role === 'assistant');

    return NextResponse.json({
      sessionId: sessionToUse.id,
      openingMessage: firstAssistantMessage?.content ?? '',
      status: 'in_progress',
    });
  } catch (error) {
    // Handle config errors separately - these are deployment bugs
    if (error instanceof AssessmentConfigError) {
      console.error('[Assessment/Start] Config error:', error.message);
      return NextResponse.json(
        { error: `Assessment configuration error: ${error.message}` },
        { status: 500 },
      );
    }

    console.error('[Assessment/Start] Error:', error);
    return NextResponse.json(
      { error: 'Failed to start assessment session' },
      { status: 500 },
    );
  }
}
