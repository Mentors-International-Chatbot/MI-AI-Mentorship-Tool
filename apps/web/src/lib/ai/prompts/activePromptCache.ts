/**
 * Active-prompt read cache
 * ═══════════════════════════════════════════════════════════════════════════
 * `repo.getActivePrompt` walks (org, collection) → (org, null) → (null, null)
 * with one sequential query per tier, deliberately — see the comment on
 * `prismaRepo.getActivePrompt` for why fetching all candidates in one round
 * trip is the wrong trade for a multi-tenant prompt read.
 *
 * That safety costs up to three round trips per category, and a conversational
 * turn loads three categories (`core`, the mode's task category, and
 * `stance_tutor`/`stance_coach`). Nine sequential Neon hops per turn, for text
 * that changes when someone edits it in /admin — perhaps monthly.
 *
 * So the fix is not to weaken the tier walk, it is to stop repeating it. This
 * caches the walk's *result*, including the null result: a category with no row
 * anywhere is the common case and pays the full three-tier price every time.
 *
 * TTL and invalidation follow `config/service.ts` exactly, because the two
 * solve the same problem for the same tables:
 *   - 60s TTL bounds staleness on instances that did not serve the write
 *   - `invalidateActivePromptCache()` on activation makes it immediate on the
 *     instance that did
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { repo } from '@/lib/repo';
import type { SystemPrompt } from '@/lib/repo/types';
import { scopeCacheKey, type ConfigScope } from './scope';

type CacheEntry = { prompt: SystemPrompt | null; fetchedAt: number };

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

/**
 * Clears every scope's cache. Called after a prompt is activated or
 * deactivated in /admin, and by tests that swap the repo underneath.
 */
export function invalidateActivePromptCache(): void {
  cache.clear();
}

/**
 * The active prompt for a category within `scope`, memoized for 60s.
 *
 * Errors are NOT caught here and NOT cached. Both call sites already treat a
 * failed lookup as "use the code default" (`loadActivePrompt` and
 * `layers/core.ts` each wrap this in their own try/catch), and swallowing the
 * throw here would cache a transient DB blip as a real absence.
 */
export async function getActivePromptCached(
  category: string,
  scope?: ConfigScope,
): Promise<SystemPrompt | null> {
  const key = `${category}|${scopeCacheKey(scope)}`;
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.prompt;

  const prompt = await repo.getActivePrompt(category, scope);
  cache.set(key, { prompt, fetchedAt: now });
  return prompt;
}
