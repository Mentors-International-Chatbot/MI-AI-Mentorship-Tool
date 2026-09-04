/**
 * D.3 embedded assistant — executing a confirmed tool call.
 * ═══════════════════════════════════════════════════════════════════════════
 * Called only from the /assistant/confirm route, after `verifyMentorOwnership`
 * has already confirmed the caller is the mentor for `socioId`. Every branch
 * here does one more check the original per-flag routes don't need to: that
 * the flag being acted on actually belongs to *this* socio page, not just to
 * some socio this mentor owns. Without it, a mentor with two browser tabs
 * open could resolve learner B's flag from learner A's assistant panel by
 * however the model happened to fill in `flagId` — same mentor, wrong learner,
 * silently accepted. That is exactly the class of bug this project has hit
 * before under a different name (see mentor-assignment-two-sources).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { repo } from '@/lib/repo';
import { sendMentorMessage } from '@/lib/mentor/sendMentorMessage';
import type {
  adjustLearnerOverridesSchema,
  resolveFlagSchema,
  snoozeFlagSchema,
  draftMessageToLearnerSchema,
} from './tools';
import type { z } from 'zod';
import { isFlagDisposition, isSnoozeDays } from '@/lib/repo/types';

export class WrongSocioError extends Error {
  constructor(message = 'That flag does not belong to this learner.') {
    super(message);
    this.name = 'WrongSocioError';
  }
}

export async function executeAdjustLearnerOverrides(
  socioId: string,
  args: z.infer<typeof adjustLearnerOverridesSchema>,
): Promise<{ resultText: string }> {
  const socio = await repo.getSocioById(socioId);
  if (!socio) throw new Error('Socio not found');

  const currentOverrides = (socio.promptOverrides ?? {}) as Record<string, unknown>;
  const newOverrides = { ...currentOverrides };
  if (args.complexity !== undefined) newOverrides.complexity = args.complexity;
  if (args.warmth !== undefined) newOverrides.warmth = args.warmth;
  if (args.positivity !== undefined) newOverrides.positivity = args.positivity;

  await repo.updateSocio(socioId, { promptOverrides: newOverrides });

  const changed = (['complexity', 'warmth', 'positivity'] as const).filter(
    (k) => args[k] !== undefined,
  );
  return { resultText: `Updated ${changed.join(', ')} for this learner.` };
}

export async function executeResolveFlag(
  socioId: string,
  mentorId: string,
  args: z.infer<typeof resolveFlagSchema>,
): Promise<{ resultText: string }> {
  const flagWithSocio = await repo.getFlagWithSocio(args.flagId);
  if (!flagWithSocio || flagWithSocio.socio.id !== socioId) throw new WrongSocioError();

  if (!isFlagDisposition(args.disposition)) throw new Error('Invalid disposition');
  if (flagWithSocio.level === 'RED' && !args.note?.trim()) {
    throw new Error('A note is required when resolving a red alert.');
  }

  await repo.resolveFlag(args.flagId, mentorId, {
    disposition: args.disposition,
    ...(args.note?.trim() ? { note: args.note.trim() } : {}),
  });
  return { resultText: 'Flag resolved.' };
}

export async function executeSnoozeFlag(
  socioId: string,
  mentorId: string,
  args: z.infer<typeof snoozeFlagSchema>,
): Promise<{ resultText: string }> {
  const flagWithSocio = await repo.getFlagWithSocio(args.flagId);
  if (!flagWithSocio || flagWithSocio.socio.id !== socioId) throw new WrongSocioError();
  if (!isSnoozeDays(args.days)) throw new Error('days must be one of 1, 3, or 7');

  await repo.snoozeFlag(args.flagId, mentorId, args.days);
  return { resultText: `Flag snoozed for ${args.days} day${args.days === 1 ? '' : 's'}.` };
}

export async function executeDraftMessageToLearner(
  socioId: string,
  args: z.infer<typeof draftMessageToLearnerSchema>,
): Promise<{ resultText: string }> {
  const result = await sendMentorMessage(socioId, args.message.trim());
  return {
    resultText: result.whatsappDelivered
      ? 'Message sent.'
      : result.whatsappError
        ? `Message saved, but WhatsApp delivery failed: ${result.whatsappError}`
        : 'Message saved.',
  };
}

/** Read-only — auto-executed, never a confirm card. See tools.ts's READ_ONLY_TOOLS. */
export async function executeSummarizeHistory(
  socioId: string,
): Promise<{ summaries: Awaited<ReturnType<typeof repo.getSummaries>>; flags: Awaited<ReturnType<typeof repo.getActiveFlags>> }> {
  const [summaries, flags] = await Promise.all([
    repo.getSummaries(socioId, 8),
    repo.getActiveFlags(socioId),
  ]);
  return { summaries, flags };
}
