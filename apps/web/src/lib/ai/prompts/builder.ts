import { Socio } from '@/lib/repo/types';
import { PromptOverrides, RouterResult, SocioProgress } from './types';
import { buildCorePrompt } from './layers/core';
import { buildContextPrompt } from './layers/context';
import { buildTaskPrompt } from './layers/task';
import { buildContentPrompt } from './layers/content';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/languages';
import type { SupportedLanguage } from '@/lib/i18n/languages';
import type { DimensionStateMap } from '@/lib/ai/sensing/types';
import type { PromptVersionSink } from './loadPrompt';
import { resolvePromptScope } from './resolveScope';
import { STANCE_DETOUR_KEY } from './stance';
import type { SocioFlag } from '@/lib/repo/types';
import type { GateRecency } from './gateRecency';

// ─── Prompt Builder ─────────────────────────────────────────────────
// Assembles the 4-layer system prompt at runtime.
//
// Layer 1 — Core identity (~350 tokens): built per-request (includes slider overrides per socio)
// Layer 2 — Socio context (~150 tokens): built from DB per-request
// Layer 3 — Task context (~150 tokens): based on interaction mode
// Layer 4 — Lesson content (~300 tokens): only when teaching/answering
//
// Total: ~950 tokens (vs ~3,000+ for a monolithic prompt)

function stripInternalPromptOverrides(raw: unknown): PromptOverrides | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = { ...(raw as Record<string, unknown>) };
  delete o.awaitingFeedback;
  delete o.feedbackLessonNum;
  // Stance detour bookkeeping (see stance.ts). Internal state, not a slider —
  // leaving it in would put a `{turnsRemaining, lessonNumber}` object through
  // the tone/conciseness parsing in Layer 1.
  delete o[STANCE_DETOUR_KEY];
  if (Object.keys(o).length === 0) return null;
  return o as PromptOverrides;
}

export function assemblePromptLayers(layers: readonly [string, string, string, string | null]): string {
  return layers.filter((layer): layer is string => typeof layer === 'string' && layer.length > 0).join('\n\n');
}

export type PromptBuildOptions = {
  /**
   * Player turns carry a server-validated lesson or capstone document. The
   * legacy conversation layers derive a different "current lesson" from
   * SocioProgress, so including them creates two competing sources of truth.
   * Keep the shared course identity/safety layer, then let the caller append
   * the authoritative player grounding.
   */
  authoritativePlayerTurn?: boolean;
};

function buildAuthoritativePlayerBase(language: SupportedLanguage): string {
  const languageName = language === 'es' ? 'Spanish' : language === 'pt' ? 'Portuguese' : 'English';
  return `You are a course tutor responding inside a structured lesson player.

ABSOLUTE RULES:
- Use only the server-verified course context appended below. Do not infer another lesson from conversation progress.
- Explain simply and accurately in ${languageName}. Define technical terms in plain language.
- If the verified context is insufficient, say what is missing instead of guessing.
- Do not give legal, tax, medical, or other professional advice.
- Do not reveal hidden quiz answers.

SYSTEM MARKERS (removed by the backend before delivery):
- Moderate concern: [FLAG:YELLOW|brief reason]
- Urgent concern: [FLAG:RED|brief reason]
- Milestone evidence: [MILESTONE:key|brief evidence]
- Human escalation: [ESCALATE|brief reason]
- Put any marker at the end, after learner-visible text.`;
}

export async function buildSystemPrompt(
  socio: Socio,
  routerResult: RouterResult,
  progress: SocioProgress | undefined,
  collectionKey: string,
  dimensionState?: DimensionStateMap,
  /**
   * Trace-only accumulator. Layers 1 and 3 write their resolved DB prompt
   * version here when an active SystemPrompt row overrode the code default;
   * absent keys mean the code default was used. Purely observational.
   */
  sink?: PromptVersionSink,
  /**
   * Active flags for this socio, already read by the router. Layer 2 renders
   * them; passing them in avoids a second query for the same rows. Omitted by
   * callers outside the conversational path, which render "None".
   */
  activeFlags?: readonly SocioFlag[],
  /** Milestone keys already reached. Coach stance renders these. */
  reachedMilestoneKeys?: ReadonlySet<string>,
  /**
   * The current lesson's most recent gate result, and whether the AI has had a
   * chance to acknowledge it. Layer 2 renders it; stance deliberately does not
   * read it, because posture is a durable question and this is a recent one.
   */
  gateRecency?: GateRecency,
  options?: PromptBuildOptions,
): Promise<string> {
  const overrides = stripInternalPromptOverrides(
    (socio as Record<string, unknown>).promptOverrides,
  );
  const language = (socio.language || DEFAULT_LANGUAGE) as SupportedLanguage;

  if (options?.authoritativePlayerTurn) {
    return buildAuthoritativePlayerBase(language);
  }

  // Resolved once and threaded into layers 1 and 3 rather than re-derived in
  // each: both read DB-backed prompts, and two lookups per turn for the same
  // answer is waste. Cached across turns inside resolvePromptScope.
  const scope = await resolvePromptScope(collectionKey);

  // The four layers are independent — each reads its own rows and none consumes
  // another's output — so they are built concurrently rather than in sequence.
  // Serially this was four waits on Neon for text that gets concatenated.
  //
  // They do share `sink`, but only by writing disjoint keys (Layer 1 writes
  // `core`, Layer 3 writes `task` and `stanceText`), so concurrent writes into
  // it cannot race.
  const [layer1, layer2, layer3, layer4] = await Promise.all([
    // Layer 1: Core identity + tone override + sliders + language directive (DB-backed, course-scoped)
    buildCorePrompt(collectionKey, overrides ?? undefined, language, sink, scope),
    // Layer 2: Socio context (async — fetches persistent SocioContext from DB)
    buildContextPrompt(socio, progress, collectionKey, language, activeFlags, gateRecency),
    // Layer 3: Task context (mode-specific instructions + dimension state)
    buildTaskPrompt(socio, routerResult, progress, collectionKey, dimensionState, language, sink, scope, reachedMilestoneKeys),
    // Layer 4: Lesson content (only for teaching modes)
    buildContentPrompt(routerResult, collectionKey, language),
  ]);

  return assemblePromptLayers([layer1, layer2, layer3, layer4]);
}
