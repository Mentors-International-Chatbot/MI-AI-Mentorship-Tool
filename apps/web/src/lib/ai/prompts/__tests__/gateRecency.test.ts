/**
 * Gate recency — "just now" vs "at some point"
 * ═══════════════════════════════════════════════════════════════════════════
 * Stance asks whether a gate has EVER been passed, which is right for choosing
 * a posture and useless for choosing what to say. This module answers the other
 * question, and the definition of "just now" is the whole design: a gate is
 * news if it resolved after the AI last spoke in the main thread.
 *
 * That definition self-clears. Once the AI responds, its own message becomes
 * the reference point and the gate stops being news — no flag to unset, no way
 * for two pieces of state to disagree. The cases below pin that cycle, because
 * the failure mode is an AI that congratulates the same learner every turn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/lessons/db-lesson-service', () => ({
  hasLessonData: vi.fn(),
  getLessonData: vi.fn(),
}));

import { hasLessonData, getLessonData } from '@/lib/lessons/db-lesson-service';
import { readGateRecency } from '../gateRecency';
import type { GateSessionLoader } from '../gateSessions';

const mockHasLessonData = hasLessonData as ReturnType<typeof vi.fn>;
const mockGetLessonData = getLessonData as ReturnType<typeof vi.fn>;

const T0 = new Date('2026-08-09T10:00:00.000Z'); // gate card posted
const T1 = new Date('2026-08-09T10:05:00.000Z'); // gate resolved
const T2 = new Date('2026-08-09T10:06:00.000Z'); // AI acknowledged it

const gatedLesson = {
  lessonNumber: 1,
  lessonKey: 'make-the-sandwich',
  titleEs: 'Make the sandwich',
  category: 'Practice',
  keyConcepts: [],
  selfCheckQuestions: [],
  messages: [{ order: 1, type: 'escenario' as const, contentEs: 'S' }],
  gates: [{ blockId: 'gate-1', afterMessageIndex: 0, prompt: 'Explain', evaluatesConcepts: [], dimensionKey: 'seq' }],
};

function session(over: Partial<{ status: string; completedAt: Date | null; passedAt: Date | null }>) {
  return {
    id: 's1',
    status: 'completed',
    completedAt: T1,
    passedAt: T1,
    ...over,
  };
}

function loader(sessions: unknown[]): GateSessionLoader {
  return (async () => sessions) as unknown as GateSessionLoader;
}

const base = {
  collectionKey: 'pbj',
  lessonNumber: 1,
  channelType: 'web',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHasLessonData.mockReturnValue(true);
  mockGetLessonData.mockReturnValue(gatedLesson);
});

describe('readGateRecency', () => {
  it('reports a pass that landed after the AI last spoke as news', async () => {
    const r = await readGateRecency({
      ...base,
      loadGateSessions: loader([session({})]),
      loadLastAssistantAt: async () => T0, // the gate card, posted before the gate resolved
    });

    expect(r).toEqual({ lessonNumber: 1, outcome: 'passed', justResolved: true });
  });

  it('stops reporting it as news once the AI has spoken since', async () => {
    // The self-clearing property. Without it the AI congratulates every turn.
    const r = await readGateRecency({
      ...base,
      loadGateSessions: loader([session({})]),
      loadLastAssistantAt: async () => T2,
    });

    expect(r).toEqual({ lessonNumber: 1, outcome: 'passed', justResolved: false });
  });

  it('reports a failed attempt, and does not call it a pass', async () => {
    // `passedAt: null` on a completed session is a fail, the same distinction
    // stance draws. Congratulating here would be the worst possible output.
    const r = await readGateRecency({
      ...base,
      loadGateSessions: loader([session({ passedAt: null })]),
      loadLastAssistantAt: async () => T0,
    });

    expect(r).toEqual({ lessonNumber: 1, outcome: 'not_passed', justResolved: true });
  });

  it('treats a never-spoken thread as news', async () => {
    const r = await readGateRecency({
      ...base,
      loadGateSessions: loader([session({})]),
      loadLastAssistantAt: async () => null,
    });

    expect(r?.justResolved).toBe(true);
  });

  it('returns null when no attempt has completed', async () => {
    // Rendering "not yet attempted" would spend tokens inviting the model to
    // mention an assessment the learner has not reached.
    const r = await readGateRecency({
      ...base,
      loadGateSessions: loader([session({ status: 'in_progress', completedAt: null, passedAt: null })]),
      loadLastAssistantAt: async () => T0,
    });

    expect(r).toBeNull();
  });

  it('returns null for a lesson with no gates', async () => {
    mockGetLessonData.mockReturnValue({ ...gatedLesson, gates: [] });
    const r = await readGateRecency({
      ...base,
      loadGateSessions: loader([session({})]),
      loadLastAssistantAt: async () => T0,
    });

    expect(r).toBeNull();
  });

  it('returns null on a channel that cannot deliver a gate', async () => {
    const r = await readGateRecency({
      ...base,
      channelType: 'whatsapp',
      loadGateSessions: loader([session({})]),
      loadLastAssistantAt: async () => T0,
    });

    expect(r).toBeNull();
  });

  it('reports the most recent resolution when a gate was retaken', async () => {
    // Attempt 1 failed, attempt 2 passed. The learner just lived through the
    // second one; reporting the first would be actively wrong.
    const later = new Date(T1.getTime() + 60_000);
    const r = await readGateRecency({
      ...base,
      loadGateSessions: loader([
        session({ passedAt: null }),
        session({ completedAt: later, passedAt: later }),
      ]),
      loadLastAssistantAt: async () => T0,
    });

    expect(r).toEqual({ lessonNumber: 1, outcome: 'passed', justResolved: true });
  });

  it('does not query the reference point when there is nothing to report', async () => {
    // The lookup is lazy so ordinary turns pay nothing for this feature.
    const loadLastAssistantAt = vi.fn(async () => T0);
    mockGetLessonData.mockReturnValue({ ...gatedLesson, gates: [] });

    await readGateRecency({ ...base, loadGateSessions: loader([]), loadLastAssistantAt });

    expect(loadLastAssistantAt).not.toHaveBeenCalled();
  });
});
