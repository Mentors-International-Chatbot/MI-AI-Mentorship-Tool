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
import { invokeTraced } from '@/lib/ai/trace/invokeTraced';
import { applySensedToState } from '@/lib/ai/sensing/updateDimensionState';
import { isTrivialMessage } from '@/lib/ai/sensing/triviality';
import type { DimensionStateMap, SensedDimension } from '@/lib/ai/sensing/types';
import type { TrackedDimension } from '@/lib/journey-package/journey-package.schema';

const ASSESSMENT_SENSING_TIMEOUT_MS = 10000;
export const ASSESSMENT_SENSING_MODEL = "anthropic/claude-haiku-4.5";

/** Bump whenever buildAssessmentSensingPrompt's text changes. Recorded on every AiInvocation. */
export const ASSESSMENT_SENSING_PROMPT_VERSION = 'v1';

/**
 * Trace-only identifiers. Carried through the assessment pipeline so
 * ai_invocations rows can be joined back to a socio, org and session.
 * Never read by any scoring or gating logic.
 */
export interface AssessmentTraceContext {
  socioId?: string;
  organizationId?: string;
  assessmentSessionId?: string;
}

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

  // Early turns are provisional ONLY for weak answers - a clear answer should be
  // recognized immediately and at full confidence, or the student gets dragged
  // through extra turns for no reason.
  const hasHadChanceToElaborate = turnCount >= minTurns;
  const settlingGuidance = hasHadChanceToElaborate
    ? `The student has now had ${turnCount} turn(s) - enough chances to elaborate.
Score what they have demonstrated across the whole conversation. A misconception
that PERSISTED after they were invited to reconsider is real and counts against
the level. Understanding shown at ANY point in the conversation counts FOR them -
they do not have to repeat it in the latest message.`
    : `This is turn ${turnCount} of a minimum ${minTurns}.
- If the answer already conveys the core idea, score it fully and report HIGH
  confidence (0.8+). Do not hold back a good score just because it is early -
  recognizing understanding quickly is the goal.
- Only if the answer is thin or confused should you treat it as provisional:
  report the level you see with confidence at or below 0.5, so one weak first
  answer does not settle the outcome before they have had a chance to say more.`;

  return `You are an assessment evaluator. Analyze the student's explanation and output ONLY a JSON array.

LESSON CONTEXT: ${lessonContext}

KEY CONCEPTS TO ASSESS (the student should demonstrate understanding of these):
${conceptList}

DIMENSIONS TO SCORE:
${dimensionDefs}

This is a GIST CHECK, not an exam. You are asking one question: does this student
get the MAIN IDEA? Not whether they recited it fully, in order, or precisely.
- Score based on whether the student's OWN words convey the core concept
- Do NOT assess how the student FEELS - assess what they KNOW and can EXPLAIN
- Evidence should cite the specific part of their explanation you scored on

SCORING ANCHORS (0-10 - calibrate to these, they are not suggestions):
- 8-10: Conveys the core idea. Gets the main steps across in roughly the right
  order. Informal, brief, or missing minor detail is STILL an 8-10.
  Within this band: if the student names ALL the main steps, score 9 (or 10 if
  they also explain why the order works). Reserve 8 for an answer that carries
  the core idea but leaves one main step implicit. Do not sit at 8 by default -
  a complete core answer is a 9.
- 5-7:  Core idea mostly there, but with a gap or one real confusion.
- 2-4:  Fragments only. Major steps missing or wrong.
- 1:    No meaningful understanding shown - a genuine non-answer.

CALIBRATION RULES (these override any instinct to be rigorous):
- Do NOT require perfect sequencing, completeness, or precision. Reward
  demonstrated understanding of the main idea.
- WHEN IN DOUBT, SCORE UP, NOT DOWN.
- A minor wrong detail does NOT drop the score below 7 when the core is sound.
- Brevity is not a deduction. A one-sentence answer that carries the core idea
  scores the same as a paragraph that carries it.
- The floor (1) is for genuine non-answers - blank, off-topic, "I don't know",
  or a fundamentally wrong mental model. It is NOT for imperfect answers.
- Only a genuinely confused answer stays low. Do not manufacture doubt about an
  answer that plainly shows the student understands.

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
  priorStudentAnswers: string[];
}): string {
  const { studentText, priorState, priorStudentAnswers } = params;

  const priorStateStr = Object.entries(priorState)
    .map(([key, state]) => `${key}: level=${state.level.toFixed(1)}, trend=${state.trend}`)
    .join('\n');

  // Without the earlier answers the grader treats a short confirmation
  // ("right, spread each one, done") as if it were the whole teach-back and
  // scores it as a fragment, dragging a good score down turn after turn.
  const historyStr = priorStudentAnswers.length > 0
    ? priorStudentAnswers.map((a, i) => `  [turn ${i + 1}] "${a}"`).join('\n')
    : '  (none - this is their first answer)';

  return `PRIOR DIMENSION STATES (from this session only):
${priorStateStr || 'No prior state (first turn)'}

WHAT THE STUDENT ALREADY SAID EARLIER THIS SESSION:
${historyStr}

STUDENT'S LATEST MESSAGE:
"${studentText}"

Score the student's CUMULATIVE demonstration across everything they have said
this session - not just the latest message. A short confirmation or summary in
the latest message does NOT erase understanding they already showed earlier; if
they explained it well on an earlier turn, that still counts fully in their
favour. Only lower the score if the conversation as a whole reveals a real gap
or confusion.

Output the JSON array:`;
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
  /** The student's earlier answers this session, so scoring is cumulative */
  priorStudentAnswers?: string[];
  /** Trace-only: identifies this call in ai_invocations. */
  trace?: AssessmentTraceContext;
}): Promise<DimensionStateMap> {
  const { studentText, priorState, dimensions, lessonContext, keyConcepts, turnCount, minTurns } = params;
  const priorStudentAnswers = params.priorStudentAnswers ?? [];

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
  const userPrompt = buildAssessmentUserPrompt({ studentText, priorState, priorStudentAnswers });

  try {
    const response = await invokeTraced({
      operation: 'assessment_sensing',
      model: ASSESSMENT_SENSING_MODEL,
      promptVersion: { evaluator: ASSESSMENT_SENSING_PROMPT_VERSION },
      systemPrompt,
      socioId: params.trace?.socioId,
      organizationId: params.trace?.organizationId,
      assessmentSessionId: params.trace?.assessmentSessionId,
      invoke: () => Promise.race([
        chat.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(userPrompt),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Assessment sensing timeout')), ASSESSMENT_SENSING_TIMEOUT_MS)
        ),
      ]),
    });

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
