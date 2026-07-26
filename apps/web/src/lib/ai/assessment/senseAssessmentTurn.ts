/**
 * Session-Scoped Assessment Sensing
 * ═══════════════════════════════════════════════════════════════════════════
 * Wraps the existing senseDimensions but seeds from SESSION-LOCAL state only.
 * This is the anti-cheat property: a student with high comprehension in the
 * main chat starts this session at zero and has to demonstrate understanding
 * live. The session's integrity depends on this isolation.
 *
 * CRITICAL: This module must NEVER read global SocioDimensionState.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createOpenRouterChat } from '@/lib/ai/openrouter';
import { applySensedToState } from '@/lib/ai/sensing/updateDimensionState';
import { isTrivialMessage } from '@/lib/ai/sensing/triviality';
import type { DimensionStateMap, SensedDimension } from '@/lib/ai/sensing/types';
import type { TrackedDimension } from '@/lib/journey-package/journey-package.schema';

const ASSESSMENT_SENSING_TIMEOUT_MS = 10000;
const ASSESSMENT_SENSING_MODEL = "anthropic/claude-haiku-4.5";

/**
 * Assessment-specific sensing prompt.
 * Judges how well the STUDENT'S OWN EXPLANATION covers keyConcepts,
 * NOT how the student is feeling about a lesson being delivered to them.
 */
function buildAssessmentSensingPrompt(params: {
  dimensions: TrackedDimension[];
  keyConcepts: string[];
  lessonContext: string;
  turnCount: number;
  minTurns: number;
}): string {
  const { dimensions, keyConcepts, lessonContext, turnCount, minTurns } = params;

  const dimensionDefs = dimensions
    .map((d) => `- "${d.key}" (${d.label}): scale ${d.scale.min}-${d.scale.max}`)
    .join('\n');

  const conceptList = keyConcepts.map((c, i) => `${i + 1}. ${c}`).join('\n');

  // Before minTurns the student has not yet been given the chance to correct
  // or elaborate, so a shaky answer is provisional, not final.
  const hasHadChanceToElaborate = turnCount >= minTurns;
  const settlingGuidance = hasHadChanceToElaborate
    ? `The student has now had ${turnCount} turn(s) - enough chances to correct or elaborate.
Score what they have actually demonstrated across the whole conversation. A
misconception that PERSISTED after they were invited to reconsider is real and
should count against the level.`
    : `This is turn ${turnCount} of a minimum ${minTurns}. The student has NOT yet had a
genuine chance to correct or elaborate. Treat any gap or misconception as
PROVISIONAL: report the level you see, but keep confidence at or below 0.5 so
one thin first answer does not settle the outcome. Do not punish an answer for
being incomplete this early - incompleteness at turn 1 is expected.`;

  return `You are an assessment evaluator. Analyze the student's explanation and output ONLY a JSON array.

LESSON CONTEXT: ${lessonContext}

KEY CONCEPTS TO ASSESS (the student should demonstrate understanding of these):
${conceptList}

DIMENSIONS TO SCORE:
${dimensionDefs}

For each dimension, assess how well the student's explanation demonstrates their understanding:
- Score based on whether the student's OWN words accurately cover the key concepts
- Do NOT assess how the student FEELS - assess what they KNOW and can EXPLAIN
- Evidence should cite specific parts of their explanation that support or lack the concept

SCORING ANCHORS (on a 0-10 scale - calibrate to these, they are not suggestions):
- 8-10: Fully correct and well-sequenced. Covers the key concepts in their own
  words. Small wording imprecision is fine at this band.
- 6-7:  Mostly correct with a minor error or one omitted detail. The core
  understanding is clearly there.
- 4-5:  Right general idea, but a real misconception or a missing key step.
- 1-3:  Little correct understanding. Mostly wrong, off-topic, or "I don't know".
- 0:    Nothing to assess.

CALIBRATION RULES:
- Deduct PROPORTIONALLY. A single wrong detail inside an otherwise sound
  explanation is a 6-7, NOT a 1-3. Never collapse a good answer to the floor
  over one flaw.
- Judge the explanation against the key concepts only. Do not deduct for brevity,
  informal phrasing, or missing detail the concepts never asked for.
- Do NOT inflate either. A genuinely confused or wrong answer stays in the 1-3
  band no matter how confidently or politely it is worded. Accuracy, not leniency.

TIMING:
${settlingGuidance}

OUTPUT FORMAT (JSON array only, no other text):
[
  {"dimensionKey": "<key>", "level": <number>, "confidence": <0-1>, "evidence": "<≤15 words>"}
]

GUIDELINES:
- Level uses the scale defined for each dimension
- Confidence is your certainty in the assessment (0-1)
- Evidence should quote or paraphrase the student's explanation
- Output ONLY the JSON array, nothing else`;
}

function buildAssessmentUserPrompt(params: {
  studentText: string;
  priorState: DimensionStateMap;
}): string {
  const { studentText, priorState } = params;

  const priorStateStr = Object.entries(priorState)
    .map(([key, state]) => `${key}: level=${state.level.toFixed(1)}, trend=${state.trend}`)
    .join('\n');

  return `PRIOR DIMENSION STATES (from this session only):
${priorStateStr || 'No prior state (first turn)'}

STUDENT'S EXPLANATION:
"${studentText}"

Analyze this explanation and output the JSON array:`;
}

