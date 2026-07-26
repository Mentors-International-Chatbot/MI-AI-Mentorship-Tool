/**
 * Router Progression Control Tests
 * Tests that gated assessments correctly block/allow lesson progression
 * based on session state and configSnapshot.blocking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { determineMode } from '../router';
import { InteractionMode } from '../types';
import type { Socio } from '@/lib/repo/types';
import type { AssessmentSession } from '@/lib/repo/tenantRepo.types';

// Mock the repo module
vi.mock('@/lib/repo', () => ({
  repo: {
    getSocioProgress: vi.fn(),
    getMessages: vi.fn(),
    getAssessmentSessionsForSocioLesson: vi.fn(),
  },
}));

// Mock the lesson service
vi.mock('@/lib/lessons/db-lesson-service', () => ({
  hasLessonData: vi.fn(),
  getLessonData: vi.fn(),
}));

import { repo } from '@/lib/repo';
import { hasLessonData, getLessonData } from '@/lib/lessons/db-lesson-service';

const mockRepo = repo as unknown as {
  getSocioProgress: ReturnType<typeof vi.fn>;
  getMessages: ReturnType<typeof vi.fn>;
  getAssessmentSessionsForSocioLesson: ReturnType<typeof vi.fn>;
};

const mockHasLessonData = hasLessonData as ReturnType<typeof vi.fn>;
const mockGetLessonData = getLessonData as ReturnType<typeof vi.fn>;

// Test fixtures
const testSocio: Socio = {
  id: 'socio-1',
  channelType: 'web',
  externalId: 'ext-1',
  language: 'en',
  status: 'ACTIVE',
  aiPaused: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const testLessonWithGate = {
  lessonNumber: 1,
  lessonKey: 'test-lesson',
  titleEs: 'Test Lesson',
  category: 'Test',
  keyConcepts: ['Concept 1'],
  selfCheckQuestions: [],
  exercise: '',
  commitment: '',
  messages: [
    { order: 1, type: 'escenario' as const, contentEs: 'Scenario' },
    { order: 2, type: 'explicación' as const, contentEs: 'Explanation' },
    { order: 3, type: 'ejemplo' as const, contentEs: 'Example' },
    { order: 4, type: 'pregunta' as const, contentEs: 'Question' },
  ],
  gates: [
    {
      blockId: 'gate-1',
      blockOrder: 5,
      afterMessageIndex: 3, // After all 4 messages (indices 0-3)
      prompt: 'Explain what you learned',
      evaluatesConcepts: ['Concept 1'],
      dimensionKey: 'comprehension',
    },
  ],
};

function createMockSession(overrides: Partial<AssessmentSession> = {}): AssessmentSession {
  return {
    id: 'session-1',
    organizationId: 'org-1',
    socioId: 'socio-1',
    lessonKey: 'test-lesson',
    blockId: 'gate-1',
    kind: 'gated_session',
    channel: 'web',
    status: 'in_progress',
    attemptNumber: 1,
    turnCount: 0,
    liveState: null,
    scores: null,
    passedAt: null,
    completedAt: null,
    configSnapshot: { blocking: true },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Router Progression Control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasLessonData.mockReturnValue(true);
    mockGetLessonData.mockReturnValue(testLessonWithGate);
    mockRepo.getMessages.mockResolvedValue([]);
  });

  it('blocks progression when open session has blocking=true', async () => {
    // Student is at message index 4, which is past the gate (afterMessageIndex=3)
    mockRepo.getSocioProgress.mockResolvedValue({
      id: 'progress-1',
      socioId: 'socio-1',
      currentLessonNumber: 1,
      currentMessageIndex: 4, // Past the gate
      completedLessons: [],
      weeklyUnderstanding: null,
      weeklyImplementation: null,
      lastLessonCompletedAt: null,
      remindersSent: 0,
      lastInteractionAt: null,
    });

    // Open session with blocking=true
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([
      createMockSession({
        status: 'in_progress',
        configSnapshot: { blocking: true },
      }),
    ]);

    const result = await determineMode(testSocio, 'hello', 'test-collection');

    // Should return GATED_ASSESSMENT mode, blocking progression
    expect(result.routerResult.mode).toBe(InteractionMode.GATED_ASSESSMENT);
    expect(result.routerResult.gatedAssessment).toBeDefined();
    expect(result.routerResult.gatedAssessment?.blockId).toBe('gate-1');
  });

  it('allows progression when open session has blocking=false', async () => {
    // Student is at message index 4, past the gate
    mockRepo.getSocioProgress.mockResolvedValue({
      id: 'progress-1',
      socioId: 'socio-1',
      currentLessonNumber: 1,
      currentMessageIndex: 4,
      completedLessons: [],
      weeklyUnderstanding: null,
      weeklyImplementation: null,
      lastLessonCompletedAt: null,
      remindersSent: 0,
      lastInteractionAt: null,
    });

    // Open session with blocking=false (non-blocking gate)
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([
      createMockSession({
        status: 'in_progress',
        configSnapshot: { blocking: false },
      }),
    ]);

    const result = await determineMode(testSocio, 'hello', 'test-collection');

    // Should NOT return GATED_ASSESSMENT - allows progression
    // Will fall through to FREEFORM_QUESTION since messageIndex >= messages.length
    expect(result.routerResult.mode).not.toBe(InteractionMode.GATED_ASSESSMENT);
  });

  it('allows progression when session is completed with passedAt', async () => {
    // Student is at message index 4, past the gate
    mockRepo.getSocioProgress.mockResolvedValue({
      id: 'progress-1',
      socioId: 'socio-1',
      currentLessonNumber: 1,
      currentMessageIndex: 4,
      completedLessons: [],
      weeklyUnderstanding: null,
      weeklyImplementation: null,
      lastLessonCompletedAt: null,
      remindersSent: 0,
      lastInteractionAt: null,
    });

    // Completed session with passedAt set
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([
      createMockSession({
        status: 'completed',
        passedAt: new Date(),
        completedAt: new Date(),
        configSnapshot: { blocking: true },
      }),
    ]);

    const result = await determineMode(testSocio, 'hello', 'test-collection');

    // Should NOT return GATED_ASSESSMENT - gate has been passed
    expect(result.routerResult.mode).not.toBe(InteractionMode.GATED_ASSESSMENT);
  });

  it('allows progression when session is completed WITHOUT passedAt (blocking is about open sessions)', async () => {
    // Student is at message index 4, past the gate
    mockRepo.getSocioProgress.mockResolvedValue({
      id: 'progress-1',
      socioId: 'socio-1',
      currentLessonNumber: 1,
      currentMessageIndex: 4,
      completedLessons: [],
      weeklyUnderstanding: null,
      weeklyImplementation: null,
      lastLessonCompletedAt: null,
      remindersSent: 0,
      lastInteractionAt: null,
    });

    // Completed session WITHOUT passedAt (student didn't pass but session is done)
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([
      createMockSession({
        status: 'completed',
        passedAt: null, // Did not pass
        completedAt: new Date(),
        configSnapshot: { blocking: true },
      }),
    ]);

    const result = await determineMode(testSocio, 'hello', 'test-collection');

    // Should NOT return GATED_ASSESSMENT - completed status unblocks, not passedAt
    expect(result.routerResult.mode).not.toBe(InteractionMode.GATED_ASSESSMENT);
  });
});
