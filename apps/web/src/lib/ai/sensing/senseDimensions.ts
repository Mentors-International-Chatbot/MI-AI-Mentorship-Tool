/**
 * Sensing Pass - Structured dimension assessment
 *
 * This module performs a fast, structured-output-only LLM call to assess
 * the student's current comprehension and emotional state. It runs separately
 * from the main response generation to maintain a continuous feedback loop.
 *
 * Key principles:
 * - Uses a smaller/cheaper model than the main response generation
 * - Returns ONLY structured JSON, no conversational text
 * - Has its own minimal system prompt (NOT shared with buildSystemPrompt)
 * - Runs every turn to build up continuous state
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { DIMENSION_DEFINITIONS } from '@/lib/ai/prompts/constants';
import type { SensedDimension, DimensionStateMap, SensingResult } from './types';
import { createOpenRouterChat } from '@/lib/ai/openrouter';

const SENSING_TIMEOUT_MS = 10000; // 10 seconds max - this should be fast
const SENSING_MODEL = "anthropic/claude-haiku-4.5"; // Use a fast model for sensing

const SENSING_SYSTEM_PROMPT = `You are a student assessment system. Analyze the student's message and output ONLY a JSON array.

For each dimension, assess the student's current state based on their message:

DIMENSIONS TO ASSESS:
1. "comprehension" - How well does the student understand the current lesson topic? (0=completely lost, 10=full mastery)
2. "confusion" - How confused or frustrated does the student appear? (0=clear and confident, 10=very confused/frustrated)

PRIOR STATE:
Consider the prior levels when making your assessment. Significant shifts should be supported by clear evidence.

OUTPUT FORMAT (JSON array only, no other text):
[
  {"dimensionKey": "comprehension", "level": <0-10>, "confidence": <0-1>, "evidence": "<≤15 words>"},
  {"dimensionKey": "confusion", "level": <0-10>, "confidence": <0-1>, "evidence": "<≤15 words>"}
]

GUIDELINES:
- Level is a continuous 0-10 score
- Confidence is your certainty in the assessment (0-1)
- Evidence should be a brief quote or paraphrase from the message
- If the message provides no clear signal, use moderate levels (4-6) with low confidence
- Output ONLY the JSON array, nothing else`;

function buildSensingPrompt(params: {
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

Analyze this message and output the JSON array:`;
}

function parseSensingResponse(rawResponse: string): SensedDimension[] {
  try {
    // Try to extract JSON from the response (handle markdown code blocks)
    let jsonStr = rawResponse.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed)) {
      console.warn('[Sensing] Response is not an array:', rawResponse);
      return getDefaultDimensions();
    }

    // Validate and normalize each dimension
    const validDimensionKeys = DIMENSION_DEFINITIONS.map(d => d.key);

    return parsed
      .filter((item: unknown): item is Record<string, unknown> => {
        return typeof item === 'object' && item !== null;
      })
      .filter((item) => validDimensionKeys.includes(String(item.dimensionKey)))
      .map((item): SensedDimension => ({
        dimensionKey: String(item.dimensionKey),
        level: Math.max(0, Math.min(10, Number(item.level) || 5)),
        confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5)),
        evidence: String(item.evidence || '').slice(0, 100),
      }));
  } catch (error) {
    console.error('[Sensing] Failed to parse response:', error, 'Raw:', rawResponse);
    return getDefaultDimensions();
  }
}

function getDefaultDimensions(): SensedDimension[] {
  return DIMENSION_DEFINITIONS.map(def => ({
    dimensionKey: def.key,
    level: 5, // Neutral default
    confidence: 0.2, // Low confidence for defaults
    evidence: 'Unable to assess from message',
  }));
}

export async function senseDimensions(params: {
  incomingText: string;
  priorState: DimensionStateMap;
  lessonContext: string;
}): Promise<SensingResult> {
  const { incomingText, priorState, lessonContext } = params;

  // Skip sensing for very short messages
  if (incomingText.trim().length < 3) {
    return {
      dimensions: getDefaultDimensions(),
      rawResponse: undefined,
    };
  }

  const chat = createOpenRouterChat({
    model: SENSING_MODEL,
    temperature: 0, // Deterministic for structured output
    maxTokens: 300, // Keep it tight - we only need JSON
  });

  const userPrompt = buildSensingPrompt({ incomingText, priorState, lessonContext });

  try {
    const response = await Promise.race([
      chat.invoke([
        new SystemMessage(SENSING_SYSTEM_PROMPT),
        new HumanMessage(userPrompt),
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sensing timeout')), SENSING_TIMEOUT_MS)
      ),
    ]);

    const rawContent = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    const dimensions = parseSensingResponse(rawContent);

    // Ensure we have all required dimensions
    const resultMap = new Map(dimensions.map(d => [d.dimensionKey, d]));
    const fullDimensions = DIMENSION_DEFINITIONS.map(def =>
      resultMap.get(def.key) || {
        dimensionKey: def.key,
        level: 5,
        confidence: 0.2,
        evidence: 'Not assessed',
      }
    );

    return {
      dimensions: fullDimensions,
      rawResponse: rawContent,
    };
  } catch (error) {
    console.error('[Sensing] LLM call failed:', error);

    // Return defaults on failure - don't block the main response
    return {
      dimensions: getDefaultDimensions(),
      rawResponse: undefined,
    };
  }
}
