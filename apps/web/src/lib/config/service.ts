import { prisma } from '@/lib/db';

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

// ─── In-memory cache (60s TTL) ──────────────────────────────────────
let cache: Map<string, string> | null = null;
let lastFetched = 0;
const CACHE_TTL_MS = 60_000;

async function loadAll(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && now - lastFetched < CACHE_TTL_MS) {
    return cache;
  }
  try {
    const rows = await prisma.programConfig.findMany();
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.key, row.value);
    }
    cache = map;
    lastFetched = now;
    return map;
  } catch (err) {
    console.error('[config] DB read failed, using defaults:', err);
    return new Map(Object.entries(DEFAULTS));
  }
}

/** Invalidate cache after admin updates a config value. */
export function invalidateConfigCache(): void {
  cache = null;
  lastFetched = 0;
}

/** Get a config value as a raw string. */
export async function getConfigRaw(key: string): Promise<string> {
  const map = await loadAll();
  return map.get(key) ?? DEFAULTS[key] ?? '';
}

/** Get a config value parsed as a number. */
export async function getConfigNumber(key: string): Promise<number> {
  const raw = await getConfigRaw(key);
  return Number(raw);
}

/** Get a config value parsed as a boolean. */
export async function getConfigBool(key: string): Promise<boolean> {
  const raw = await getConfigRaw(key);
  return raw === 'true';
}

/** String config value (trimmed). Empty string falls back to `DEFAULTS[key]` via `getConfigRaw`. */
export async function getConfigString(key: string): Promise<string> {
  return (await getConfigRaw(key)).trim();
}

const FALLBACK_CHATBOT_DISPLAY_NAME = 'Mentor Virtual';

/** Sanitized chatbot persona name for prompts and UI. */
export async function getChatbotDisplayName(): Promise<string> {
  const raw = await getConfigString('CHATBOT_NAME');
  const n = raw.slice(0, 80).replace(/[\r\n]/g, ' ').trim();
  return n || FALLBACK_CHATBOT_DISPLAY_NAME;
}

/** Get all config values as a key→value map. */
export async function getAllConfig(): Promise<Record<string, string>> {
  const map = await loadAll();
  // Merge defaults for any missing keys
  const result: Record<string, string> = { ...DEFAULTS };
  for (const [k, v] of map) {
    result[k] = v;
  }
  return result;
}
