import { prisma } from '@/lib/db';
import { scopeTiers, scopeCacheKey, type ConfigScope } from '@/lib/ai/prompts/scope';

// ─── Hardcoded defaults (fallback if DB unreachable) ─────────────────
const DEFAULTS: Record<string, string> = {
  RETEACH_THRESHOLD: '3',
  MAX_LESSON_NUMBER: '5',
  MAX_LESSONS_PER_DAY: '1',
  LESSONS_PER_WEEK: '2',
  MAX_SENTENCES_PER_MESSAGE: '4',
  MAX_EMOJIS_PER_MESSAGE: '2',
  FLAG_YELLOW_THRESHOLD: '5',
  FLAG_RED_THRESHOLD: '2',
  FOLLOWUP_ENABLED: 'true',
  FOLLOWUP_DELAY_HOURS: '24',
  MAX_REMINDERS: '2',
  REQUIRE_LEGAL_CONSENT: 'false',
  SENTIMENT_URGENCY_RED: '8',
  SENTIMENT_CONFUSION_YELLOW: '7',
  SENTIMENT_FRUSTRATION_YELLOW: '7',
  /** Weekly mentor-facing AI summary output: es | en | pt */
  SUMMARY_LANGUAGE: 'es',
  /** Ask socios for satisfaction feedback every N completed lessons */
  FEEDBACK_EVERY_N_LESSONS: '5',
  /** Display name the AI uses when introducing itself (web + WhatsApp prompts) */
  CHATBOT_NAME: 'Martín',
};

// ─── In-memory cache (60s TTL), keyed by scope ──────────────────────
// Keyed rather than global: a single shared map was correct only while every
// course read the same values, and is exactly what made per-course config
// impossible. One entry per scope, each with its own TTL.
type CacheEntry = { map: Map<string, string>; fetchedAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

/**
 * Effective config for a scope: platform rows overlaid by org rows, then by
 * course rows. Applied least-specific first so the narrowest scope wins,
 * matching the prompt resolution order exactly.
 */
async function loadAll(scope?: ConfigScope): Promise<Map<string, string>> {
  const cacheKey = scopeCacheKey(scope);
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.map;

  try {
    // One query for every tier, then overlay in reverse (broadest first).
    const tiers = scopeTiers(scope);
    const rows = await prisma.programConfig.findMany({
      where: { OR: tiers.map((t) => ({ organizationId: t.organizationId, collectionKey: t.collectionKey })) },
    });

    const map = new Map<string, string>();
    for (const tier of [...tiers].reverse()) {
      for (const row of rows) {
        if (row.organizationId !== tier.organizationId) continue;
        if (row.collectionKey !== tier.collectionKey) continue;
        map.set(row.key, row.value);
      }
    }

    cache.set(cacheKey, { map, fetchedAt: now });
    return map;
  } catch (err) {
    console.error('[config] DB read failed, using defaults:', err);
    return new Map(Object.entries(DEFAULTS));
  }
}

/** Invalidate every scope's cache after a config write. */
export function invalidateConfigCache(): void {
  cache.clear();
}

/** Get a config value as a raw string. */
export async function getConfigRaw(key: string, scope?: ConfigScope): Promise<string> {
  const map = await loadAll(scope);
  return map.get(key) ?? DEFAULTS[key] ?? '';
}

/** Get a config value parsed as a number. */
export async function getConfigNumber(key: string, scope?: ConfigScope): Promise<number> {
  const raw = await getConfigRaw(key, scope);
  return Number(raw);
}

/** Get a config value parsed as a boolean. */
export async function getConfigBool(key: string, scope?: ConfigScope): Promise<boolean> {
  const raw = await getConfigRaw(key, scope);
  return raw === 'true';
}

/** String config value (trimmed). Empty string falls back to `DEFAULTS[key]` via `getConfigRaw`. */
export async function getConfigString(key: string, scope?: ConfigScope): Promise<string> {
  return (await getConfigRaw(key, scope)).trim();
}

const FALLBACK_CHATBOT_DISPLAY_NAME = 'Mentor Virtual';

/** Sanitized chatbot persona name for prompts and UI. */
export async function getChatbotDisplayName(scope?: ConfigScope): Promise<string> {
  const raw = await getConfigString('CHATBOT_NAME', scope);
  const n = raw.slice(0, 80).replace(/[\r\n]/g, ' ').trim();
  return n || FALLBACK_CHATBOT_DISPLAY_NAME;
}

/** Get all config values as a key→value map. */
export async function getAllConfig(scope?: ConfigScope): Promise<Record<string, string>> {
  const map = await loadAll(scope);
  // Merge defaults for any missing keys
  const result: Record<string, string> = { ...DEFAULTS };
  for (const [k, v] of map) {
    result[k] = v;
  }
  return result;
}
