/**
 * Assessment Turn Pipeline
 * ═══════════════════════════════════════════════════════════════════════════
 * Orchestrates a single turn in a gated teach-back assessment session.
 *
 * Flow:
 *   1. Concurrently: sense the student's explanation AND draft the probing
 *      reply. The probe is written against PRIOR state, which is fine - it
 *      only steers which concept to ask about next, and dimension state is a
 *      slow-moving EMA. Halves turn latency (~5s serial -> ~2.5s parallel).
 *   2. Check pass/fail conditions against the SENSED state. The threshold must
 *      see the current turn's answer, so it waits for sensing - only the
 *      conversational reply is parallelized.
 *   3. On a terminal outcome the drafted probe is discarded and a closing
 *      message is generated instead.
 *   4. Return updated state and response
 *
 * CRITICAL: This module never reads global SocioDimensionState. All state
 * comes from the session's liveState field (anti-cheat property).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { createOpenRouterChat } from '@/lib/ai/openrouter';
import { invokeTraced } from '@/lib/ai/trace/invokeTraced';
import { invokeStyledPlayerResponse, contentToText, PLAYER_REPAIR_SYSTEM_PROMPT } from '@/lib/ai/service';
import { buildResponseStyleInstruction, resolvePlayerMaxTokens } from '@/lib/player/responseStyle';
import {
  senseAssessmentTurn,
  createInitialSessionState,
  type AssessmentTraceContext,
} from './senseAssessmentTurn';
import {
  buildAssessmentPrompt,
  buildPassedClosingMessage,
  buildMaxTurnsClosingMessage,
  ASSESSMENT_EVALUATOR_PROMPT_VERSION,
  type AssessmentPromptParams,
} from './buildAssessmentPrompt';
import type { DimensionStateMap } from '@/lib/ai/sensing/types';
import type { TrackedDimension, ResponseStyle } from '@/lib/journey-package/journey-package.schema';

const EVALUATOR_MODEL = "anthropic/claude-haiku-4.5";
const EVALUATOR_TIMEOUT_MS = 15000;

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface AssessmentConfig {
  /** The teach_back block's prompt - the opening question */
  teachBackPrompt: string;
  /** Key concepts from the lesson (hidden rubric) */
  keyConcepts: string[];
  /** Concepts this specific block evaluates (subset of keyConcepts) */
  evaluatesConcepts: string[];
  /** Brief lesson context for the evaluator */
  lessonContext: string;
  /** AI behavior settings */
  aiBehavior: {
    tone?: string;
    teachingStyle?: string;
    languageInstruction?: string;
  };
  /** Passing criteria */
  passing: {
    dimensionKey: string;
    threshold: number;
    confidenceFloor: number;
    minTurns: number;
    maxTurns: number;
  };
  /** What the student sees at the end */
  studentVisibleDimensionKeys: string[];
  /** Whether terminal learner-facing prose may mention scores at all. */
  showScoreToLearner?: boolean;
  /** Policy when max turns reached without passing */
  onMaxTurnsPolicy: 'complete_with_scores' | 'return_for_reteach' | 'flag_mentor';
  /** Tracked dimensions for sensing */
  dimensions: TrackedDimension[];
  /**
   * Learner-visible generation limits for the probe reply. Undefined only for
   * sessions created before this field existed (see SessionConfigSnapshot's
   * own comment) — new sessions always carry one, since createAssessmentSession
   * defaults it on. When present, `generateEvaluatorResponse` enforces it the
   * same way `invokeStyledPlayerResponse` enforces it for teach/teach_back
   * turns: a hard instruction plus a repair-then-accept-or-fallback loop.
   */
  responseStyle?: ResponseStyle;
}

export interface AssessmentTurnInput {
  /** The student's message this turn */
  studentText: string;
  /** Prior conversation (alternating user/assistant) */
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Session state from previous turns (or empty for first turn) */
  priorState: DimensionStateMap;
  /** Current turn number (1-indexed) */
  turnCount: number;
  /** Assessment configuration */
  config: AssessmentConfig;
  /** Trace-only identifiers for ai_invocations. Never affects scoring. */
  trace?: AssessmentTraceContext;
}

