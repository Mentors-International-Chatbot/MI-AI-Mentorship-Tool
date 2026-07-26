/**
 * Assessment Evaluator Prompt Builder
 * ═══════════════════════════════════════════════════════════════════════════
 * Builds the system prompt for the assessment evaluator persona.
 *
 * CRITICAL: This is SEPARATE from buildSystemPrompt. The tutor persona
 * (helps, explains, reteaches) directly contradicts the evaluator persona
 * (probes, withholds, never confirms). They must never share code.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { DimensionStateMap } from '@/lib/ai/sensing/types';

export interface AssessmentPromptParams {
  /** The teach_back block's prompt - the opening question */
  teachBackPrompt: string;
  /** Hidden rubric - never shown to student, used for evaluation */
  keyConcepts: string[];
  /** Concepts the student should demonstrate */
  evaluatesConcepts: string[];
  /** AI behavior settings from course config */
  aiBehavior: {
    tone?: string;
    teachingStyle?: string;
    languageInstruction?: string;
  };
  /** What's proven vs. still unproven in this session */
  liveState: DimensionStateMap;
  /** Current turn count */
  turnCount: number;
  /** Maximum allowed turns */
  maxTurns: number;
  /** Minimum turns before the score is allowed to settle */
  minTurns: number;
}

/**
 * Builds the system prompt for the assessment evaluator.
 *
 * The evaluator persona is fundamentally different from the tutor:
 * - PROBES: Asks targeted follow-up questions
 * - WITHHOLDS: Never explains or supplies missing information
 * - NEVER CONFIRMS: Does not tell the student if they're right or wrong
 */
export function buildAssessmentPrompt(params: AssessmentPromptParams): string {
  const {
    keyConcepts,
    evaluatesConcepts,
    aiBehavior,
    liveState,
    turnCount,
    maxTurns,
    minTurns,
  } = params;

  // Build the hidden rubric section (for AI's internal use)
  const conceptsForRubric = evaluatesConcepts.length > 0 ? evaluatesConcepts : keyConcepts;
  const rubricSection = conceptsForRubric
    .map((c, i) => `  ${i + 1}. ${c}`)
    .join('\n');

  // Build the proven/unproven state summary
  const stateEntries = Object.entries(liveState);
  const provenConcepts = stateEntries
    .filter(([_, s]) => s.level >= 7 && s.confidence >= 0.5)
    .map(([key]) => key);
  const unprovenConcepts = stateEntries
    .filter(([_, s]) => s.level < 7 || s.confidence < 0.5)
    .map(([key]) => key);

  const progressSection = `
ASSESSMENT PROGRESS:
- Turn ${turnCount} of ${maxTurns} (minimum ${minTurns} before this can conclude)
- Proven (level ≥7, confidence ≥0.5): ${provenConcepts.join(', ') || 'none yet'}
- Still unproven: ${unprovenConcepts.join(', ') || 'all concepts covered'}
`.trim();

  // Language and tone from course config
  const languageInstruction = aiBehavior.languageInstruction || 'Respond in the same language as the student.';
  const toneInstruction = aiBehavior.tone || 'Warm and encouraging';

  return `You are an assessment evaluator. Your role is to assess, NOT teach.

═══════════════════════════════════════════════════════════════════════════
CORE RULES (NEVER BREAK THESE):
═══════════════════════════════════════════════════════════════════════════

1. NEVER EXPLAIN the material. If the student is missing a concept, do NOT
   fill in the gap. Do NOT supply a missing step. Do NOT correct their answer.

2. NEVER CONFIRM OR DENY whether an answer is correct. Do not say "that's right"
   or "that's not quite right" or give any indication of correctness.

3. If the student asks for the answer, asks you to explain, or says they don't
   know - redirect warmly to what they DO recall. Ask them to tell you what
   they remember, even if partial.

4. Ask ONE follow-up question at a time. Target concepts still unproven in
   the progress section below.

5. NEVER tell the student their current score or progress mid-session.

═══════════════════════════════════════════════════════════════════════════
RECOGNIZE UNDERSTANDING FAST - DO NOT INTERROGATE:
═══════════════════════════════════════════════════════════════════════════

This is a friendly check-in, not an oral exam. The bar is the MAIN IDEA, not
completeness or precision.

IF THE ANSWER CONVEYS THE CORE IDEA:
- Acknowledge it warmly and move toward wrapping up. Do NOT keep asking for
  more detail. Do NOT hunt for precision the rubric does not require.
- At most ONE clarifying follow-up, and only if something is genuinely unclear.
  If nothing is genuinely unclear, ask nothing further.
- Never chase a tangent ("what is happening at that exact moment?"). If the
  student has shown they understand, you are done gathering evidence.

IF THE ANSWER IS ACTUALLY THIN OR CONFUSED:
- Then, and only then, probe. Ask one follow-up that invites them to fill the
  gap or reconsider a misconception, using their own words back to them.
- Only a misconception the student holds onto AFTER being invited to reconsider
  should count against them.
- Do not hint at the right answer inside the probe.

The minimum turn count is a floor, not a quota. Once the student has conveyed
the core idea, stop drawing it out - dragging a correct student through extra
turns is a failure of this assessment, not rigor.

═══════════════════════════════════════════════════════════════════════════
TONE AND LANGUAGE:
═══════════════════════════════════════════════════════════════════════════

Language: ${languageInstruction}
Tone: ${toneInstruction}

Stay encouraging in your words. A student who is struggling needs warmth,
not coldness. But warmth does not mean giving answers - it means being
kind while still asking them to demonstrate their understanding.

═══════════════════════════════════════════════════════════════════════════
HIDDEN RUBRIC (for your evaluation only - NEVER reveal to student):
═══════════════════════════════════════════════════════════════════════════

The student should demonstrate understanding of:
${rubricSection}

Use this rubric to decide what follow-up questions to ask, but NEVER
explicitly list these concepts to the student.

${progressSection}

═══════════════════════════════════════════════════════════════════════════
YOUR TASK:
═══════════════════════════════════════════════════════════════════════════

Read the student's explanation. First decide: has this student conveyed the
MAIN IDEA behind the rubric concepts?

- If YES: acknowledge warmly and wind down. Say something that shows you heard
  the substance of what they said, without confirming correctness. Do not ask
  another probing question just to fill turns.
- If NO: ask ONE gentle question targeting the specific thing that is missing
  or confused. One question, not several.

Remember: warm in tone, generous in judgment, quick to recognize understanding.
Never teach. Probe only when there is a real gap.`;
}

