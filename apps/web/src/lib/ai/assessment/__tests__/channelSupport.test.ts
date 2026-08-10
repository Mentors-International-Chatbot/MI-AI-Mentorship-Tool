/**
 * Gated assessments over a channel that cannot carry them
 * ═══════════════════════════════════════════════════════════════════════════
 * The bug: on WhatsApp the router posted the gate, created the session, and
 * then answered every subsequent message with an empty string forever, because
 * an open session keeps `checkGatePosition` returning GATED_ASSESSMENT and the
 * handler suppresses the message when reusing a session. There is no route from
 * a WhatsApp webhook into `/api/assessment/*` — those are cookie-authenticated
 * web endpoints — so the learner had no way to clear it. A dead account.
 *
 * Two readers of gate state have to agree on the fix, and this file pins both:
 * unblocking progression while leaving stance to report `not_passed` would swap
 * a dead account for a learner pinned to tutor for the entire course.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canDeliverGatedAssessment } from '../channelSupport';

vi.mock('@/lib/repo', () => ({
  repo: {
    getAssessmentSessionsForSocioLesson: vi.fn(),
    updateSocio: vi.fn(),
  },
}));

vi.mock('@/lib/lessons/db-lesson-service', () => ({
  hasLessonData: vi.fn(),
  getLessonData: vi.fn(),
}));

vi.mock('@/lib/ai/prompts/loadPrompt', () => ({
  loadActivePrompt: vi.fn(async (_c: string, fallback: string) => fallback),
}));

vi.mock('@/lib/ai/prompts/courseOutcome', () => ({
  resolveCourseProject: vi.fn(async () => null),
  resolveCourseMilestones: vi.fn(async () => []),
}));

import { repo } from '@/lib/repo';
import { hasLessonData, getLessonData } from '@/lib/lessons/db-lesson-service';
import { readGateEvidence, resolveStance } from '@/lib/ai/prompts/stance';

const mockRepo = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const mockHasLessonData = hasLessonData as ReturnType<typeof vi.fn>;
const mockGetLessonData = getLessonData as ReturnType<typeof vi.fn>;

const gatedLesson = {
  lessonNumber: 1,
  lessonKey: 'make-the-sandwich',
  titleEs: 'Make the sandwich',
  category: 'Practice',
  keyConcepts: ['Order matters'],
  selfCheckQuestions: [],
  exercise: 'Make one sandwich.',
  commitment: 'I will make one for someone else.',
  messages: [
    { order: 1, type: 'escenario' as const, contentEs: 'Scenario' },
    { order: 2, type: 'explicación' as const, contentEs: 'Explanation' },
  ],
  gates: [{ blockId: 'gate-1', afterMessageIndex: 1, prompt: 'Explain it back', evaluatesConcepts: [], dimensionKey: 'sequencing' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHasLessonData.mockReturnValue(true);
  mockGetLessonData.mockReturnValue(gatedLesson);
  mockRepo.updateSocio.mockResolvedValue({});
  mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([]);
});

describe('canDeliverGatedAssessment', () => {
  it('allows web, the only channel with an assessment UI', () => {
    expect(canDeliverGatedAssessment('web')).toBe(true);
  });

  it('refuses whatsapp, which has no route into /api/assessment/*', () => {
    expect(canDeliverGatedAssessment('whatsapp')).toBe(false);
  });

  it('answers true with no channel context, preserving non-chat callers', () => {
    // The admin prompt sandbox and gate-logic tests have no channel and must
    // keep the behaviour they had before this function existed.
    expect(canDeliverGatedAssessment(undefined)).toBe(true);
  });

  it('fails closed on a channel it was never taught about', () => {
    // An unnecessarily skipped gate is recoverable. A dead account is not.
    expect(canDeliverGatedAssessment('sms')).toBe(false);
    expect(canDeliverGatedAssessment('')).toBe(false);
  });
});

describe('stance agrees with the router about an undeliverable gate', () => {
  it('reads a whatsapp gate as absent, not as failed', async () => {
    const evidence = await readGateEvidence('socio-1', 'pbj', 1, undefined, 'whatsapp');
    expect(evidence).toBe('no_gates');
  });

  it('still reads a web gate as not passed when it is outstanding', async () => {
    const evidence = await readGateEvidence('socio-1', 'pbj', 1, undefined, 'web');
    expect(evidence).toBe('not_passed');
  });

  it('does not pin a whatsapp learner to tutor for the whole course', async () => {
    // The regression this pairs with. Skipping the gate for progression while
    // stance still reported `gate_not_passed` would leave WhatsApp learners
    // permanently tutored — the exact defect the ungated ladder removed.
    const d = await resolveStance({
      socioId: 'socio-1',
      promptOverrides: null,
      collectionKey: 'pbj',
      currentLessonNumber: 1,
      currentMessageIndex: gatedLesson.messages.length,
      weeklyUnderstanding: null,
      activeFlags: [],
      reteachThisTurn: false,
      channelType: 'whatsapp',
    });

    expect(d).toEqual({ stance: 'coach', reason: 'lesson_taught_out' });
  });

  it('leaves the web learner on the gate rule', async () => {
    const d = await resolveStance({
      socioId: 'socio-1',
      promptOverrides: null,
      collectionKey: 'pbj',
      currentLessonNumber: 1,
      currentMessageIndex: gatedLesson.messages.length,
      weeklyUnderstanding: null,
      activeFlags: [],
      reteachThisTurn: false,
      channelType: 'web',
    });

    expect(d).toEqual({ stance: 'tutor', reason: 'gate_not_passed' });
  });

  it('never queries gate sessions for a channel that cannot deliver them', async () => {
    await readGateEvidence('socio-1', 'pbj', 1, undefined, 'whatsapp');
    expect(mockRepo.getAssessmentSessionsForSocioLesson).not.toHaveBeenCalled();
  });
});
