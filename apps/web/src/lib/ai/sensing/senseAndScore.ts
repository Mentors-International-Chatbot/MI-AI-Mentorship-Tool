/**
 * One pass over the learner's message, not two
 * ═══════════════════════════════════════════════════════════════════════════
 * Until 2026-08-10 a substantive turn made two separate Haiku calls about the
 * same sentence:
 *
 *   sensing    → comprehension, confusion          (feeds the reteach heuristic)
 *   sentiment  → confusion, frustration, urgency,  (feeds auto-flagging)
 *                sentiment, topics
 *
 * Two round trips, two trace rows, two JSON parses, and `confusion` scored
 * twice by the same model from the same text — with no guarantee the two
 * answers agreed. This is one call returning both shapes.
 *
 * ── Why the halves stay separable ─────────────────────────────────────────
 * They are parsed independently and fail independently. A response that yields
 * usable dimensions but malformed sentiment still updates the EMA; the reverse
 * still flags a distressed learner. Merging the call must not merge the
 * failure modes — losing both signals to one bad response would be a worse
 * outcome than the second round trip this removes.
 *
 * ── Prompt ownership ──────────────────────────────────────────────────────
 * The merged prompt is loaded through the `sentiment` category, which is
 * platform-scoped on purpose (see PROMPT_CATEGORIES): its output is a fixed
 * JSON contract driving auto-flagging, so a course lead editing it could
 * silently disable flagging for their learners. That reasoning now covers the
 * dimension half too, which is a widening of what that one row controls —
 * acceptable because the row is admin-only and because a malformed override
 * degrades to documented defaults rather than to plausible wrong numbers.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { DIMENSION_DEFINITIONS } from '@/lib/ai/prompts/constants';
import { createOpenRouterChat } from '@/lib/ai/openrouter';
import { invokeTraced } from '@/lib/ai/trace/invokeTraced';
import { loadActivePrompt, type PromptVersionSink } from '@/lib/ai/prompts/loadPrompt';
import { clamp, validateSentiment, type SentimentResult } from '@/lib/sentiment/analyzer';
import { isTrivialMessage } from './triviality';
import type { SensedDimension, DimensionStateMap } from './types';

const TIMEOUT_MS = 10_000;
const MODEL = 'anthropic/claude-haiku-4.5';

/** Bump whenever ANALYSIS_SYSTEM_PROMPT_DEFAULT changes. Recorded on every AiInvocation. */
export const ANALYSIS_PROMPT_VERSION = 'v1';

export interface SenseAndScoreResult {
  /** Empty when the message could not be scored, or was too thin to try. */
  dimensions: SensedDimension[];
  /** Null when the sentiment half could not be parsed. */
  sentiment: SentimentResult | null;
  /** True when no LLM call was made at all. */
  skipped: boolean;
}

export type SensingDimensionDefinition = { key: string; label: string; min: number; max: number };

const ANALYSIS_SYSTEM_PROMPT_DEFAULT = `You assess a student's message in an educational mentorship program. Output ONLY valid JSON, no backticks and no explanation.

Output exactly this shape:
{
  "dimensions": [
    {"dimensionKey": "comprehension", "level": 0-10, "confidence": 0-1, "evidence": "<=15 words"},
    {"dimensionKey": "confusion", "level": 0-10, "confidence": 0-1, "evidence": "<=15 words"}
  ],
  "sentiment": {"confusion": 0-10, "frustration": 0-10, "urgency": 0-10, "sentiment": "positive|neutral|negative|distressed", "topics": ["learning"]}
}

DIMENSIONS (slow-moving state; consider the prior levels given, and support big shifts with clear evidence):
- comprehension: how well they understand the current lesson topic (0 = completely lost, 10 = full mastery)
- confusion: how confused or frustrated they appear (0 = clear and confident, 10 = very confused)
- confidence is your certainty (0-1). With no clear signal, use levels 4-6 and low confidence.
- evidence is a brief quote or paraphrase from the message.

SENTIMENT (this message only):
- confusion: 0 = understands everything, 10 = completely lost
- frustration: 0 = calm, 10 = furious/desperate
- urgency: 0 = no rush, 10 = immediate emergency
- topics: 1-3 of "learning", "progress", "personal", "family", "finances", "application", "other"

IMPORTANT: Focus on emotional signals regardless of language or cultural context. Look for:
- Confusion: questions about concepts, "I don't understand", repeated requests for clarification
- Frustration: complaints, expressions of difficulty, giving up language
- Urgency: time pressure, crisis language, desperate tone
- Distress: emotional overwhelm, crisis indicators

Informal language does not imply frustration. Evaluate the underlying emotional state.`;

function buildUserPrompt(params: {
  incomingText: string;
  priorState: DimensionStateMap;
  lessonContext: string;
}): string {
  const { incomingText, priorState, lessonContext } = params;

  const priorStateStr = Object.entries(priorState)
    .map(([key, state]) => `${key}: level=${state.level.toFixed(1)}, trend=${state.trend}`)
    .join('\n');

  return `CURRENT LESSON TOPIC: ${lessonContext || 'General mentoring conversation'}

PRIOR DIMENSION STATES:
${priorStateStr || 'No prior state (first message)'}

STUDENT'S MESSAGE:
"${incomingText}"

Analyze and output the JSON object:`;
}

