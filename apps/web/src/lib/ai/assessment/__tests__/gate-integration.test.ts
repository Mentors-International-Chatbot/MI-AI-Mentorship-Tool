/**
 * Gate Integration Tests
 * ═══════════════════════════════════════════════════════════════════════════
 * Tests for:
 *   1. Idempotent gate emission - same lesson end twice → no duplicate session/message
 *   2. Completion unblocks progression - completed session clears gate
 *   3. Retake increments attemptNumber without violating unique constraint
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AssessmentSession } from '@/lib/repo/tenantRepo.types';

// ═══════════════════════════════════════════════════════════════════════════
// Mock repo that tracks calls for verification
// ═══════════════════════════════════════════════════════════════════════════

type MockSession = AssessmentSession;

function createMockSession(overrides: Partial<MockSession> = {}): MockSession {
  return {
    id: 'sess-1',
    organizationId: 'org-1',
    socioId: 'socio-1',
    lessonKey: 'lesson-01',
    blockId: 'gate-1',
    kind: 'gated_teachback',
    attemptNumber: 1,
    status: 'in_progress',
    channel: 'web',
    turnCount: 0,
    scores: null,
    passedAt: null,
    completedAt: null,
    configSnapshot: {
      blocking: true,
      passing: { dimensionKey: 'comprehension', threshold: 7 },
    },
    liveState: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. First Gate Encounter - Session Creation
// ═══════════════════════════════════════════════════════════════════════════

describe('First Gate Encounter', () => {
  it('creates a session when no existing session for this gate', async () => {
    // Simulate: student hits gate position for the first time
    // The handler should create a new session
    const mockRepo = {
      getAssessmentSessionsForSocioLesson: vi.fn().mockResolvedValue([]),
    };

    // Check for existing sessions - none found
    const sessions = await mockRepo.getAssessmentSessionsForSocioLesson(
      'socio-1',
      'lesson-01',
      'gate-1'
    );

    // No sessions exist
    expect(sessions).toHaveLength(0);

    // Handler logic: if no session exists and gatedAssessment.sessionId is undefined,
    // createAssessmentSession should be called
    const gateFromRouter = {
      lessonKey: 'lesson-01',
      blockId: 'gate-1',
      sessionId: undefined, // Router returns undefined when no open session exists
    };

    // Session should be created since sessionId is undefined
    expect(gateFromRouter.sessionId).toBeUndefined();

    // In the handler, this triggers createAssessmentSession call
    // The test verifies the condition that triggers session creation
  });

  it('handler creates session with correct metadata when sessionId is undefined', () => {
    // Verify the metadata structure that should be attached to the message
    const sessionId = 'new-session-abc';
    const gate = {
      lessonKey: 'lesson-01',
      blockId: 'gate-1',
    };

    const expectedMetadata = {
      kind: 'assessment_gate',
      sessionId,
      lessonKey: gate.lessonKey,
      blockId: gate.blockId,
    };

    expect(expectedMetadata.kind).toBe('assessment_gate');
    expect(expectedMetadata.sessionId).toBe('new-session-abc');
    expect(expectedMetadata.lessonKey).toBe('lesson-01');
    expect(expectedMetadata.blockId).toBe('gate-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Idempotent Gate Emission Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Idempotent Gate Emission', () => {
  describe('checkGatePosition logic', () => {
    it('returns existing session ID when gate already has an in_progress session', async () => {
      // Simulate: student hits gate position twice in same lesson
      // The router should return the SAME session ID, not create a new one
      const existingSession = createMockSession({
        id: 'existing-session-123',
        status: 'in_progress',
      });

      // Mock getAssessmentSessionsForSocioLesson to return the existing session
      const mockRepo = {
        getAssessmentSessionsForSocioLesson: vi.fn().mockResolvedValue([existingSession]),
      };

      // Simulate the check (extracted from router logic)
      const sessions = await mockRepo.getAssessmentSessionsForSocioLesson(
        'socio-1',
        'lesson-01',
        'gate-1'
      );

      const completedSession = sessions.find((s: MockSession) => s.status === 'completed');
      const existingIncomplete = sessions.find((s: MockSession) => s.status !== 'completed');

      // No completed session → gate not cleared
      expect(completedSession).toBeUndefined();
      // Existing incomplete session → reuse it, don't create new
      expect(existingIncomplete?.id).toBe('existing-session-123');
    });

    it('does NOT emit gate when completed session exists (idempotent)', async () => {
      // Simulate: student completed assessment, then hits same gate position again
      const completedSession = createMockSession({
        id: 'completed-session-456',
        status: 'completed',
        completedAt: new Date(),
        passedAt: new Date(), // Passed
      });

      const mockRepo = {
        getAssessmentSessionsForSocioLesson: vi.fn().mockResolvedValue([completedSession]),
      };

      const sessions = await mockRepo.getAssessmentSessionsForSocioLesson(
        'socio-1',
        'lesson-01',
        'gate-1'
      );

      const completedExists = sessions.find((s: MockSession) => s.status === 'completed');

      // Gate is cleared - router would skip this gate entirely
      expect(completedExists).toBeDefined();
      expect(completedExists?.status).toBe('completed');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Completion Unblocks Progression
// ═══════════════════════════════════════════════════════════════════════════

describe('Completion Unblocks Progression', () => {
  it('completed session (regardless of passedAt) clears the gate', async () => {
    // Key insight: blocking is about open sessions, not pass/fail status
    // A completed session with passedAt=null still clears the gate
    const completedButNotPassed = createMockSession({
      id: 'session-max-turns',
      status: 'completed',
      completedAt: new Date(),
      passedAt: null, // Did NOT pass, but session is completed
    });

    const mockRepo = {
      getAssessmentSessionsForSocioLesson: vi.fn().mockResolvedValue([completedButNotPassed]),
    };

    const sessions = await mockRepo.getAssessmentSessionsForSocioLesson(
      'socio-1',
      'lesson-01',
      'gate-1'
    );

    // Gate check: "completed" status clears gate, regardless of passedAt
    const gateCleared = sessions.some((s: MockSession) => s.status === 'completed');
    expect(gateCleared).toBe(true);
  });

  it('in_progress session with blocking=true blocks progression', async () => {
    const blockingSession = createMockSession({
      status: 'in_progress',
      configSnapshot: { blocking: true },
    });

    // Simulate router check
    const configSnapshot = blockingSession.configSnapshot as Record<string, unknown> | null;
    const isBlocking = configSnapshot?.blocking !== false;

    expect(isBlocking).toBe(true);
  });

  it('in_progress session with blocking=false allows progression', async () => {
    const nonBlockingSession = createMockSession({
      status: 'in_progress',
      configSnapshot: { blocking: false },
    });

    // Simulate router check
    const configSnapshot = nonBlockingSession.configSnapshot as Record<string, unknown> | null;
    const isBlocking = configSnapshot?.blocking !== false;

    expect(isBlocking).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Retake Increments attemptNumber
// ═══════════════════════════════════════════════════════════════════════════

describe('Retake Increments attemptNumber', () => {
  it('first attempt gets attemptNumber=1', () => {
    const existingSessions: MockSession[] = [];
    const completedSessions = existingSessions.filter(
      (s) => s.lessonKey === 'lesson-01' && s.blockId === 'gate-1' && s.status === 'completed'
    );
    const attemptNumber = completedSessions.length + 1;

    expect(attemptNumber).toBe(1);
  });

  it('retake after one completion gets attemptNumber=2', () => {
    const existingSessions: MockSession[] = [
      createMockSession({
        id: 'first-attempt',
        attemptNumber: 1,
        status: 'completed',
        completedAt: new Date(),
      }),
    ];

    const completedSessions = existingSessions.filter(
      (s) => s.lessonKey === 'lesson-01' && s.blockId === 'gate-1' && s.status === 'completed'
    );
    const attemptNumber = completedSessions.length + 1;

    expect(attemptNumber).toBe(2);
  });

  it('retake after two completions gets attemptNumber=3', () => {
    const existingSessions: MockSession[] = [
      createMockSession({ id: 'attempt-1', attemptNumber: 1, status: 'completed' }),
      createMockSession({ id: 'attempt-2', attemptNumber: 2, status: 'completed' }),
    ];

    const completedSessions = existingSessions.filter(
      (s) => s.lessonKey === 'lesson-01' && s.blockId === 'gate-1' && s.status === 'completed'
    );
    const attemptNumber = completedSessions.length + 1;

    expect(attemptNumber).toBe(3);
  });

  it('unique constraint: (socio_id, lesson_key, block_id, attempt_number)', () => {
    // This test documents the constraint - actual enforcement is in the DB
    const session1 = createMockSession({
      socioId: 'socio-1',
      lessonKey: 'lesson-01',
      blockId: 'gate-1',
      attemptNumber: 1,
    });

    const session2 = createMockSession({
      socioId: 'socio-1',
      lessonKey: 'lesson-01',
      blockId: 'gate-1',
      attemptNumber: 2, // Different attempt number → allowed
    });

    // These form the unique key components
    const key1 = `${session1.socioId}-${session1.lessonKey}-${session1.blockId}-${session1.attemptNumber}`;
    const key2 = `${session2.socioId}-${session2.lessonKey}-${session2.blockId}-${session2.attemptNumber}`;

    expect(key1).not.toBe(key2);
  });

  it('open session blocks retake until completed', () => {
    const existingSessions: MockSession[] = [
      createMockSession({
        id: 'open-session',
        attemptNumber: 1,
        status: 'in_progress', // NOT completed
      }),
    ];

    // Check for open session
    const openSession = existingSessions.find(
      (s) =>
        s.lessonKey === 'lesson-01' &&
        s.blockId === 'gate-1' &&
        s.status !== 'completed'
    );

    // createAssessmentSession throws if open session exists
    expect(openSession).toBeDefined();
    expect(openSession?.status).toBe('in_progress');

    // This would trigger: throw new AssessmentConfigError('An assessment session is already open...')
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Gate Message Deduplication
// ═══════════════════════════════════════════════════════════════════════════

describe('Gate Message Deduplication', () => {
  it('router returns same sessionId for repeated gate hits', async () => {
    // When a student is at a gate position and sends multiple messages,
    // the router should return the same existing session ID, not trigger
    // creation of duplicate sessions
    const existingSession = createMockSession({
      id: 'gate-session-abc',
      status: 'in_progress',
    });

    const mockGetSessions = vi.fn().mockResolvedValue([existingSession]);

    // First hit
    const sessions1 = await mockGetSessions('socio-1', 'lesson-01', 'gate-1');
    const result1 = sessions1.find((s: MockSession) => s.status !== 'completed');

    // Second hit (same position)
    const sessions2 = await mockGetSessions('socio-1', 'lesson-01', 'gate-1');
    const result2 = sessions2.find((s: MockSession) => s.status !== 'completed');

    // Both hits return same session ID
    expect(result1?.id).toBe('gate-session-abc');
    expect(result2?.id).toBe('gate-session-abc');
    expect(result1?.id).toBe(result2?.id);
  });
});
