/**
 * Course AI behaviour for the main chat path
 * ═══════════════════════════════════════════════════════════════════════════
 * `ProgramVersion.config.aiBehavior` — tone, teaching style, language
 * instruction — was read only by the gated-assessment path
 * (`buildAssessmentPrompt`, `runAssessmentTurn`, `createAssessmentSession`).
 * A course lead who set a tone therefore changed how the AI behaved during
 * teach-back checks and nowhere else, with nothing saying so.
 *
 * This makes the same config reach Layer 1 of the ordinary conversation, which
 * is where identity and non-negotiables are supposed to live.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { tenantRepo } from '@/lib/repo';
import { createTenantContext } from '@/lib/repo/tenantContext';
import type { SupportedLanguage } from '@/lib/i18n/languages';
import type { ConfigScope } from './scope';

export type CourseAiBehavior = {
  tone?: string;
  teachingStyle?: string;
  languageInstruction?: string;
  /** Language the version's content — and its languageInstruction — is written for. */
  primaryLang: string;
};

/** Cached per course: a published version's config does not change in place. */
const cache = new Map<string, CourseAiBehavior | null>();

/** Test seam. */
export function clearCourseBehaviorCache(): void {
  cache.clear();
}

/**
 * Reads `aiBehavior` for the course, or null when there is nothing to apply.
 *
 * Returns null rather than throwing on every failure path — a course with no
 * published version, an unresolvable organization, or a config without an
 * `aiBehavior` block is a normal state, not an error, and the conversation must
 * continue with the code defaults exactly as it did before.
 */
export async function resolveCourseAiBehavior(
  scope: ConfigScope,
): Promise<CourseAiBehavior | null> {
  const { organizationId, collectionKey } = scope;
  // No organization means `resolvePromptScope` refused to guess one. Reading
  // another tenant's behaviour config is worse than reading none.
  if (!organizationId || !collectionKey) return null;

  const cacheKey = `${organizationId}:${collectionKey}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;

  try {
    const ctx = createTenantContext(organizationId);
    const version = await tenantRepo.getActiveProgramVersionByCollection(ctx, collectionKey);
    const raw = version?.config?.aiBehavior as Record<string, unknown> | undefined;

    if (!version || !raw) {
      cache.set(cacheKey, null);
      return null;
    }

    const behavior: CourseAiBehavior = {
      tone: typeof raw.tone === 'string' ? raw.tone : undefined,
      teachingStyle: typeof raw.teachingStyle === 'string' ? raw.teachingStyle : undefined,
      languageInstruction:
        typeof raw.languageInstruction === 'string' ? raw.languageInstruction : undefined,
      primaryLang: version.primaryLang,
    };

    cache.set(cacheKey, behavior);
    return behavior;
  } catch (err) {
    console.error(`[CourseBehavior] lookup failed for "${collectionKey}":`, err);
    return null;
  }
}

const HEADINGS: Record<SupportedLanguage, string> = {
  es: 'ESTILO DE ESTE CURSO:',
  en: 'STYLE FOR THIS COURSE:',
  pt: 'ESTILO DESTE CURSO:',
};

const LABELS: Record<SupportedLanguage, { tone: string; teaching: string; language: string }> = {
  es: { tone: 'Tono', teaching: 'Estilo de enseñanza', language: 'Lenguaje' },
  en: { tone: 'Tone', teaching: 'Teaching style', language: 'Language' },
  pt: { tone: 'Tom', teaching: 'Estilo de ensino', language: 'Linguagem' },
};

/**
 * Renders the behaviour block, or '' when there is nothing worth adding.
 *
 * `languageInstruction` is included ONLY when the learner reads in the course's
 * `primaryLang`. MI's says "Respond in Colombian Spanish. Use informal 'tú'" and
 * MI has 16 English learners; injecting that into their prompt would set a
 * course-level instruction fighting the learner-level language directive, and
 * the two would be resolved by whichever the model weighted more heavily. Tone
 * and teaching style carry no such conflict — they describe how to teach, not
 * which language to teach in — so they always apply.
 */
export function buildCourseBehaviorSnippet(
  behavior: CourseAiBehavior | null,
  language: SupportedLanguage,
): string {
  if (!behavior) return '';

  const labels = LABELS[language] ?? LABELS['en'];
  const lines: string[] = [];

  if (behavior.tone) lines.push(`- ${labels.tone}: ${behavior.tone}`);
  if (behavior.teachingStyle) lines.push(`- ${labels.teaching}: ${behavior.teachingStyle}`);
  if (behavior.languageInstruction && behavior.primaryLang === language) {
    lines.push(`- ${labels.language}: ${behavior.languageInstruction}`);
  }

  if (lines.length === 0) return '';

  const heading = HEADINGS[language] ?? HEADINGS['en'];
  return `\n\n${heading}\n${lines.join('\n')}`;
}
