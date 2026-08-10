/**
 * Router query budget — the same rows, fetched once
 * ═══════════════════════════════════════════════════════════════════════════
 * Every read in `determineMode` is a network round trip over the Neon HTTP
 * adapter, and three of them used to be duplicates:
 *
 *   - `getSocioProgress` ran here AND in service.ts, which had already read it
 *     to build the sensing pass's lesson context
 *   - the current lesson's assessment sessions were fetched by
 *     `checkGatePosition` (may they progress?) and again by
 *     `hasPassedCurrentLessonGates` (have they demonstrated knowledge?)
 *
 * Those two gate questions must keep their different answers — a
 * completed-but-failed session clears progression without counting as a pass.
 * What they must not keep is separate queries. This file pins the count, since
 * a duplicate read is invisible in behaviour and only shows up as latency.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socio, SocioProgress } from '@/lib/repo/types';

vi.mock('@/lib/repo', () => ({
  repo: {
    getSocioProgress: vi.fn(),
    getMessages: vi.fn(),
    // Never spoken before: the turn measures a zero-day gap, which is what
    // these suites are about. Cases that care about the gap set it themselves.
    getLastAssistantMessageAt: vi.fn(async () => null),
    getAssessmentSessionsForSocioLesson: vi.fn(),
    getActiveFlags: vi.fn(),
    getMilestoneProgress: vi.fn(),
    updateSocio: vi.fn(),
  },
}));

vi.mock('@/lib/lessons/db-lesson-service', () => ({
  hasLessonData: vi.fn(),
  getLessonData: vi.fn(),
  getGateAtPosition: vi.fn(),
}));

vi.mock('../resolveScope', () => ({
  resolvePromptScope: vi.fn(async (collectionKey: string) => ({
    organizationId: 'org-1',
    collectionKey,
  })),
}));

vi.mock('../courseOutcome', () => ({
  resolveCourseProject: vi.fn(async () => null),
  resolveCourseMilestones: vi.fn(async () => []),
}));

import { repo } from '@/lib/repo';
import { hasLessonData, getLessonData } from '@/lib/lessons/db-lesson-service';
import { determineMode } from '../router';

const mockRepo = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const mockHasLessonData = hasLessonData as ReturnType<typeof vi.fn>;
const mockGetLessonData = getLessonData as ReturnType<typeof vi.fn>;

const socio: Socio = {
  id: 'socio-1',
  channelType: 'web',
  externalId: 'ext-1',
  language: 'en',
  status: 'ACTIVE',
  aiPaused: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Two gates, so a per-gate duplicate shows up as 4 calls instead of 2. */
const lesson = {
  lessonNumber: 2,
  lessonKey: 'lesson-02',
  titleEs: 'Pricing',
  category: 'Sales',
  keyConcepts: ['Margin'],
  selfCheckQuestions: [],
  exercise: 'Reprice one product.',
  commitment: 'Set prices from numbers.',
  messages: [
    { order: 1, type: 'escenario' as const, contentEs: 'Scenario' },
    { order: 2, type: 'explicación' as const, contentEs: 'Explanation' },
    { order: 3, type: 'explicación' as const, contentEs: 'More' },
  ],
  gates: [
    { blockId: 'gate-1', afterMessageIndex: 0, prompt: 'Explain it back', evaluatesConcepts: [], dimensionKey: 'comprehension' },
    { blockId: 'gate-2', afterMessageIndex: 1, prompt: 'And again', evaluatesConcepts: [], dimensionKey: 'comprehension' },
  ],
};

