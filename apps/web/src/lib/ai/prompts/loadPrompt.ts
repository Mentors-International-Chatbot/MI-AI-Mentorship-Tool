import { repo } from '@/lib/repo';
import type { SystemPrompt } from '@/lib/repo/types';

/**
 * Mutable accumulator for AI-trace prompt versions: layer key -> version string.
 *
 * Only DB-backed layers write here, and only when an active SystemPrompt row
 * actually overrode the code default. A missing key means "no override was in
 * play", so the caller keeps its own code constant. Passed explicitly rather
 * than held in module state so concurrent requests can't cross-contaminate.
 */
export type PromptVersionSink = Record<string, string>;

/**
 * Trace label for a DB-backed prompt: `db:1.0`, falling back to the row's
 * createdAt when the version column is blank. Prefixed so a glance at a trace
 * row tells you the text came from the DB, not from source.
 */
export function formatDbPromptVersion(prompt: SystemPrompt): string {
  const version = prompt.version?.trim();
  return `db:${version && version.length > 0 ? version : prompt.createdAt.toISOString()}`;
}

/**
 * Loads the active SystemPrompt for a given category from the DB.
 * Falls back to the provided fallback string if no active prompt exists.
 *
 * When `sink` and `sinkKey` are supplied, the resolved DB version is recorded
 * for AI tracing. Nothing is recorded on the fallback path.
 */
export async function loadActivePrompt(
  category: string,
  fallback: string,
  sink?: PromptVersionSink,
  sinkKey?: string,
): Promise<string> {
  try {
    const prompt = await repo.getActivePrompt(category);
    if (!prompt?.content) return fallback;

    if (sink && sinkKey) {
      sink[sinkKey] = formatDbPromptVersion(prompt);
    }
    return prompt.content;
  } catch {
    return fallback;
  }
}
