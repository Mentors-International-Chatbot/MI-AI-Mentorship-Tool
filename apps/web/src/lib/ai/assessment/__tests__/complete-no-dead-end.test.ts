/**
 * No-Dead-End Policy Tests
 * Tests that all combinations of onMaxTurnsWithoutPass × allowRetake
 * leave a path forward for the student.
 *
 * Critical case: return_for_reteach + allowRetake:false → must unblock
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { completeAssessment, type CompletionConfig } from '../completeAssessment';
import { createTenantContext } from '@/lib/repo/tenantContext';
import type { TenantRepo, AssessmentSession } from '@/lib/repo/tenantRepo.types';
import type { DimensionStateMap } from '@/lib/ai/sensing/types';

// Mock the socio repo for resetMessageIndex
vi.mock('@/lib/repo', () => ({
  repo: {
    resetMessageIndex: vi.fn().mockResolvedValue({
      id: 'progress-1',
      socioId: 'socio-1',
      currentLessonNumber: 1,
      currentMessageIndex: 0,
      completedLessons: [],
      weeklyUnderstanding: null,
      weeklyImplementation: null,
      lastLessonCompletedAt: null,
      remindersSent: 0,
      lastInteractionAt: null,
    }),
  },
}));

// Mock evaluateAlerts (moved to @/lib/alerts/)
vi.mock('@/lib/alerts/evaluateAlerts', () => ({
  evaluateAlerts: vi.fn().mockResolvedValue({
    alertsCreated: [],
    rulesFired: [],
  }),
}));

import { repo as socioRepo } from '@/lib/repo';

const mockResetMessageIndex = socioRepo.resetMessageIndex as ReturnType<typeof vi.fn>;

// Test fixtures
const ctx = createTenantContext('org-1');

const testFinalState: DimensionStateMap = {
  comprehension: {
    dimensionKey: 'comprehension',
    level: 5,
    confidence: 0.8,
    trend: 'flat',
    evidence: 'Some evidence',
    updatedAt: new Date(),
  },
};

const createMockTenantRepo = (): TenantRepo => ({
  updateAssessmentSession: vi.fn().mockImplementation(async (_ctx, sessionId, data) => ({
    id: sessionId,
    organizationId: 'org-1',
    socioId: 'socio-1',
    lessonKey: 'test-lesson',
    blockId: 'gate-1',
    kind: 'gated_session',
    channel: 'web',
    status: data.status || 'completed',
    attemptNumber: 1,
    turnCount: 5,
    liveState: data.liveState || null,
    scores: data.scores || null,
    passedAt: data.passedAt || null,
    completedAt: data.completedAt || new Date(),
    configSnapshot: { blocking: true },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as AssessmentSession)),
  getMetricDefinitions: vi.fn().mockResolvedValue([]),
  getMetricDefinitionByKey: vi.fn().mockResolvedValue(null),
  createObservation: vi.fn().mockResolvedValue({ id: 'obs-1' }),
  getAlertRules: vi.fn().mockResolvedValue([]),
  getAlerts: vi.fn().mockResolvedValue([]),
  createAlert: vi.fn().mockResolvedValue({ id: 'alert-1' }),
} as unknown as TenantRepo);

const baseConfig: Omit<CompletionConfig, 'onMaxTurnsPolicy' | 'allowRetake'> = {
  recordedDimensionKeys: ['comprehension'],
  passingDimensionKey: 'comprehension',
  studentVisibleDimensionKeys: ['comprehension'],
};

describe('No-Dead-End Policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('complete_with_scores policy', () => {
    it('completes normally with allowRetake=true', async () => {
      const mockRepo = createMockTenantRepo();
      const config: CompletionConfig = {
        ...baseConfig,
        onMaxTurnsPolicy: 'complete_with_scores',
        allowRetake: true,
      };

      const result = await completeAssessment({
        ctx,
        repo: mockRepo,
        sessionId: 'session-1',
        socioId: 'socio-1',
        finalState: testFinalState,
        outcome: 'max_turns',
        config,
        channel: 'web',
      });

      expect(result.reteachTriggered).toBe(false);
      expect(result.unlockedByNoDeadEnd).toBe(false);
      // Session completed without passedAt (student can retry)
      expect(mockRepo.updateAssessmentSession).toHaveBeenCalledWith(
        ctx,
        'session-1',
        expect.not.objectContaining({ passedAt: expect.any(Date) })
      );
    });

    it('completes normally with allowRetake=false', async () => {
      const mockRepo = createMockTenantRepo();
      const config: CompletionConfig = {
        ...baseConfig,
        onMaxTurnsPolicy: 'complete_with_scores',
        allowRetake: false,
      };

      const result = await completeAssessment({
        ctx,
        repo: mockRepo,
        sessionId: 'session-1',
        socioId: 'socio-1',
        finalState: testFinalState,
        outcome: 'max_turns',
        config,
        channel: 'web',
      });

      expect(result.reteachTriggered).toBe(false);
      expect(result.unlockedByNoDeadEnd).toBe(false);
      // No passedAt set - gate remains for scoring purposes
    });
  });

  describe('flag_mentor policy', () => {
    it('flags mentor with allowRetake=true', async () => {
      const mockRepo = createMockTenantRepo();
      const config: CompletionConfig = {
        ...baseConfig,
        onMaxTurnsPolicy: 'flag_mentor',
        allowRetake: true,
      };

      const result = await completeAssessment({
        ctx,
        repo: mockRepo,
        sessionId: 'session-1',
        socioId: 'socio-1',
        finalState: testFinalState,
        outcome: 'max_turns',
        config,
        channel: 'web',
      });

      expect(result.mentorFlagged).toBe(true);
      expect(result.reteachTriggered).toBe(false);
    });

    it('flags mentor with allowRetake=false', async () => {
      const mockRepo = createMockTenantRepo();
      const config: CompletionConfig = {
        ...baseConfig,
        onMaxTurnsPolicy: 'flag_mentor',
        allowRetake: false,
      };

      const result = await completeAssessment({
        ctx,
        repo: mockRepo,
        sessionId: 'session-1',
        socioId: 'socio-1',
        finalState: testFinalState,
        outcome: 'max_turns',
        config,
        channel: 'web',
      });

      expect(result.mentorFlagged).toBe(true);
      // Mentor can unblock manually
    });
  });

  describe('return_for_reteach policy', () => {
    it('resets lesson pointer with allowRetake=true', async () => {
      const mockRepo = createMockTenantRepo();
      const config: CompletionConfig = {
        ...baseConfig,
        onMaxTurnsPolicy: 'return_for_reteach',
        allowRetake: true,
      };

      const result = await completeAssessment({
        ctx,
        repo: mockRepo,
        sessionId: 'session-1',
        socioId: 'socio-1',
        finalState: testFinalState,
        outcome: 'max_turns',
        config,
        channel: 'web',
      });

      expect(result.reteachTriggered).toBe(true);
      expect(result.unlockedByNoDeadEnd).toBe(false);
      expect(mockResetMessageIndex).toHaveBeenCalledWith('socio-1');
      // No passedAt - student will retry after reteach
    });

    it('completes normally with allowRetake=false (completed status unblocks)', async () => {
      const mockRepo = createMockTenantRepo();
      const config: CompletionConfig = {
        ...baseConfig,
        onMaxTurnsPolicy: 'return_for_reteach',
        allowRetake: false,
      };

      const result = await completeAssessment({
        ctx,
        repo: mockRepo,
        sessionId: 'session-1',
        socioId: 'socio-1',
        finalState: testFinalState,
        outcome: 'max_turns',
        config,
        channel: 'web',
      });

      // No reteach triggered (can't retry anyway)
      expect(result.reteachTriggered).toBe(false);
      expect(result.unlockedByNoDeadEnd).toBe(false);
      // Should NOT reset lesson pointer
      expect(mockResetMessageIndex).not.toHaveBeenCalled();
      // passedAt should NOT be set - blocking is based on status, not passedAt
      // The router allows progression when status === 'completed'
      expect(mockRepo.updateAssessmentSession).toHaveBeenCalledWith(
        ctx,
        'session-1',
        expect.not.objectContaining({ passedAt: expect.any(Date) })
      );
    });
  });

  describe('passed outcome (baseline)', () => {
    it('sets passedAt regardless of policy', async () => {
      const mockRepo = createMockTenantRepo();
      const config: CompletionConfig = {
        ...baseConfig,
        onMaxTurnsPolicy: 'return_for_reteach',
        allowRetake: false,
      };

      const result = await completeAssessment({
        ctx,
        repo: mockRepo,
        sessionId: 'session-1',
        socioId: 'socio-1',
        finalState: testFinalState,
        outcome: 'passed',
        config,
        channel: 'web',
      });

      expect(result.reteachTriggered).toBe(false);
      expect(result.unlockedByNoDeadEnd).toBe(false);
      expect(mockRepo.updateAssessmentSession).toHaveBeenCalledWith(
        ctx,
        'session-1',
        expect.objectContaining({ passedAt: expect.any(Date) })
      );
    });
  });
});