export type { AssessmentTraceContext };

export type AssessmentTurnOutcome =
  | { status: 'continue'; updatedState: DimensionStateMap; evaluatorResponse: string }
  | { status: 'passed'; updatedState: DimensionStateMap; closingMessage: string; scores: Record<string, number> }
  | { status: 'max_turns'; updatedState: DimensionStateMap; closingMessage: string; scores: Record<string, number> };

// ═══════════════════════════════════════════════════════════════════════════
// Pass/Fail Logic
// ═══════════════════════════════════════════════════════════════════════════

/** Exported for direct unit testing — see checkPassCondition.test.ts (E.5.2). */
export function checkPassCondition(
  state: DimensionStateMap,
  passing: AssessmentConfig['passing'],
  turnCount: number,
): boolean {
  // Must meet minimum turns
  if (turnCount < passing.minTurns) {
    return false;
  }

  // Check the gating dimension
  const gatingState = state[passing.dimensionKey];
  if (!gatingState) {
    return false;
  }

  // Must meet threshold AND confidence floor
  return gatingState.level >= passing.threshold && gatingState.confidence >= passing.confidenceFloor;
}

function extractStudentVisibleScores(
  state: DimensionStateMap,
  visibleKeys: string[],
): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const key of visibleKeys) {
    const dimState = state[key];
    if (dimState) {
      scores[key] = dimState.level;
    }
  }
  return scores;
}

// ═══════════════════════════════════════════════════════════════════════════
// Response Generation
// ═══════════════════════════════════════════════════════════════════════════

async function generateEvaluatorResponse(params: {
  systemPrompt: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  studentText: string;
  responseStyle?: ResponseStyle;
  trace?: AssessmentTraceContext;
}): Promise<string> {
  const { systemPrompt, conversationHistory, studentText, responseStyle, trace } = params;

  const styledSystemPrompt = responseStyle
    ? `${systemPrompt}\n\n${buildResponseStyleInstruction(responseStyle, false)}`
    : systemPrompt;

  const chat = createOpenRouterChat({
    model: EVALUATOR_MODEL,
    temperature: responseStyle ? 0.3 : 0.7,
    maxTokens: resolvePlayerMaxTokens(responseStyle, false) ?? 500,
  });

  // Build messages: system + history + current student message
  const messages = [
    new SystemMessage(styledSystemPrompt),
    ...conversationHistory.map((msg) =>
      msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
    ),
    new HumanMessage(studentText),
  ];

  try {
    if (!responseStyle) {
      // No configured style — only possible for a session created before
      // this field existed (see AssessmentConfig.responseStyle's comment).
      // Unchanged from before: one attempt, no enforcement, no repair.
      const response = await invokeTraced({
        operation: 'assessment_turn',
        model: EVALUATOR_MODEL,
        promptVersion: { evaluator: ASSESSMENT_EVALUATOR_PROMPT_VERSION },
        systemPrompt: styledSystemPrompt,
        socioId: trace?.socioId,
        organizationId: trace?.organizationId,
        assessmentSessionId: trace?.assessmentSessionId,
        mode: 'probe',
        invoke: () => Promise.race([
          chat.invoke(messages),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Evaluator response timeout')), EVALUATOR_TIMEOUT_MS)
          ),
        ]),
      });
      return contentToText(response.content);
    }

    // Same repair-then-accept-or-fallback loop teach/teach_back/project turns
    // already run through (invokeStyledPlayerResponse, service.ts). No player
    // `intent` is passed: the probe's own system prompt already states its
    // question shape (RECOGNIZE UNDERSTANDING FAST / STATUS QUESTIONS in
    // buildAssessmentPrompt.ts), and a player intent would borrow calibration
    // language (e.g. teach_back's "never begin with you") that doesn't apply
    // to a probe turn. An unrepairable draft throws inside
    // invokeStyledPlayerResponse; the catch below turns that into the same
    // gentle fallback a transient provider error already falls back to, so a
    // style failure never surfaces as a hard error on the assessment route.
    const response = await invokeStyledPlayerResponse(
      chat,
      messages,
      responseStyle,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      studentText,
      { timeoutMs: EVALUATOR_TIMEOUT_MS },
      ({ stage, repairIndex, providerAttempt, invoke }) => invokeTraced({
        operation: 'assessment_turn',
        model: EVALUATOR_MODEL,
        promptVersion: { evaluator: ASSESSMENT_EVALUATOR_PROMPT_VERSION },
        systemPrompt: stage === 'initial' ? styledSystemPrompt : PLAYER_REPAIR_SYSTEM_PROMPT,
        socioId: trace?.socioId,
        organizationId: trace?.organizationId,
        assessmentSessionId: trace?.assessmentSessionId,
        mode: 'probe',
        context: { generationStage: stage, repairIndex, providerAttempt },
        invoke: () => invoke(),
      }),
    );
    return contentToText(response.content);
  } catch (error) {
    console.error('[AssessmentTurn] Evaluator response failed:', error);
    // Fallback: gentle probe that doesn't give away answers
    return "I'd love to hear more about your understanding. Can you tell me a bit more about what you've learned?";
  }
}