function parseAssessmentSensingResponse(
  rawResponse: string,
  dimensions: TrackedDimension[]
): SensedDimension[] {
  try {
    let jsonStr = rawResponse.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed)) {
      console.warn('[AssessmentSensing] Response is not an array:', rawResponse);
      return getDefaultAssessmentDimensions(dimensions);
    }

    const validKeys = new Set(dimensions.map((d) => d.key));

    return parsed
      .filter((item: unknown): item is Record<string, unknown> => {
        return typeof item === 'object' && item !== null;
      })
      .filter((item) => validKeys.has(String(item.dimensionKey)))
      .map((item): SensedDimension => {
        const dim = dimensions.find((d) => d.key === item.dimensionKey);
        const scale = dim?.scale ?? { min: 0, max: 10 };
        const level = Math.max(scale.min, Math.min(scale.max, Number(item.level) || 5));

        return {
          dimensionKey: String(item.dimensionKey),
          level,
          confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5)),
          evidence: String(item.evidence || '').slice(0, 100),
        };
      });
  } catch (error) {
    console.error('[AssessmentSensing] Failed to parse response:', error, 'Raw:', rawResponse);
    return getDefaultAssessmentDimensions(dimensions);
  }
}

function getDefaultAssessmentDimensions(dimensions: TrackedDimension[]): SensedDimension[] {
  return dimensions.map((dim) => ({
    dimensionKey: dim.key,
    level: dim.calibrationMode === 'zero_start' ? 0 : (dim.assumedBaseline ?? 5),
    confidence: 0.2,
    evidence: 'Unable to assess from explanation',
  }));
}

/**
 * Session-scoped sensing for assessment turns.
 * Takes prior state IN, returns updated state OUT.
 * Pure-ish: no database reads or writes.
 *
 * ANTI-CHEAT: priorState comes from session.liveState, NOT global SocioDimensionState.
 */
export async function senseAssessmentTurn(params: {
  studentText: string;
  priorState: DimensionStateMap;
  dimensions: TrackedDimension[];
  lessonContext: string;
  keyConcepts: string[];
  /** Current turn number (1-indexed) - drives provisional vs. settled scoring */
  turnCount: number;
  /** Minimum turns before a score is allowed to settle */
  minTurns: number;
}): Promise<DimensionStateMap> {
  const { studentText, priorState, dimensions, lessonContext, keyConcepts, turnCount, minTurns } = params;

  // Skip only bare acknowledgments here - in an assessment a short message may
  // still be the student's real explanation, so word count alone is not enough.
  if (isTrivialMessage(studentText, 'assessment')) {
    console.log('[AssessmentSensing] Skipped (trivial message), carrying prior state forward');
    return priorState;
  }

  const chat = createOpenRouterChat({
    model: ASSESSMENT_SENSING_MODEL,
    temperature: 0,
    maxTokens: 500,
  });

  const systemPrompt = buildAssessmentSensingPrompt({
    dimensions,
    keyConcepts,
    lessonContext,
    turnCount,
    minTurns,
  });
  const userPrompt = buildAssessmentUserPrompt({ studentText, priorState });

  try {
    const response = await Promise.race([
      chat.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Assessment sensing timeout')), ASSESSMENT_SENSING_TIMEOUT_MS)
      ),
    ]);

    const rawContent = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    const sensed = parseAssessmentSensingResponse(rawContent, dimensions);

    // Ensure all tracked dimensions are present
    const resultMap = new Map(sensed.map((d) => [d.dimensionKey, d]));
    const fullSensed = dimensions.map((dim) =>
      resultMap.get(dim.key) || {
        dimensionKey: dim.key,
        level: dim.calibrationMode === 'zero_start' ? 0 : (dim.assumedBaseline ?? 5),
        confidence: 0.2,
        evidence: 'Not assessed',
      }
    );

    // Raw sensed levels before smoothing - the grader's actual verdict on this
    // turn, which the EMA then folds into the running state.
    console.log(
      `[AssessmentSensing] turn ${turnCount} raw:`,
      fullSensed.map((d) => `${d.dimensionKey}=${d.level}@${d.confidence}`).join(' '),
    );

    // Apply the pure EMA function to get new state
    return applySensedToState(priorState, fullSensed);
  } catch (error) {
    console.error('[AssessmentSensing] LLM call failed:', error);
    // Return prior state unchanged on failure
    return priorState;
  }
}

/**
 * Creates initial session state for a new assessment.
 * All dimensions start at their calibration baseline (zero for zero_start).
 * NEVER reads global SocioDimensionState.
 */
export function createInitialSessionState(dimensions: TrackedDimension[]): DimensionStateMap {
  const state: DimensionStateMap = {};
  const now = new Date();

  for (const dim of dimensions) {
    const initialLevel = dim.calibrationMode === 'zero_start'
      ? 0
      : (dim.assumedBaseline ?? 5);

    state[dim.key] = {
      dimensionKey: dim.key,
      level: initialLevel,
      trend: 'flat',
      confidence: 0,
      evidence: null,
      updatedAt: now,
    };
  }

  return state;
}