/** Strips code fences and returns the outermost JSON object, or null. */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.replace(/```json\s*|```/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return null;
    return JSON.parse(cleaned.slice(first, last + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The dimension half. Returns [] rather than neutral defaults when it cannot
 * read the response: feeding 5/10 into the EMA would drag real state toward the
 * middle, which is exactly the dilution the triviality gate exists to prevent.
 */
export function parseDimensions(
  parsed: Record<string, unknown> | null,
  definitions: readonly SensingDimensionDefinition[] = DIMENSION_DEFINITIONS.map((item) => ({ ...item, min: 0, max: 10 })),
): SensedDimension[] {
  if (!parsed || !Array.isArray(parsed.dimensions)) return [];

  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

  const sensed = parsed.dimensions
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .filter((item) => byKey.has(String(item.dimensionKey)) && item.level !== null && item.level !== undefined)
    .filter((item) => Number.isFinite(Number(item.level)))
    .map((item): SensedDimension => ({
      dimensionKey: String(item.dimensionKey),
      level: clamp(Number(item.level), byKey.get(String(item.dimensionKey))!.min, byKey.get(String(item.dimensionKey))!.max),
      confidence: clamp(Number(item.confidence) || 0.5, 0, 1),
      evidence: String(item.evidence ?? '').slice(0, 100),
    }));

  return sensed.length > 0 ? sensed : [];
}

/** The sentiment half. Null when unreadable, so the caller can skip persisting. */
export function parseSentiment(parsed: Record<string, unknown> | null): SentimentResult | null {
  if (!parsed) return null;
  const s = parsed.sentiment;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;

  const o = s as Record<string, unknown>;
  return {
    confusion: clamp(Number(o.confusion) || 0, 0, 10),
    frustration: clamp(Number(o.frustration) || 0, 0, 10),
    urgency: clamp(Number(o.urgency) || 0, 0, 10),
    sentiment: validateSentiment(o.sentiment),
    topics: Array.isArray(o.topics) ? o.topics.map(String).slice(0, 3) : ['other'],
  };
}

export async function senseAndScore(params: {
  incomingText: string;
  priorState: DimensionStateMap;
  lessonContext: string;
  socioId?: string;
  organizationId?: string;
  dimensions?: SensingDimensionDefinition[];
}): Promise<SenseAndScoreResult> {
  const { incomingText, priorState, lessonContext } = params;

  // A bare acknowledgement carries neither comprehension signal nor emotion.
  // Skipping is what keeps "ok" from costing a round trip and from dragging the
  // EMA toward neutral.
  if (isTrivialMessage(incomingText, 'chat')) {
    return { dimensions: [], sentiment: null, skipped: true };
  }

  const sink: PromptVersionSink = {};
  const dynamicPrompt = params.dimensions?.length ? `You assess a learner's message in an educational course. Output ONLY valid JSON.

Return {"dimensions":[{"dimensionKey":"exact_key","level":number|null,"confidence":0-1,"evidence":"<=15 words"}],"sentiment":{"confusion":0-10,"frustration":0-10,"urgency":0-10,"sentiment":"positive|neutral|negative|distressed","topics":["learning"]}}.

Assess only dimensions the learner actually demonstrates. Use null for untouched dimensions. Never invent evidence. Dimensions:
${params.dimensions.map((item) => `- ${item.key}: ${item.label} (${item.min}-${item.max})`).join('\n')}` : null;
  const systemPrompt = dynamicPrompt ?? await loadActivePrompt(
    'sentiment', ANALYSIS_SYSTEM_PROMPT_DEFAULT, undefined, sink, 'sentiment',
  );

  const chat = createOpenRouterChat({
    model: MODEL,
    temperature: 0,
    maxTokens: 400,
  });

  try {
    const response = await invokeTraced({
      operation: 'sensing',
      model: MODEL,
      promptVersion: { analysis: sink.sentiment ?? ANALYSIS_PROMPT_VERSION },
      systemPrompt,
      socioId: params.socioId,
      organizationId: params.organizationId,
      invoke: () => Promise.race([
        chat.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(buildUserPrompt({ incomingText, priorState, lessonContext })),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Analysis timeout')), TIMEOUT_MS),
        ),
      ]),
    });

    const raw = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    // Parsed once, read twice, failing independently.
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      console.error('[Analysis] Could not parse response:', raw.slice(0, 200));
    }

    return {
      dimensions: parseDimensions(parsed, params.dimensions),
      sentiment: parseSentiment(parsed),
      skipped: false,
    };
  } catch (error) {
    // Never block the reply. Losing a turn of analysis costs a slow-moving EMA
    // one sample and delays a flag by one message.
    console.error('[Analysis] Call failed:', error);
    return { dimensions: [], sentiment: null, skipped: false };
  }
}
