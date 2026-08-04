/**
 * Resolves a course key into a full {@link ConfigScope}.
 * ═══════════════════════════════════════════════════════════════════════════
 * Kept apart from `scope.ts` so the tier arithmetic there stays pure and
 * testable without a database. This file is the only part that queries.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from '@/lib/db';
import type { ConfigScope } from './scope';

/**
 * collectionKey → organizationId. A ContentCollection's owning organization
 * does not change, so this is cached for the life of the process. `null` caches
 * a deliberate refusal (see below) so an ambiguous slug is not re-queried on
 * every turn.
 */
const orgByCollection = new Map<string, string | null>();

/** Test seam — the cache would otherwise leak between cases. */
export function clearScopeCache(): void {
  orgByCollection.clear();
}

/**
 * Builds the scope for reading prompts and config for a course.
 *
 * Fail-closed on ambiguity. `ContentCollection` is unique on
 * `(organizationId, slug)`, not on slug alone, so a slug held by two tenants
 * cannot identify one organization. Rather than picking a row, this drops the
 * organization and returns the collection key alone — which resolves to the
 * platform tier and the code default, never to another tenant's prompt.
 * A learner reading a slightly generic prompt is a small problem; a learner
 * reading a different organization's prompt is a breach.
 *
 * The same reasoning is why nothing here consults `DEFAULT_ORGANIZATION_ID`:
 * that env var exists to keep orphaned socios working, and an orphan's guessed
 * tenant must not decide which prompt text they are shown.
 */
export async function resolvePromptScope(collectionKey: string): Promise<ConfigScope> {
  if (!collectionKey) return {};

  const cached = orgByCollection.get(collectionKey);
  if (cached !== undefined) {
    return { organizationId: cached, collectionKey };
  }

  try {
    const candidates = await prisma.contentCollection.findMany({
      where: { slug: collectionKey },
      select: { organizationId: true },
    });

    let organizationId: string | null = null;
    if (candidates.length === 1) {
      organizationId = candidates[0].organizationId;
    } else if (candidates.length > 1) {
      console.warn(
        `[PromptScope] slug "${collectionKey}" is held by ${candidates.length} organizations — ` +
          `refusing to guess. Prompts for this course fall back to the platform tier.`,
      );
    }

    orgByCollection.set(collectionKey, organizationId);
    return { organizationId, collectionKey };
  } catch (err) {
    // A failed lookup must not take the whole turn down. Platform tier is the
    // safe answer and matches pre-scoping behaviour exactly.
    console.error(`[PromptScope] lookup failed for "${collectionKey}":`, err);
    return { collectionKey };
  }
}