const progress: SocioProgress = {
  id: 'p-1',
  socioId: 'socio-1',
  currentLessonNumber: 2,
  currentMessageIndex: 1,
  completedLessons: [1],
  weeklyUnderstanding: 7,
  weeklyImplementation: null,
  remindersSent: 0,
  lastLessonCompletedAt: null,
  lastInteractionAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHasLessonData.mockReturnValue(true);
  mockGetLessonData.mockReturnValue(lesson);
  mockRepo.getMessages.mockResolvedValue([]);
  mockRepo.getActiveFlags.mockResolvedValue([]);
  mockRepo.getMilestoneProgress.mockResolvedValue([]);
  mockRepo.updateSocio.mockResolvedValue({});
  mockRepo.getSocioProgress.mockResolvedValue(progress);
  // A completed session with passedAt set: clears progression AND counts as a
  // pass, so both readers run their full walk over every gate.
  mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([
    { id: 's1', status: 'completed', passedAt: new Date(), configSnapshot: { blocking: true } },
  ]);
});

describe('determineMode query budget', () => {
  it('does not re-read progress the caller already fetched', async () => {
    await determineMode(socio, 'hello', 'course-a', undefined, progress);
    expect(mockRepo.getSocioProgress).not.toHaveBeenCalled();
  });

  it('still reads progress when the caller has none to give', async () => {
    await determineMode(socio, 'hello', 'course-a');
    expect(mockRepo.getSocioProgress).toHaveBeenCalledTimes(1);
  });

  it('fetches each gate\'s sessions once, not once per reader', async () => {
    await determineMode(socio, 'hello', 'course-a', undefined, progress);

    const calls = mockRepo.getAssessmentSessionsForSocioLesson.mock.calls;
    const gateKeys = calls.map((c) => `${c[1]}|${c[2]}`);

    // One call per distinct gate, however many readers asked about it.
    expect(new Set(gateKeys).size).toBe(gateKeys.length);
    expect(gateKeys.length).toBeLessThanOrEqual(lesson.gates.length);
  });

  it('still sees the pass, so sharing the fetch did not change the answer', async () => {
    const r = await determineMode(socio, 'hello', 'course-a', undefined, progress);
    // Both gates passed and no distress → coach, per stance rule (c).
    expect(r.routerResult.stance).toEqual({ stance: 'coach', reason: 'gate_passed' });
  });
});

describe('days since last contact', () => {
  /**
   * This figure was structurally zero from launch until 2026-08-09. It read
   * `getMessages(socio.id, 1)`, which on the inbound path is the learner's own
   * message — the handler persists it before generation — so the gap was always
   * "now minus now". Layer 2 asserted "Days since last contact: 0" into every
   * prompt no matter how long the learner had been gone.
   *
   * A wrong number that always looks plausible is the kind of thing nobody
   * notices, so it gets a test rather than a comment.
   */
  it('measures the gap from when the AI last spoke', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    mockRepo.getLastAssistantMessageAt.mockResolvedValue(threeDaysAgo);

    const r = await determineMode(socio, 'hello', 'course-a', undefined, progress);

    expect(r.progress.daysSinceLastInteraction).toBe(3);
  });

  it('does not read the learner\'s own just-sent message', async () => {
    // The specific bug. `getMessages` must not be the source any more.
    mockRepo.getLastAssistantMessageAt.mockResolvedValue(
      new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    );

    const r = await determineMode(socio, 'hello', 'course-a', undefined, progress);

    expect(r.progress.daysSinceLastInteraction).toBe(5);
    expect(mockRepo.getMessages).not.toHaveBeenCalled();
  });

  it('reports zero for a learner the AI has never answered', async () => {
    mockRepo.getLastAssistantMessageAt.mockResolvedValue(null);
    const r = await determineMode(socio, 'hello', 'course-a', undefined, progress);
    expect(r.progress.daysSinceLastInteraction).toBe(0);
  });

  it('never returns a negative gap from a clock skew', async () => {
    mockRepo.getLastAssistantMessageAt.mockResolvedValue(new Date(Date.now() + 60_000));
    const r = await determineMode(socio, 'hello', 'course-a', undefined, progress);
    expect(r.progress.daysSinceLastInteraction).toBe(0);
  });
});