async function generateClosingMessage(params: {
  systemPrompt: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  studentText: string;
  trace?: AssessmentTraceContext;
}): Promise<string> {
  const { systemPrompt, conversationHistory, studentText } = params;

  const chat = createOpenRouterChat({
    model: EVALUATOR_MODEL,
    temperature: 0.7,
    maxTokens: 300,
  });

  // Include history so the closing message can reference what the student explained well
  const messages = [
    new SystemMessage(systemPrompt),
    ...conversationHistory.map((msg) =>
      msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
    ),
    new HumanMessage(studentText),
  ];

  try {
    const response = await invokeTraced({
      operation: 'assessment_turn',
      model: EVALUATOR_MODEL,
      promptVersion: { evaluator: ASSESSMENT_EVALUATOR_PROMPT_VERSION },
      systemPrompt,
      socioId: params.trace?.socioId,
      organizationId: params.trace?.organizationId,
      assessmentSessionId: params.trace?.assessmentSessionId,
      mode: 'closing',
      invoke: () => Promise.race([
        chat.invoke(messages),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Closing message timeout')), EVALUATOR_TIMEOUT_MS)
        ),
      ]),
    });

    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  } catch (error) {
    console.error('[AssessmentTurn] Closing message failed:', error);
    return "Thank you for your explanation. You've completed this assessment.";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Pipeline
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Runs a single turn of the assessment pipeline.
 *
 * @param input - Turn input including student text, history, and config
 * @returns Outcome with updated state and evaluator response or closing message
 */
export async function runAssessmentTurn(input: AssessmentTurnInput): Promise<AssessmentTurnOutcome> {
  const { studentText, conversationHistory, priorState, turnCount, config, trace } = input;
  const { passing, aiBehavior, keyConcepts, evaluatesConcepts, dimensions, studentVisibleDimensionKeys, onMaxTurnsPolicy } = config;

  // ─── Step 1: Sense and draft the probe concurrently ───────────────────────
  // Sensing is the slow leg (~2s). The probe only needs to know which concepts
  // are still unproven, which prior state answers well enough, so it does not
  // have to wait. The pass/fail check below still uses the freshly sensed state.
  const sensingPromise = senseAssessmentTurn({
    studentText,
    priorState,
    dimensions,
    lessonContext: config.lessonContext,
    keyConcepts,
    turnCount,
    minTurns: passing.minTurns,
    // Grade cumulatively - a terse confirmation this turn must not wipe out
    // the understanding the student already demonstrated earlier.
    priorStudentAnswers: conversationHistory
      .filter((m) => m.role === 'user')
      .map((m) => m.content),
    trace,
  });

  const probePromptParams: AssessmentPromptParams = {
    teachBackPrompt: config.teachBackPrompt,
    keyConcepts,
    evaluatesConcepts,
    aiBehavior,
    liveState: priorState,
    turnCount,
    maxTurns: passing.maxTurns,
    minTurns: passing.minTurns,
  };

  const probePromise = generateEvaluatorResponse({
    systemPrompt: buildAssessmentPrompt(probePromptParams),
    conversationHistory,
    studentText,
    responseStyle: config.responseStyle,
    trace,
  });

  const [updatedState, evaluatorResponse] = await Promise.all([sensingPromise, probePromise]);

  // ─── Step 2: Check pass condition (against the SENSED state) ──────────────
  const passed = checkPassCondition(updatedState, passing, turnCount);

  if (passed) {
    // Student passed!
    const scores = extractStudentVisibleScores(updatedState, studentVisibleDimensionKeys);
    const closingPrompt = buildPassedClosingMessage({
      aiBehavior,
      studentVisibleScores: scores,
      passingDimensionKey: passing.dimensionKey,
      showScoreToLearner: config.showScoreToLearner,
    });

    const closingMessage = await generateClosingMessage({
      systemPrompt: closingPrompt,
      conversationHistory,
      studentText,
      trace,
    });

    return {
      status: 'passed',
      updatedState,
      closingMessage,
      scores,
    };
  }

  // ─── Step 3: Check max turns ──────────────────────────────────────────────
  if (turnCount >= passing.maxTurns) {
    const scores = extractStudentVisibleScores(updatedState, studentVisibleDimensionKeys);
    const closingPrompt = buildMaxTurnsClosingMessage({
      aiBehavior,
      onMaxTurnsPolicy,
      studentVisibleScores: scores,
      showScoreToLearner: config.showScoreToLearner,
    });

    const closingMessage = await generateClosingMessage({
      systemPrompt: closingPrompt,
      conversationHistory,
      studentText,
      trace,
    });

    return {
      status: 'max_turns',
      updatedState,
      closingMessage,
      scores,
    };
  }

  // ─── Step 4: Use the probe drafted in step 1 ──────────────────────────────
  return {
    status: 'continue',
    updatedState,
    evaluatorResponse,
  };
}

/**
 * Creates an empty initial state for a new assessment session.
 * All dimensions start at their calibration baseline (zero for zero_start).
 */
export function createEmptySessionState(dimensions: TrackedDimension[]): DimensionStateMap {
  return createInitialSessionState(dimensions);
}

/**
 * Builds the opening message for starting an assessment session.
 * This is the teach_back prompt formatted for the student.
 */
export async function generateOpeningMessage(params: {
  teachBackPrompt: string;
  aiBehavior: AssessmentConfig['aiBehavior'];
  /** Trace-only identifiers for ai_invocations. */
  trace?: AssessmentTraceContext;
}): Promise<string> {
  const { teachBackPrompt, aiBehavior } = params;

  const languageInstruction = aiBehavior.languageInstruction || 'Respond in the same language as the student.';
  const toneInstruction = aiBehavior.tone || 'Warm and encouraging';

  const systemPrompt = `You are starting an assessment session. Your role is to ask the student to explain a concept.

Language: ${languageInstruction}
Tone: ${toneInstruction}

Present this question warmly and clearly. Do not explain anything yet - just ask the question.
The student needs to demonstrate their understanding, so the question must be open-ended.

THE QUESTION TO ASK:
${teachBackPrompt}

Write a brief, warm introduction (1-2 sentences) then present the question. Do not add any hints or help.`;

  const chat = createOpenRouterChat({
    model: EVALUATOR_MODEL,
    temperature: 0.7,
    maxTokens: 200,
  });

  try {
    const response = await invokeTraced({
      operation: 'assessment_turn',
      model: EVALUATOR_MODEL,
      promptVersion: { evaluator: ASSESSMENT_EVALUATOR_PROMPT_VERSION },
      systemPrompt,
      socioId: params.trace?.socioId,
      organizationId: params.trace?.organizationId,
      assessmentSessionId: params.trace?.assessmentSessionId,
      mode: 'opening',
      invoke: () => Promise.race([
        chat.invoke([new SystemMessage(systemPrompt)]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Opening message timeout')), EVALUATOR_TIMEOUT_MS)
        ),
      ]),
    });

    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  } catch (error) {
    console.error('[AssessmentTurn] Opening message failed:', error);
    // Fallback: just return the prompt directly
    return teachBackPrompt;
  }
}
