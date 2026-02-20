import { Socio } from '@/lib/repo/types';
import { PromptOverrides, RouterResult, SocioProgress, ToneOverride } from './types';
import { buildCorePrompt } from './layers/core';
import { buildContextPrompt } from './layers/context';
import { buildTaskPrompt } from './layers/task';
import { buildContentPrompt } from './layers/content';

// ─── Prompt Builder ─────────────────────────────────────────────────
// Assembles the 4-layer system prompt at runtime.
//
// Layer 1 — Core identity (~350 tokens): always sent, cached
// Layer 2 — Socio context (~150 tokens): built from DB per-request
// Layer 3 — Task context (~150 tokens): based on interaction mode
// Layer 4 — Lesson content (~300 tokens): only when teaching/answering
//
// Total: ~950 tokens (vs ~3,000+ for a monolithic prompt)

let cachedCorePrompt: string | null = null;
let cachedToneOverride: ToneOverride | undefined = undefined;

function getCorePrompt(toneOverride?: ToneOverride): string {
  if (cachedCorePrompt && cachedToneOverride === toneOverride) {
    return cachedCorePrompt;
  }
  cachedCorePrompt = buildCorePrompt(toneOverride);
  cachedToneOverride = toneOverride;
  return cachedCorePrompt;
}

export function buildSystemPrompt(
  socio: Socio,
  routerResult: RouterResult,
  progress?: SocioProgress,
): string {
  const overrides = (socio as Record<string, unknown>).promptOverrides as PromptOverrides | null;
  const toneOverride = overrides?.toneOverride;

  // Layer 1: Core identity + optional tone override
  const layer1 = getCorePrompt(toneOverride);

  // Layer 2: Socio context
  const layer2 = buildContextPrompt(socio, progress);

  // Layer 3: Task context (mode-specific instructions)
  const layer3 = buildTaskPrompt(socio, routerResult, progress);

  // Layer 4: Lesson content (only for teaching modes)
  const layer4 = buildContentPrompt(routerResult, progress);

  const parts = [layer1, layer2, layer3];
  if (layer4) parts.push(layer4);

  return parts.join('\n\n');
}
