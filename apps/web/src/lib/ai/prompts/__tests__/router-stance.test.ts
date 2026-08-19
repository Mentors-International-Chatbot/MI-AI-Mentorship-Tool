/**
 * Router × stance — the two axes are independent
 * ═══════════════════════════════════════════════════════════════════════════
 * Also pins ROUTABLE_MODES. Three of the nine InteractionMode values are never
 * returned by `determineMode`, yet each has a Layer 3 builder and an editable
 * /admin/prompts category, so from outside they read as live. That is the same
 * shape as an empty metric_definitions table or an unfed alert_rules: the
 * mechanism looks finished because the missing half is invisible.
 *
 * Pinning the real set means a future router change that starts returning one
 * of them has to say so here, and a reader who wonders whether CHECKIN is
 * reachable gets an answer from a test rather than from a grep.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socio, SocioFlag } from '@/lib/repo/types';

vi.mock('@/lib/repo', () => ({
  repo: {
    getSocioProgress: vi.fn(),
    getMessages: vi.fn(),
    // Never spoken before: the turn measures a zero-day gap, which is what
    // these suites are about. Cases that care about the gap set it themselves.
    getLastAssistantMessageAt: vi.fn(async () => null),
    getAssessmentSessionsForSocioLesson: vi.fn(),
    getActiveFlags: vi.fn(),
    updateSocio: vi.fn(),
  },
}));

vi.mock('@/lib/lessons/db-lesson-service', () => ({
  hasLessonData: vi.fn(),
  getLessonData: vi.fn(),
  getGateAtPosition: vi.fn(),
}));

// The stance ladder can reach for course milestones, which walks scope → the
// program version. Both are stubbed so this suite never opens a DB connection.
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
import { determineMode, type ChatDelivery } from '../router';
import { InteractionMode, ROUTABLE_MODES } from '../types';

const CHAT_DELIVERY: ChatDelivery = { surface: 'chat', supportedChannels: ['web', 'whatsapp'] };

const mockRepo = repo as unknown as {
  getSocioProgress: ReturnType<typeof vi.fn>;
  getMessages: ReturnType<typeof vi.fn>;
  getAssessmentSessionsForSocioLesson: ReturnType<typeof vi.fn>;
  getActiveFlags: ReturnType<typeof vi.fn>;
  updateSocio: ReturnType<typeof vi.fn>;
};
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

const lesson = {
  lessonNumber: 2,
  lessonKey: 'lesson-02',
  titleEs: 'Pricing',
  category: 'Sales',
  keyConcepts: ['Margin'],
  selfCheckQuestions: [],
  exercise: 'Reprice one product.',
  commitment: 'I will set prices from numbers, not guesswork.',
  messages: [
    { order: 1, type: 'escenario' as const, contentEs: 'Scenario' },
    { order: 2, type: 'explicación' as const, contentEs: 'Explanation' },
  ],
  gates: [
    { blockId: 'gate-1', afterMessageIndex: 5, prompt: 'Explain it back', evaluatesConcepts: [], dimensionKey: 'comprehension' },
  ],
};

function redFlag(): SocioFlag {
  return {
    id: 'f1', socioId: 'socio-1', level: 'RED', reason: 'urgency=9 threshold=8',
    source: 'sentiment_auto', resolved: false, resolvedBy: null, resolvedAt: null,
    messageId: null, createdAt: new Date(), reasonCode: 'sentiment.urgency_high',
    reasonParams: null, status: 'OPEN', disposition: null, snoozedUntil: null,
    occurrenceCount: 1, lastOccurredAt: null,
  } as SocioFlag;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasLessonData.mockReturnValue(true);
  mockGetLessonData.mockReturnValue(lesson);
  mockRepo.getMessages.mockResolvedValue([]);
  mockRepo.getActiveFlags.mockResolvedValue([]);
  mockRepo.updateSocio.mockResolvedValue({});
  mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([]);
  mockRepo.getSocioProgress.mockResolvedValue({
    currentLessonNumber: 2,
    currentMessageIndex: 0,
    completedLessons: [1],
    weeklyUnderstanding: 7,
    weeklyImplementation: null,
    remindersSent: 0,
  });
});

describe('ROUTABLE_MODES', () => {
  it('excludes the three modes the router cannot return', () => {
    expect(ROUTABLE_MODES.has(InteractionMode.CHECKIN)).toBe(false);
    expect(ROUTABLE_MODES.has(InteractionMode.MENTOR_HANDOFF)).toBe(false);
    expect(ROUTABLE_MODES.has(InteractionMode.POST_MENTOR)).toBe(false);
  });

  it('covers every mode the router does return, across its branches', async () => {
    const seen = new Set<InteractionMode>();

    // Priority 2: ready for a new lesson.
    seen.add((await determineMode(CHAT_DELIVERY, socio, 'hello', 'mi')).routerResult.mode);

    // Explicit "next".
    seen.add((await determineMode(CHAT_DELIVERY, socio, 'siguiente', 'mi')).routerResult.mode);

    // Priority 1: mid-lesson delivery.
    mockRepo.getSocioProgress.mockResolvedValue({
      currentLessonNumber: 2, currentMessageIndex: 1, completedLessons: [1],
      weeklyUnderstanding: 7, weeklyImplementation: null, remindersSent: 0,
    });
    seen.add((await determineMode(CHAT_DELIVERY, socio, 'ok', 'mi')).routerResult.mode);

    // Reteach: last message + an explicit low score.
    seen.add((await determineMode(CHAT_DELIVERY, socio, '2', 'mi')).routerResult.mode);

    // Freeform: no lesson data available.
    mockHasLessonData.mockReturnValue(false);
    seen.add((await determineMode(CHAT_DELIVERY, socio, 'what is gross margin', 'mi')).routerResult.mode);

    expect(seen.size).toBeGreaterThan(3);
    for (const mode of seen) {
      expect(ROUTABLE_MODES.has(mode), `${mode} was returned but is not in ROUTABLE_MODES`).toBe(true);
    }
  });
});

describe('stance rides alongside mode', () => {
  it('attaches a stance to a normal turn', async () => {
    const r = await determineMode(CHAT_DELIVERY, socio, 'hello', 'mi');
    expect(r.routerResult.stance).toEqual({ stance: 'tutor', reason: 'gate_not_passed' });
  });

  it('flips stance without changing mode — the axes are orthogonal', async () => {
    // Same message, same turn type. Only the distress signal differs. This is
    // the whole premise: two learners on identical turns need different jobs
    // done, and mode alone cannot express that.
    mockHasLessonData.mockReturnValue(false);

    const calm = await determineMode(CHAT_DELIVERY, socio, 'I raised prices and customers complained', 'mi');

    mockRepo.getActiveFlags.mockResolvedValue([redFlag()]);
    const distressed = await determineMode(CHAT_DELIVERY, socio, 'I raised prices and customers complained', 'mi');

    expect(calm.routerResult.mode).toBe(distressed.routerResult.mode);
    expect(calm.routerResult.mode).toBe(InteractionMode.FREEFORM_QUESTION);
    expect(calm.routerResult.stance?.stance).toBe('tutor');
    expect(distressed.routerResult.stance?.stance).toBe('coach');
    expect(distressed.routerResult.stance?.reason).toBe('distress');
  });

  it('hands the flags it read on to the caller, so Layer 2 does not refetch', async () => {
    mockRepo.getActiveFlags.mockResolvedValue([redFlag()]);
    const r = await determineMode(CHAT_DELIVERY, socio, 'hello', 'mi');

    expect(r.activeFlags).toHaveLength(1);
    expect(mockRepo.getActiveFlags).toHaveBeenCalledTimes(1);
  });

  it('still answers when the flag read throws', async () => {
    // Failing the turn because a flag query failed would be worse than losing
    // the distress signal for one turn.
    mockRepo.getActiveFlags.mockRejectedValue(new Error('db down'));
    const r = await determineMode(CHAT_DELIVERY, socio, 'hello', 'mi');

    expect(r.routerResult.mode).toBe(InteractionMode.LESSON_START);
    expect(r.routerResult.stance?.stance).toBe('tutor');
  });

  it('lets an UNGATED course reach coach, end to end', async () => {
    // The headline fix. A curriculum imported without teach-back gates — the
    // legacy MI collection among them — used to be pinned to tutor for the
    // whole course, so the coach half of the system never ran for its learners.
    // Asserted through `determineMode` rather than `resolveStance` because the
    // unit-level rule was never the thing that was broken; the wiring was.
    mockGetLessonData.mockReturnValue({
      ...lesson,
      gates: [],
      messages: [
        { order: 1, type: 'escenario' as const, contentEs: 'Scenario' },
        { order: 2, type: 'explicación' as const, contentEs: 'Explanation' },
      ],
    });
    mockRepo.getSocioProgress.mockResolvedValue({
      currentLessonNumber: 2,
      currentMessageIndex: 2, // every teaching message delivered
      completedLessons: [1],
      weeklyUnderstanding: 7,
      weeklyImplementation: null,
      remindersSent: 0,
    });

    const r = await determineMode(CHAT_DELIVERY, socio, 'I tried it and got stuck on the pricing part', 'mi');

    expect(r.routerResult.mode).toBe(InteractionMode.FREEFORM_QUESTION);
    expect(r.routerResult.stance).toEqual({ stance: 'coach', reason: 'lesson_taught_out' });
    expect(mockRepo.getAssessmentSessionsForSocioLesson).not.toHaveBeenCalled();
  });

  it('does not lock a WhatsApp learner on a gate that channel cannot deliver', async () => {
    // The live bug: on WhatsApp the router returned GATED_ASSESSMENT, the
    // handler suppressed the message because a session was already open, and
    // every subsequent turn answered with an empty string. Forever, with no
    // route into /api/assessment/* to clear it.
    mockGetLessonData.mockReturnValue({
      ...lesson,
      gates: [{ ...lesson.gates[0], afterMessageIndex: 0 }],
    });
    mockRepo.getSocioProgress.mockResolvedValue({
      currentLessonNumber: 2, currentMessageIndex: 1, completedLessons: [1],
      weeklyUnderstanding: 7, weeklyImplementation: null, remindersSent: 0,
    });

    const whatsappSocio = { ...socio, channelType: 'whatsapp' };
    const r = await determineMode(CHAT_DELIVERY, whatsappSocio, 'ok', 'mi');

    expect(r.routerResult.mode).not.toBe(InteractionMode.GATED_ASSESSMENT);
    // And it still gets a stance, which the gated path would have skipped.
    expect(r.routerResult.stance?.stance).toBeDefined();
  });

  it('still gates the same position on web', async () => {
    // The guard is about the channel, not about disabling gates.
    mockGetLessonData.mockReturnValue({
      ...lesson,
      gates: [{ ...lesson.gates[0], afterMessageIndex: 0 }],
    });
    mockRepo.getSocioProgress.mockResolvedValue({
      currentLessonNumber: 2, currentMessageIndex: 1, completedLessons: [1],
      weeklyUnderstanding: 7, weeklyImplementation: null, remindersSent: 0,
    });

    const r = await determineMode(CHAT_DELIVERY, socio, 'ok', 'mi');
    expect(r.routerResult.mode).toBe(InteractionMode.GATED_ASSESSMENT);
  });

  it('skips stance selection on the gated-assessment path', async () => {
    // That mode returns before buildSystemPrompt, so a stance would be two
    // queries spent on a prompt that is never assembled.
    mockGetLessonData.mockReturnValue({ ...lesson, gates: [{ ...lesson.gates[0], afterMessageIndex: 0 }] });
    mockRepo.getSocioProgress.mockResolvedValue({
      currentLessonNumber: 2, currentMessageIndex: 1, completedLessons: [1],
      weeklyUnderstanding: 7, weeklyImplementation: null, remindersSent: 0,
    });

    const r = await determineMode(CHAT_DELIVERY, socio, 'ok', 'mi');
    expect(r.routerResult.mode).toBe(InteractionMode.GATED_ASSESSMENT);
    expect(r.routerResult.stance).toBeUndefined();
    expect(mockRepo.getActiveFlags).not.toHaveBeenCalled();
  });
});
