import { Socio } from '@/lib/repo/types';
import { PromptOverrides, RouterResult, SocioProgress } from './types';
import { buildCorePrompt } from './layers/core';
import { buildContextPrompt } from './layers/context';
import { buildTaskPrompt } from './layers/task';
import { buildContentPrompt } from './layers/content';
import type { SupportedLanguage } from '@/lib/i18n/languages';

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
  if (Object.keys(o).length === 0) return null;
  return o as PromptOverrides;
}

export async function buildSystemPrompt(
  socio: Socio,
  routerResult: RouterResult,
  progress?: SocioProgress,
): Promise<string> {
  const overrides = stripInternalPromptOverrides(
    (socio as Record<string, unknown>).promptOverrides,
  );
  const language = (socio.language || 'es') as SupportedLanguage;

  // Layer 1: Core identity + tone override + sliders + language directive (DB-backed)
  const layer1 = await buildCorePrompt(overrides ?? undefined, language);

  // Layer 2: Socio context (now async — fetches persistent SocioContext from DB)
  const layer2 = await buildContextPrompt(socio, progress);

  // Layer 3: Task context (mode-specific instructions)
  const layer3 = buildTaskPrompt(socio, routerResult, progress);

  // Layer 4: Lesson content (only for teaching modes)
  const layer4 = buildContentPrompt(routerResult);

  const parts = [layer1, layer2, layer3];
  if (layer4) parts.push(layer4);

  return parts.join('\n\n');
}
