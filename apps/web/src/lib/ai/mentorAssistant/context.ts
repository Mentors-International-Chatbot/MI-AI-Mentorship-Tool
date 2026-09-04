/**
 * Builds the per-turn context block appended to the mentor assistant's system
 * prompt: who this learner is, which flags are open (with their real ids, so
 * the model can reference one precisely instead of inventing one), and the
 * current override values. Kept separate from the DB-editable prompt text
 * itself — an editor changing tone/instructions should never have to also
 * re-type this structural block.
 */
import { repo } from '@/lib/repo';
import type { Socio, SocioFlag } from '@/lib/repo/types';

export type MentorAssistantContext = {
  socio: Socio;
  openFlags: SocioFlag[];
};

export async function loadMentorAssistantContext(socioId: string): Promise<MentorAssistantContext> {
  const [socio, openFlags] = await Promise.all([
    repo.getSocioById(socioId),
    repo.getActiveFlags(socioId),
  ]);
  if (!socio) throw new Error('Socio not found');
  return { socio, openFlags };
}

export function renderContextBlock({ socio, openFlags }: MentorAssistantContext): string {
  const overrides = (socio.promptOverrides ?? {}) as Record<string, unknown>;
  const flagLines =
    openFlags.length === 0
      ? '  (none)'
      : openFlags
          .map((f) => `  - id=${f.id} level=${f.level} reason="${f.reason}" opened=${f.createdAt.toISOString().slice(0, 10)}`)
          .join('\n');

  return [
    `Learner: ${socio.name ?? '(no name on file)'} (id=${socio.id})`,
    `Current overrides: complexity=${overrides.complexity ?? 'default'}, warmth=${overrides.warmth ?? 'default'}, positivity=${overrides.positivity ?? 'default'}`,
    `Open flags:`,
    flagLines,
  ].join('\n');
}