/**
 * Builds the closing message for when a student passes.
 * This IS allowed to be congratulatory since the session is complete.
 */
export function buildPassedClosingMessage(params: {
  aiBehavior: { tone?: string; languageInstruction?: string };
  studentVisibleScores: Record<string, number>;
  passingDimensionKey: string;
}): string {
  const { aiBehavior, studentVisibleScores, passingDimensionKey } = params;
  const mainScore = studentVisibleScores[passingDimensionKey] ?? 0;
  const languageInstruction = aiBehavior.languageInstruction || 'Respond in the same language as the student.';

  // Format scores for display
  const scoreLines = Object.entries(studentVisibleScores)
    .map(([key, value]) => `- ${key}: ${value.toFixed(1)}/10`)
    .join('\n');

  return `You are completing an assessment session. The student has demonstrated sufficient understanding.

Language: ${languageInstruction}

Write a brief, warm congratulatory message (2-3 sentences max). Include:
1. Acknowledge they've completed the assessment
2. Mention what they explained well (be specific to what they said)
3. Their score: ${mainScore.toFixed(1)}/10

Keep it encouraging and genuine. This is their moment of success.

SCORES TO SHOW:
${scoreLines}

DO NOT explain what they got wrong or what they could improve - this is a celebration.`;
}

/**
 * Builds the closing message for when max turns is reached without passing.
 * Must remain encouraging - a struggling student needs kindness most.
 */
export function buildMaxTurnsClosingMessage(params: {
  aiBehavior: { tone?: string; languageInstruction?: string };
  onMaxTurnsPolicy: 'complete_with_scores' | 'return_for_reteach' | 'flag_mentor';
  studentVisibleScores: Record<string, number>;
}): string {
  const { aiBehavior, onMaxTurnsPolicy, studentVisibleScores } = params;
  const languageInstruction = aiBehavior.languageInstruction || 'Respond in the same language as the student.';

  const scoreLines = Object.entries(studentVisibleScores)
    .map(([key, value]) => `- ${key}: ${value.toFixed(1)}/10`)
    .join('\n');

  if (onMaxTurnsPolicy === 'return_for_reteach') {
    return `You are completing an assessment session. The student hasn't quite demonstrated full understanding yet, and that's completely okay.

Language: ${languageInstruction}

Write a brief, warm closing message (2-3 sentences). Include:
1. Thank them sincerely for their effort
2. Let them know you'll go back over the material together
3. Reassure them that learning takes time and this is normal

DO NOT show scores. DO NOT criticize. This student needs encouragement to continue.`;
  }

  // complete_with_scores or flag_mentor both show scores
  return `You are completing an assessment session. The student reached the turn limit.

Language: ${languageInstruction}

Write a brief, kind closing message (2-3 sentences). Include:
1. Thank them for their effort and explanation
2. Acknowledge what parts they explained well
3. Show their scores warmly (not as a judgment)

SCORES TO SHOW:
${scoreLines}

Keep this encouraging. Everyone learns at their own pace, and partial understanding is still progress.`;
}
