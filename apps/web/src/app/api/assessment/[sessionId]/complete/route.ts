/**
 * POST /api/assessment/[sessionId]/complete
 *
 * Completes an assessment session.
 * This is the only path that commits final scores to the database.
 *
 * Request body:
 *   - reason?: 'cancelled' | 'timeout' (optional, defaults to normal completion)
 *
 * Response:
 *   - status: 'completed' | 'cancelled'
 *   - message: string
 *   - scores?: Record<string, number>
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { createTenantContext } from '@/lib/repo/tenantContext';
import { completeAssessment, type CompletionConfig } from '@/lib/ai/assessment/completeAssessment';
import { getSessionConfig, AssessmentConfigError } from '@/lib/ai/assessment/createAssessmentSession';
import { runGateResolvedFollowUp } from '@/lib/messaging/gateFollowUp';
import { repo } from '@/lib/repo';
import { ASSESSMENT_STRINGS, DEFAULT_LANGUAGE, type SupportedLanguage } from '@/lib/i18n/languages';
import type { DimensionStateMap } from '@/lib/ai/sensing/types';

interface CompleteRequestBody {
  reason?: 'cancelled' | 'timeout';
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
      return NextResponse.json({ error: 'Only participants can complete assessments' }, { status: 403 });
    }

    // ─── Parse body ─────────────────────────────────────────────────────────
    let body: CompleteRequestBody = {};
    try {
      const text = await req.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const reason = body.reason;

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

    // ─── Extract config from session snapshot ───────────────────────────────
    // getSessionConfig throws if snapshot is missing - that's a bug, not a default case
    const configSnapshot = getSessionConfig(assessmentSession);

    // ─── Determine completion type ──────────────────────────────────────────
    const isCancellation = reason === 'cancelled' || reason === 'timeout';

    // Check if the student already passed (passedAt was set by the message route)
    const didPass = assessmentSession.passedAt !== null;
    const outcome: 'passed' | 'max_turns' | 'cancelled' = isCancellation
      ? 'cancelled'
      : didPass
        ? 'passed'
        : 'max_turns';

    const completionConfig: CompletionConfig = {
      // No observations for cancelled sessions
      recordedDimensionKeys: isCancellation ? [] : configSnapshot.recordedDimensionKeys,
      passingDimensionKey: configSnapshot.passing.dimensionKey,
      studentVisibleDimensionKeys: isCancellation ? [] : configSnapshot.studentVisibleDimensionKeys,
      onMaxTurnsPolicy: configSnapshot.onMaxTurnsWithoutPass,
      allowRetake: configSnapshot.allowRetake,
    };

    // ─── Complete the session ───────────────────────────────────────────────
    const finalState = (assessmentSession.liveState as DimensionStateMap) || {};

    // Look up participant profile for enrollment linkage
    const participantProfile = isCancellation
      ? null
      : await tenantPrismaRepo.getParticipantBySocioId(ctx, socioId);

    const completionResult = await completeAssessment({
      ctx,
      repo: tenantPrismaRepo,
      sessionId,
      socioId,
      finalState,
      outcome,
      config: completionConfig,
      enrollmentId: participantProfile?.id ?? null,
      channel: assessmentSession.channel,
    });

    // ─── Store completion message ───────────────────────────────────────────
    // Closes the ASSESSMENT, in the learner's language. It deliberately does
    // not congratulate or point anywhere: the AI's follow-up turn below owns
    // acknowledging the result and moving them on, and two voices doing that
    // job is the thing this whole change is removing.
    const socioLanguage = ((await repo.getSocioById(socioId))?.language
      || DEFAULT_LANGUAGE) as SupportedLanguage;
    const aStrings = ASSESSMENT_STRINGS[socioLanguage] ?? ASSESSMENT_STRINGS['en'];

    let completionMessage: string;
    if (isCancellation) {
      completionMessage = aStrings.completedCancelled;
    } else if (didPass) {
      completionMessage = aStrings.completedPassed;
    } else if (completionResult.reteachTriggered) {
      completionMessage = aStrings.completedReteach;
    } else {
      completionMessage = aStrings.completedNotPassed;
    }

    await tenantPrismaRepo.addAssessmentMessage(ctx, sessionId, {
      role: 'assistant',
      content: completionMessage,
    });

    // ─── Let the AI speak first ─────────────────────────────────────────────
    // Awaited deliberately. It costs this request an LLM call, which the
    // learner feels as a slower button on a click they just made — and buys
    // them a chat that is already answering when the redirect lands, instead of
    // silence they have to break themselves. A marker row plus poll-triggered
    // generation would move the latency out of sight at the price of being a
    // job queue with extra steps.
    //
    // Cancellations get nothing: there is no result to speak about.
    if (!isCancellation) {
      const resolvedAt = completionResult.session.completedAt ?? new Date();
      await runGateResolvedFollowUp({
        socioId,
        sessionId,
        passed: didPass,
        resolvedAt,
      });
    }

    // Note: Blocking state is derived per-turn from session status + configSnapshot.blocking.
    // No flag cleanup needed - the router will see the completed/passed session and allow progression.

    // ─── Build response ─────────────────────────────────────────────────────
    const response: {
      status: string;
      message: string;
      passed?: boolean;
      scores?: Record<string, number>;
      reteachTriggered?: boolean;
    } = {
      status: isCancellation ? 'cancelled' : 'completed',
      message: completionMessage,
      passed: didPass,
    };

    // Include scores for non-cancelled completions
    if (!isCancellation) {
      const scores: Record<string, number> = {};
      for (const key of configSnapshot.studentVisibleDimensionKeys) {
        const dimState = finalState[key];
        if (dimState) {
          scores[key] = dimState.level;
        }
      }
      response.scores = scores;
    }

    // Indicate if reteach was triggered (client should show lesson content)
    if (completionResult.reteachTriggered) {
      response.reteachTriggered = true;
    }

    return NextResponse.json(response);
  } catch (error) {
    // Handle config errors separately - these are deployment bugs
    if (error instanceof AssessmentConfigError) {
      console.error('[Assessment/[sessionId]/complete] Config error:', error.message);
      return NextResponse.json(
        { error: `Assessment configuration error: ${error.message}` },
        { status: 500 },
      );
    }

    console.error('[Assessment/[sessionId]/complete] Error:', error);
    return NextResponse.json(
      { error: 'Failed to complete assessment session' },
      { status: 500 },
    );
  }
}
