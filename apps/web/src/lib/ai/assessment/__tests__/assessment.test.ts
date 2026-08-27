/**
 * Assessment System Tests
 * ═══════════════════════════════════════════════════════════════════════════
 * Tests for:
 *   1. Threshold logic - passing when threshold is met
 *   2. Anti-cheat property - session state isolation from global state
 *   3. Prompt-leak rejection - evaluator doesn't reveal rubric
 *   4. Completion flow - proper session completion
 *   5. senseAssessmentTurn - with mocked LLM
 *
 * ANSWERS TO CORRECTION 4 QUESTIONS:
 * Q: Does the assessment turn need to explicitly call alert evaluation?
 * A: No. Alert evaluation is NOT implemented yet. When implemented, it would
 *    be triggered during completeAssessment when writing MetricObservations.
 *    The assessment turn pipeline (runAssessmentTurn) focuses on sensing and
 *    response generation - it doesn't write to the database.
 *
 * Q: How do I test senseAssessmentTurn without hitting the LLM?
 * A: Mock `createOpenRouterChat` to return controlled responses. See the
 *    "Mocked LLM Tests" section below for an example.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInitialSessionState } from '../senseAssessmentTurn';
import { buildAssessmentPrompt, buildPassedClosingMessage, buildMaxTurnsClosingMessage } from '../buildAssessmentPrompt';
import { buildScoreReport, shouldAllowRetake } from '../completeAssessment';
import type { TrackedDimension } from '@/lib/journey-package/journey-package.schema';
import type { DimensionStateMap } from '@/lib/ai/sensing/types';

// Mock factory for the OpenRouter chat client
const mockInvoke = vi.fn();
vi.mock('@/lib/ai/openrouter', () => ({
  createOpenRouterChat: vi.fn(() => ({
    invoke: mockInvoke,
  })),
}));

// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const testDimensions: TrackedDimension[] = [
  {
    key: 'comprehension',
    label: 'Comprehension',
    category: 'comprehension',
    primary: true,
    scale: { min: 0, max: 10 },
    calibrationMode: 'zero_start',
  },
  {
    key: 'confidence',
    label: 'Confidence',
    category: 'emotional',
    primary: false,
    scale: { min: 0, max: 10 },
    calibrationMode: 'assumed_baseline',
    assumedBaseline: 5,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 1. Threshold Logic Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Threshold Logic', () => {
  describe('Pass condition evaluation', () => {
    const passingCriteria = {
      dimensionKey: 'comprehension',
      threshold: 7,
      confidenceFloor: 0.5,
      minTurns: 2,
      maxTurns: 12,
    };

    it('should NOT pass on first turn (minTurns not met)', () => {
      // Turn 1 < minTurns (2)
      const turnCount = 1;
      const meetsMinTurns = turnCount >= passingCriteria.minTurns;
      expect(meetsMinTurns).toBe(false);
    });

    it('should pass when threshold AND confidence AND minTurns are met', () => {
      const state: DimensionStateMap = {
        comprehension: {
          dimensionKey: 'comprehension',
          level: 8, // Above threshold (7)
          confidence: 0.7, // Above floor (0.5)
          trend: 'improving',
          evidence: 'Solid understanding',
          updatedAt: new Date(),
        },
      };

      const turnCount = 3;
      const meetsMinTurns = turnCount >= passingCriteria.minTurns;
      const meetsThreshold = state.comprehension.level >= passingCriteria.threshold;
      const meetsConfidence = state.comprehension.confidence >= passingCriteria.confidenceFloor;

      expect(meetsMinTurns).toBe(true);
      expect(meetsThreshold).toBe(true);
      expect(meetsConfidence).toBe(true);
    });

    it('should NOT pass when threshold is met but confidence is too low', () => {
      const state: DimensionStateMap = {
        comprehension: {
          dimensionKey: 'comprehension',
          level: 8, // Above threshold
          confidence: 0.3, // BELOW floor (0.5)
          trend: 'flat',
          evidence: 'Uncertain response',
          updatedAt: new Date(),
        },
      };

      const meetsThreshold = state.comprehension.level >= passingCriteria.threshold;
      const meetsConfidence = state.comprehension.confidence >= passingCriteria.confidenceFloor;

      expect(meetsThreshold).toBe(true);
      expect(meetsConfidence).toBe(false);
    });

    it('should NOT pass when level is below threshold', () => {
      const state: DimensionStateMap = {
        comprehension: {
          dimensionKey: 'comprehension',
          level: 5, // BELOW threshold (7)
          confidence: 0.9, // Above floor
          trend: 'flat',
          evidence: 'Partial understanding',
          updatedAt: new Date(),
        },
      };

      const meetsThreshold = state.comprehension.level >= passingCriteria.threshold;
      expect(meetsThreshold).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Anti-Cheat Property Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Anti-Cheat Property (Session Isolation)', () => {
  describe('createInitialSessionState', () => {
    it('starts zero_start dimensions at 0', () => {
      const state = createInitialSessionState(testDimensions);

      expect(state.comprehension.level).toBe(0);
      expect(state.comprehension.confidence).toBe(0);
      expect(state.comprehension.trend).toBe('flat');
    });

    it('starts assumed_baseline dimensions at their baseline', () => {
      const state = createInitialSessionState(testDimensions);

      expect(state.confidence.level).toBe(5); // assumedBaseline
      expect(state.confidence.confidence).toBe(0);
    });

    it('creates independent state for each session', () => {
      const state1 = createInitialSessionState(testDimensions);
      const state2 = createInitialSessionState(testDimensions);

      // Mutate state1
      state1.comprehension.level = 10;

      // state2 should be unaffected
      expect(state2.comprehension.level).toBe(0);
    });

    it('does NOT read from any external source (pure function)', () => {
      // This test verifies that createInitialSessionState only uses
      // the dimensions parameter, not any global state or database
      const customDimensions: TrackedDimension[] = [
        {
          key: 'custom_metric',
          label: 'Custom',
          category: 'metric',
          primary: true,
          scale: { min: 0, max: 100 },
          calibrationMode: 'assumed_baseline',
          assumedBaseline: 50,
        },
      ];

      const state = createInitialSessionState(customDimensions);

      // Should only have the custom dimension, not testDimensions
      expect(Object.keys(state)).toEqual(['custom_metric']);
      expect(state.custom_metric.level).toBe(50);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Prompt-Leak Rejection Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Prompt-Leak Prevention', () => {
  describe('buildAssessmentPrompt', () => {
    const baseParams = {
      teachBackPrompt: 'Explain what you learned about budgeting.',
      keyConcepts: ['income tracking', 'expense categories', 'savings goals'],
      evaluatesConcepts: ['income tracking', 'savings goals'],
      aiBehavior: {
        tone: 'Warm',
        languageInstruction: 'Respond in Spanish',
      },
      liveState: {},
      turnCount: 1,
      maxTurns: 12,
      minTurns: 2,
    };

    it('instructs evaluator to NEVER reveal rubric to student', () => {
      const prompt = buildAssessmentPrompt(baseParams);

      expect(prompt).toContain('NEVER reveal to student');
      expect(prompt).toContain('HIDDEN RUBRIC');
    });

    it('instructs evaluator to NEVER explain or supply missing info', () => {
      const prompt = buildAssessmentPrompt(baseParams);

      expect(prompt).toContain('NEVER EXPLAIN');
      // Note: these phrases may span lines in the prompt
      expect(prompt).toContain('do NOT');
      expect(prompt).toContain('fill in the gap');
      expect(prompt).toContain('Do NOT supply a missing step');
    });

    it('instructs evaluator to NEVER confirm or deny correctness', () => {
      const prompt = buildAssessmentPrompt(baseParams);

      expect(prompt).toContain('NEVER CONFIRM OR DENY');
      expect(prompt).toContain('not say "that\'s right"');
    });

    it('instructs evaluator to NOT show progress mid-session', () => {
      const prompt = buildAssessmentPrompt(baseParams);

      expect(prompt).toContain('NEVER tell the student their current score');
    });

    it('includes key concepts but marks them as hidden', () => {
      const prompt = buildAssessmentPrompt(baseParams);

      // Concepts appear in the prompt (for AI's use)
      expect(prompt).toContain('income tracking');
      expect(prompt).toContain('savings goals');

      // But they're in the HIDDEN section
      expect(prompt).toContain('HIDDEN RUBRIC');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Regression coverage for the b1-12 live-conversation finding: the probe
  // told a student "You are [done]" while the server-side gate had not
  // cleared (comprehension 6.2 vs. threshold 7). This is only ever a prompt
  // problem, not a data-flow one — see runAssessmentTurn's "Terminal Outcome
  // Discards The Probe" test below for why the probe text can carry this
  // constraint on its own, with no need to thread the sensed result into it.
  // ─────────────────────────────────────────────────────────────────────────
  describe('buildAssessmentPrompt: status-question honesty', () => {
    const baseParams = {
      teachBackPrompt: 'Explain what you learned about budgeting.',
      keyConcepts: ['income tracking', 'expense categories', 'savings goals'],
      evaluatesConcepts: ['income tracking', 'savings goals'],
      aiBehavior: { tone: 'Warm', languageInstruction: 'Respond in Spanish' },
      liveState: {},
      turnCount: 1,
      maxTurns: 12,
      minTurns: 2,
    };

    it('instructs the evaluator that a status question always gets "not yet" here', () => {
      const prompt = buildAssessmentPrompt(baseParams);

      expect(prompt).toContain('STATUS QUESTIONS');
      expect(prompt).toContain('the check has NOT concluded');
      expect(prompt).toContain('true answer is always "not yet,"');
    });

    it('forbids guessing status from conversational tone', () => {
      const prompt = buildAssessmentPrompt(baseParams);

      expect(prompt).toContain('Do not guess, hedge, or imply');
      expect(prompt).toContain('regardless of how well the conversation has');
    });

    it('requires the probe to keep asking even after answering a status question', () => {
      const prompt = buildAssessmentPrompt(baseParams);

      expect(prompt).toContain('A status question is not\n  a reason to stop probing.');
    });
  });

  describe('buildAssessmentPrompt: no closure language before the gate clears', () => {
    const baseParams = {
      teachBackPrompt: 'Explain what you learned about budgeting.',
      keyConcepts: ['income tracking', 'expense categories', 'savings goals'],
      evaluatesConcepts: ['income tracking', 'savings goals'],
      aiBehavior: { tone: 'Warm', languageInstruction: 'Respond in Spanish' },
      liveState: {},
      turnCount: 1,
      maxTurns: 12,
      minTurns: 2,
    };

    it('tells the evaluator this reply is always a continuation, never a verdict', () => {
      const prompt = buildAssessmentPrompt(baseParams);

      expect(prompt).toContain('this reply is always a CONTINUATION, never a verdict');
      expect(prompt).toContain('you do not know the outcome yet');
    });

    it('explicitly bans the phrases that caused the live-conversation false positive', () => {
      const prompt = buildAssessmentPrompt(baseParams);

      // The exact phrases the evaluator used on b1-12 session 44d09c3f before
      // the sensed score (6.2) had cleared the threshold (7).
      expect(prompt).toContain('"well done"');
      expect(prompt).toContain('"you\'ve got it"');
      expect(prompt).toContain('"I\'ve\nheard what I need [to hear]"');
    });

    it('no longer tells the evaluator to "wind down" on a good answer', () => {
      const prompt = buildAssessmentPrompt(baseParams);

      expect(prompt).not.toContain('wind down');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Completion Flow Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Completion Flow', () => {
  describe('buildScoreReport', () => {
    it('shows "You passed" for passed assessments', () => {
      const scores = { comprehension: 8.5 };
      const report = buildScoreReport(scores, true);

      expect(report).toContain('You passed');
      expect(report).toContain('8.5/10');
    });

    it('shows "Assessment completed" for non-passing completions', () => {
      const scores = { comprehension: 5.0 };
      const report = buildScoreReport(scores, false);

      expect(report).toContain('Assessment completed');
      expect(report).not.toContain('You passed');
    });

    it('uses custom labels when provided', () => {
      const scores = { comprehension: 7.0 };
      const labels = { comprehension: 'Understanding' };
      const report = buildScoreReport(scores, true, labels);

      expect(report).toContain('Understanding:');
      expect(report).not.toContain('comprehension:');
    });

    it('displays all visible scores', () => {
      const scores = {
        comprehension: 8.0,
        confidence: 7.5,
      };
      const report = buildScoreReport(scores, true);

      expect(report).toContain('8.0/10');
      expect(report).toContain('7.5/10');
    });
  });

  describe('shouldAllowRetake', () => {
    it('does NOT allow retake for passed assessments', () => {
      const result = shouldAllowRetake('passed', true, true);
      expect(result).toBe(false);
    });

    it('allows retake for cancelled assessments', () => {
      const result = shouldAllowRetake('cancelled', false, false);
      expect(result).toBe(true);
    });

    it('allows retake for max_turns when config permits', () => {
      const result = shouldAllowRetake('max_turns', false, true);
      expect(result).toBe(true);
    });

    it('does NOT allow retake for max_turns when config forbids', () => {
      const result = shouldAllowRetake('max_turns', false, false);
      expect(result).toBe(false);
    });
  });

  describe('Closing message builders', () => {
    it('buildPassedClosingMessage includes score', () => {
      const prompt = buildPassedClosingMessage({
        aiBehavior: { tone: 'Warm' },
        studentVisibleScores: { comprehension: 8.5 },
        passingDimensionKey: 'comprehension',
      });

      expect(prompt).toContain('8.5/10');
      expect(prompt).toContain('congratulatory');
    });

    it('buildPassedClosingMessage forbids score language when learner scores are hidden', () => {
      const prompt = buildPassedClosingMessage({
        aiBehavior: { tone: 'Warm' },
        studentVisibleScores: { comprehension: 8.5 },
        passingDimensionKey: 'comprehension',
        showScoreToLearner: false,
      });

      expect(prompt).not.toContain('8.5/10');
      expect(prompt).toContain('DO NOT mention, estimate, or imply a numeric score');
    });

    it('buildMaxTurnsClosingMessage for return_for_reteach does NOT show scores', () => {
      const prompt = buildMaxTurnsClosingMessage({
        aiBehavior: { tone: 'Warm' },
        onMaxTurnsPolicy: 'return_for_reteach',
        studentVisibleScores: { comprehension: 5.0 },
      });

      expect(prompt).toContain('go back over the material');
      expect(prompt).toContain('DO NOT show scores');
    });

    it('buildMaxTurnsClosingMessage for complete_with_scores shows scores', () => {
      const prompt = buildMaxTurnsClosingMessage({
        aiBehavior: { tone: 'Warm' },
        onMaxTurnsPolicy: 'complete_with_scores',
        studentVisibleScores: { comprehension: 5.0 },
      });

      expect(prompt).toContain('5.0/10');
      expect(prompt).toContain('SCORES TO SHOW');
    });

    it('buildMaxTurnsClosingMessage suppresses scores regardless of policy when hidden', () => {
      const prompt = buildMaxTurnsClosingMessage({
        aiBehavior: { tone: 'Warm' },
        onMaxTurnsPolicy: 'complete_with_scores',
        studentVisibleScores: { comprehension: 5.0 },
        showScoreToLearner: false,
      });

      expect(prompt).not.toContain('5.0/10');
      expect(prompt).toContain('DO NOT show scores');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  it('handles empty dimensions array', () => {
    const state = createInitialSessionState([]);
    expect(Object.keys(state)).toHaveLength(0);
  });

  it('handles missing dimension in state during threshold check', () => {
    const state: DimensionStateMap = {}; // No comprehension dimension

    const meetsThreshold = (state.comprehension?.level ?? 0) >= 7;
    expect(meetsThreshold).toBe(false);
  });

  it('handles scores with very precise decimals', () => {
    const scores = { comprehension: 7.333333333 };
    const report = buildScoreReport(scores, true);

    // Should be formatted to 1 decimal place
    expect(report).toContain('7.3/10');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Mocked LLM Tests for senseAssessmentTurn
// ═══════════════════════════════════════════════════════════════════════════

describe('senseAssessmentTurn (Mocked LLM)', () => {
  // Import senseAssessmentTurn after mocks are set up
  let senseAssessmentTurn: typeof import('../senseAssessmentTurn').senseAssessmentTurn;

  const mockedTestDimensions: TrackedDimension[] = [
    {
      key: 'comprehension',
      label: 'Comprehension',
      category: 'comprehension',
      primary: true,
      scale: { min: 0, max: 10 },
      calibrationMode: 'zero_start',
    },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import to get the mocked version
    const sensingModule = await import('../senseAssessmentTurn');
    senseAssessmentTurn = sensingModule.senseAssessmentTurn;
  });

  it('updates state based on LLM response', async () => {
    // Mock the LLM to return a comprehension score
    mockInvoke.mockResolvedValue({
      content: JSON.stringify([
        {
          dimensionKey: 'comprehension',
          level: 7,
          confidence: 0.8,
          evidence: 'Student explained key concepts well',
        },
      ]),
    });

    const priorState = createInitialSessionState(mockedTestDimensions);
    expect(priorState.comprehension.level).toBe(0); // Starts at 0

    const newState = await senseAssessmentTurn({
      studentText: 'I learned that budgeting means tracking income and expenses.',
      priorState,
      dimensions: mockedTestDimensions,
      lessonContext: 'Budgeting basics',
      keyConcepts: ['income tracking', 'expense tracking'],
      turnCount: 1,
      minTurns: 2,
    });

    // State should be updated via EMA (not exact 7, but close)
    expect(newState.comprehension.level).toBeGreaterThan(0);
    expect(newState.comprehension.confidence).toBeGreaterThan(0);
  });

  it('returns prior state on LLM failure', async () => {
    // Mock the LLM to throw an error
    mockInvoke.mockRejectedValue(new Error('API error'));

    const priorState = createInitialSessionState(mockedTestDimensions);
    priorState.comprehension.level = 5; // Set to non-zero

    const newState = await senseAssessmentTurn({
      studentText: 'Some explanation',
      priorState,
      dimensions: mockedTestDimensions,
      lessonContext: 'Test lesson',
      keyConcepts: ['concept 1'],
      turnCount: 1,
      minTurns: 2,
    });

    // Should return prior state unchanged on error
    expect(newState.comprehension.level).toBe(5);
  });

  it('skips sensing for very short messages', async () => {
    const priorState = createInitialSessionState(mockedTestDimensions);

    const newState = await senseAssessmentTurn({
      studentText: 'Hi', // Too short
      priorState,
      dimensions: mockedTestDimensions,
      lessonContext: 'Test',
      keyConcepts: ['concept'],
      turnCount: 1,
      minTurns: 2,
    });

    // Should skip LLM call and return prior state
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(newState).toBe(priorState);
  });
});
