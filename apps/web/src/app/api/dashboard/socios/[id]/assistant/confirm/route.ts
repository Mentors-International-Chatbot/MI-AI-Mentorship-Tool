import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { verifyMentorOwnership } from '@/lib/auth/ownership';
import {
  CONFIRM_REQUIRED_TOOLS,
  adjustLearnerOverridesSchema,
  resolveFlagSchema,
  snoozeFlagSchema,
  draftMessageToLearnerSchema,
  type ConfirmRequiredTool,
} from '@/lib/ai/mentorAssistant/tools';
import {
  executeAdjustLearnerOverrides,
  executeResolveFlag,
  executeSnoozeFlag,
  executeDraftMessageToLearner,
  WrongSocioError,
} from '@/lib/ai/mentorAssistant/execute';

/**
 * Executes exactly one mentor-confirmed tool call proposed by
 * `POST .../assistant`. Re-validates args server-side against the same
 * schema the model was bound to — the client only ever echoes back what the
 * server itself proposed (or, for draft_message_to_learner, the mentor's own
 * edit of it), but this is the actual execution boundary and re-validating
 * here is what makes that a property of the code, not a trust assumption.
 */

function isConfirmRequiredTool(name: unknown): name is ConfirmRequiredTool {
  return typeof name === 'string' && (CONFIRM_REQUIRED_TOOLS as readonly string[]).includes(name);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: socioId } = await params;

  const auth = await verifyMentorOwnership(socioId);
  if (!auth.authorized) return auth.response;

  const body = (await req.json().catch(() => null)) as { name?: unknown; args?: unknown } | null;
  if (!isConfirmRequiredTool(body?.name)) {
    return NextResponse.json({ error: 'Unknown or non-confirmable tool' }, { status: 400 });
  }

  try {
    const result = await runTool(body.name, socioId, auth.session.userId, body?.args);

    await repo.createAuditLog({
      actorId: auth.session.userId,
      action: 'mentor_assistant_confirmed',
      targetType: 'socio',
      targetId: socioId,
      metadata: { tool: body.name, args: body?.args as object },
    });

    return NextResponse.json({ success: true, resultText: result.resultText });
  } catch (error) {
    if (error instanceof WrongSocioError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : 'Action failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function runTool(
  name: ConfirmRequiredTool,
  socioId: string,
  mentorId: string,
  rawArgs: unknown,
): Promise<{ resultText: string }> {
  switch (name) {
    case 'adjust_learner_overrides':
      return executeAdjustLearnerOverrides(socioId, adjustLearnerOverridesSchema.parse(rawArgs));
    case 'resolve_flag':
      return executeResolveFlag(socioId, mentorId, resolveFlagSchema.parse(rawArgs));
    case 'snooze_flag':
      return executeSnoozeFlag(socioId, mentorId, snoozeFlagSchema.parse(rawArgs));
    case 'draft_message_to_learner':
      return executeDraftMessageToLearner(socioId, draftMessageToLearnerSchema.parse(rawArgs));
  }
}
