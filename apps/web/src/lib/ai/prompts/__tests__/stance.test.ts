/**
 * Teaching stance — selection rules, hysteresis, and framing
 * ═══════════════════════════════════════════════════════════════════════════
 * The rules under test are precedence-ordered:
 *   a. active RED distress flag → coach
 *   b. gate not passed          → tutor
 *   c. gate passed              → coach
 *
 * Most of these cases exist because the failure mode is silent. A stance that
 * picks wrong still produces a fluent reply; nothing throws, nothing logs, and
 * the only symptom is that the AI lectures someone who asked for help. So the
 * decision is pinned directly rather than inferred from output.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SocioFlag } from '@/lib/repo/types';

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

vi.mock('../loadPrompt', () => ({
  // No DB in this suite: every call falls through to the localized code
  // default, which is the tier the tests below are actually about.
  loadActivePrompt: vi.fn(async (_category: string, fallback: string) => fallback),
}));

import { repo } from '@/lib/repo';
import { hasLessonData, getLessonData } from '@/lib/lessons/db-lesson-service';
import {
  resolveStance,
  buildStanceBlock,
  readStanceDetour,
  hasActiveDistress,
  hasPassedCurrentLessonGates,
  TUTOR_DETOUR_TURNS,
  STANCE_DETOUR_KEY,
} from '../stance';

const mockRepo = repo as unknown as {
  getAssessmentSessionsForSocioLesson: ReturnType<typeof vi.fn>;
  updateSocio: ReturnType<typeof vi.fn>;
};
const mockHasLessonData = hasLessonData as ReturnType<typeof vi.fn>;
const mockGetLessonData = getLessonData as ReturnType<typeof vi.fn>;

function flag(level: 'RED' | 'YELLOW', reasonCode = 'sentiment.distressed'): SocioFlag {
  return {
    id: `flag-${level}-${Math.random()}`,
    socioId: 'socio-1',
    level,
    reason: 'urgency=9 threshold=8',
    source: 'sentiment_auto',
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    messageId: null,
    createdAt: new Date(),
    reasonCode,
    reasonParams: null,
    status: 'OPEN',
    disposition: null,
    snoozedUntil: null,
    occurrenceCount: 1,
    lastOccurredAt: null,
  } as SocioFlag;
}

const lessonWithGate = {
  lessonNumber: 3,
  lessonKey: 'assemble-the-sandwich',
  titleEs: 'Assemble the sandwich',
  category: 'Practice',
  keyConcepts: ['Order matters'],
  selfCheckQuestions: [],
  exercise: 'Make one PB&J sandwich, narrating each step out loud as you go.',
  commitment: 'I will make a sandwich for someone else this week.',
  messages: [],
  gates: [{ blockId: 'gate-1', afterMessageIndex: 2, prompt: 'Explain it back', evaluatesConcepts: [], dimensionKey: 'sequencing' }],
};

const lessonWithoutGate = { ...lessonWithGate, gates: [] };

function setLesson(lesson: unknown, exists = true) {
  mockHasLessonData.mockReturnValue(exists);
  mockGetLessonData.mockReturnValue(lesson);
}

/** A gate session that was passed. */
function passedSession() {
  return [{ id: 's1', status: 'completed', passedAt: new Date(), attemptNumber: 1 }];
}
/** Finished, but failed. `status` says completed; `passedAt` says otherwise. */
function failedSession() {
  return [{ id: 's1', status: 'completed', passedAt: null, attemptNumber: 1 }];
}

const base = {
  socioId: 'socio-1',
  collectionKey: 'pbj',
  currentLessonNumber: 3,
  reteachThisTurn: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.updateSocio.mockResolvedValue({});
});

describe('stance selection', () => {
  it('picks tutor before the gate is passed', async () => {
    setLesson(lessonWithGate);
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([]);

    const d = await resolveStance({ ...base, promptOverrides: null, activeFlags: [] });
    expect(d).toEqual({ stance: 'tutor', reason: 'gate_not_passed' });
  });

  it('picks coach once the gate is passed', async () => {
    setLesson(lessonWithGate);
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue(passedSession());

    const d = await resolveStance({ ...base, promptOverrides: null, activeFlags: [] });
    expect(d).toEqual({ stance: 'coach', reason: 'gate_passed' });
  });

  it('treats a completed-but-failed session as not passed', async () => {
    // `status: 'completed'` with `passedAt: null` is a fail. The router's own
    // progression check deliberately treats it as clearing the gate — a failed
    // attempt must not block forever — so stance must not reuse that predicate.
    setLesson(lessonWithGate);
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue(failedSession());

    const d = await resolveStance({ ...base, promptOverrides: null, activeFlags: [] });
    expect(d.stance).toBe('tutor');
  });

  it('stays tutor on a lesson that declares no gate at all', async () => {
    // No gate means no evidence of knowledge. Documented consequence: curricula
    // imported without teach-backs never reach coach except through distress.
    setLesson(lessonWithoutGate);

    const d = await resolveStance({ ...base, promptOverrides: null, activeFlags: [] });
    expect(d).toEqual({ stance: 'tutor', reason: 'gate_not_passed' });
    expect(mockRepo.getAssessmentSessionsForSocioLesson).not.toHaveBeenCalled();
  });

  it('requires every gate on the lesson to be passed', async () => {
    setLesson({
      ...lessonWithGate,
      gates: [
        { ...lessonWithGate.gates[0], blockId: 'gate-1' },
        { ...lessonWithGate.gates[0], blockId: 'gate-2' },
      ],
    });
    mockRepo.getAssessmentSessionsForSocioLesson
      .mockResolvedValueOnce(passedSession())
      .mockResolvedValueOnce(failedSession());

    const d = await resolveStance({ ...base, promptOverrides: null, activeFlags: [] });
    expect(d.stance).toBe('tutor');
  });
});

describe('rule (a): distress outranks the gate rules', () => {
  it('picks coach on an active RED flag even before the gate is passed', async () => {
    // The whole point of the rule: never tutor someone in crisis. Without it,
    // a distressed learner pre-gate gets a lecture.
    setLesson(lessonWithGate);
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([]);

    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [flag('RED')],
    });
    expect(d).toEqual({ stance: 'coach', reason: 'distress' });
  });

  it('does not consult the gate at all when distress is present', async () => {
    setLesson(lessonWithGate);
    await resolveStance({ ...base, promptOverrides: null, activeFlags: [flag('RED')] });
    expect(mockRepo.getAssessmentSessionsForSocioLesson).not.toHaveBeenCalled();
  });

  it('does not treat a YELLOW flag as distress', async () => {
    // YELLOW is elevated confusion or frustration, not a crisis. Promoting it
    // would make coach the default for most learners and empty the rule.
    setLesson(lessonWithGate);
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([]);

    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [flag('YELLOW', 'sentiment.confusion_elevated')],
    });
    expect(d.stance).toBe('tutor');
  });

  it('cancels an open tutor detour', async () => {
    setLesson(lessonWithGate);
    const d = await resolveStance({
      ...base,
      promptOverrides: { [STANCE_DETOUR_KEY]: { turnsRemaining: 2, lessonNumber: 3 } },
      activeFlags: [flag('RED')],
    });

    expect(d.stance).toBe('coach');
    expect(mockRepo.updateSocio).toHaveBeenCalledWith('socio-1', { promptOverrides: null });
  });

  it('hasActiveDistress reads RED and only RED', () => {
    expect(hasActiveDistress([])).toBe(false);
    expect(hasActiveDistress([flag('YELLOW')])).toBe(false);
    expect(hasActiveDistress([flag('YELLOW'), flag('RED')])).toBe(true);
  });
});

describe('hysteresis: coach rests, tutor visits', () => {
  beforeEach(() => {
    setLesson(lessonWithGate);
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue(passedSession());
  });

  it('opens a bounded detour when the router chose RETEACH', async () => {
    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [],
      reteachThisTurn: true,
    });

    expect(d).toEqual({ stance: 'tutor', reason: 'tutor_detour' });
    expect(mockRepo.updateSocio).toHaveBeenCalledWith('socio-1', {
      promptOverrides: {
        [STANCE_DETOUR_KEY]: { turnsRemaining: TUTOR_DETOUR_TURNS - 1, lessonNumber: 3 },
      },
    });
  });

  it('holds tutor after the entry signal disappears — this is the anti-flap', async () => {
    // The signal that opens a detour is an EMA thresholded at confidence >= 0.4,
    // which crosses back and forth. If stance tracked it per turn, the posture
    // would oscillate mid-conversation. Entry is signal-driven; exit is not.
    const d = await resolveStance({
      ...base,
      promptOverrides: { [STANCE_DETOUR_KEY]: { turnsRemaining: 2, lessonNumber: 3 } },
      activeFlags: [],
      reteachThisTurn: false,
    });

    expect(d).toEqual({ stance: 'tutor', reason: 'tutor_detour' });
    expect(mockRepo.updateSocio).toHaveBeenCalledWith('socio-1', {
      promptOverrides: { [STANCE_DETOUR_KEY]: { turnsRemaining: 1, lessonNumber: 3 } },
    });
  });

  it('returns to coach when the budget runs out', async () => {
    const d = await resolveStance({
      ...base,
      promptOverrides: { [STANCE_DETOUR_KEY]: { turnsRemaining: 1, lessonNumber: 3 } },
      activeFlags: [],
    });

    expect(d.stance).toBe('tutor');
    // Last owed turn spent — the key is removed, not left at zero.
    expect(mockRepo.updateSocio).toHaveBeenCalledWith('socio-1', { promptOverrides: null });
  });

  it('runs the full budget from open to close', async () => {
    let overrides: Record<string, unknown> | null = null;
    mockRepo.updateSocio.mockImplementation(
      async (_id: string, data: { promptOverrides: Record<string, unknown> | null }) => {
        overrides = data.promptOverrides;
        return {};
      },
    );

    const stances: string[] = [];
    // Turn 1 opens the detour; every later turn sees no signal at all.
    for (let turn = 0; turn < TUTOR_DETOUR_TURNS + 1; turn++) {
      const d = await resolveStance({
        ...base,
        promptOverrides: overrides,
        activeFlags: [],
        reteachThisTurn: turn === 0,
      });
      stances.push(d.stance);
    }

    expect(stances).toEqual([
      ...Array(TUTOR_DETOUR_TURNS).fill('tutor'),
      'coach',
    ]);
  });

  it('ends a detour early when the learner moves to another lesson', async () => {
    // The detour was about *that* material. Carrying it forward would tutor a
    // lesson the learner never struggled with.
    const d = await resolveStance({
      ...base,
      currentLessonNumber: 4,
      promptOverrides: { [STANCE_DETOUR_KEY]: { turnsRemaining: 2, lessonNumber: 3 } },
      activeFlags: [],
    });

    expect(d).toEqual({ stance: 'coach', reason: 'gate_passed' });
    expect(mockRepo.updateSocio).toHaveBeenCalledWith('socio-1', { promptOverrides: null });
  });

  it('costs no write in steady-state coach', async () => {
    await resolveStance({ ...base, promptOverrides: null, activeFlags: [] });
    expect(mockRepo.updateSocio).not.toHaveBeenCalled();
  });

  it('costs no write in steady-state pre-gate tutor', async () => {
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([]);
    await resolveStance({ ...base, promptOverrides: null, activeFlags: [] });
    expect(mockRepo.updateSocio).not.toHaveBeenCalled();
  });

  it('preserves unrelated promptOverrides keys when writing', async () => {
    // Sliders live in the same JSON blob. Clobbering them would silently reset
    // a mentor's per-learner tuning.
    await resolveStance({
      ...base,
      promptOverrides: { warmth: 0.8, conciseness: 'brief' },
      activeFlags: [],
      reteachThisTurn: true,
    });

    expect(mockRepo.updateSocio).toHaveBeenCalledWith('socio-1', {
      promptOverrides: {
        warmth: 0.8,
        conciseness: 'brief',
        [STANCE_DETOUR_KEY]: { turnsRemaining: TUTOR_DETOUR_TURNS - 1, lessonNumber: 3 },
      },
    });
  });

  it('survives a failed detour write without failing the turn', async () => {
    mockRepo.updateSocio.mockRejectedValue(new Error('db down'));
    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [],
      reteachThisTurn: true,
    });
    expect(d.stance).toBe('tutor');
  });
});

describe('readStanceDetour', () => {
  it('rejects malformed, exhausted, and absent state', () => {
    expect(readStanceDetour(null)).toBeNull();
    expect(readStanceDetour({})).toBeNull();
    expect(readStanceDetour({ [STANCE_DETOUR_KEY]: 'nope' })).toBeNull();
    expect(readStanceDetour({ [STANCE_DETOUR_KEY]: { turnsRemaining: 0, lessonNumber: 3 } })).toBeNull();
    expect(readStanceDetour({ [STANCE_DETOUR_KEY]: { lessonNumber: 3 } })).toBeNull();
    expect(readStanceDetour({ [STANCE_DETOUR_KEY]: { turnsRemaining: 2, lessonNumber: 3 } })).toEqual({
      turnsRemaining: 2,
      lessonNumber: 3,
    });
  });
});

describe('hasPassedCurrentLessonGates', () => {
  it('returns false for a lesson with no data', async () => {
    mockHasLessonData.mockReturnValue(false);
    expect(await hasPassedCurrentLessonGates('socio-1', 'pbj', 99)).toBe(false);
  });
});

describe('stance framing', () => {
  beforeEach(() => setLesson(lessonWithGate));

  it('produces materially different text for the two stances', async () => {
    const [tutor, coach] = await Promise.all([
      buildStanceBlock({ stance: 'tutor', participantNoun: 'learner', collectionKey: 'pbj', currentLessonNumber: 3, language: 'en' }),
      buildStanceBlock({ stance: 'coach', participantNoun: 'learner', collectionKey: 'pbj', currentLessonNumber: 3, language: 'en' }),
    ]);

    expect(tutor).not.toEqual(coach);
    expect(tutor).toContain('STANCE: TUTOR');
    expect(coach).toContain('STANCE: COACH');
    // The postures must disagree about what the turn is for, not just in wording.
    expect(tutor).toMatch(/UNDERSTAND/);
    expect(coach).toMatch(/MAKE PROGRESS/);
  });

  it('gives coach the concrete task and withholds it from tutor', async () => {
    const coach = await buildStanceBlock({ stance: 'coach', participantNoun: 'learner', collectionKey: 'pbj', currentLessonNumber: 3, language: 'en' });
    const tutor = await buildStanceBlock({ stance: 'tutor', participantNoun: 'learner', collectionKey: 'pbj', currentLessonNumber: 3, language: 'en' });

    expect(coach).toContain('narrating each step out loud');
    expect(coach).toContain('make a sandwich for someone else');
    expect(tutor).not.toContain('narrating each step out loud');
  });

  it('omits the task block when the lesson declares neither exercise nor commitment', async () => {
    setLesson({ ...lessonWithGate, exercise: '', commitment: '' });
    const coach = await buildStanceBlock({ stance: 'coach', participantNoun: 'learner', collectionKey: 'pbj', currentLessonNumber: 3, language: 'en' });
    expect(coach).not.toContain('WHAT THE PARTICIPANT IS TRYING TO DO');
  });

  it('localizes the code defaults rather than falling back to Spanish', async () => {
    // The standing finding: a code default is the floor a course lands on when
    // it has published no prompt, so a Spanish-only floor just moves one
    // tenant's language from the database into the source.
    const en = await buildStanceBlock({ stance: 'coach', participantNoun: 'learner', collectionKey: 'pbj', currentLessonNumber: 3, language: 'en' });
    const pt = await buildStanceBlock({ stance: 'coach', participantNoun: 'participante', collectionKey: 'pbj', currentLessonNumber: 3, language: 'pt' });
    const es = await buildStanceBlock({ stance: 'coach', participantNoun: 'socio', collectionKey: 'pbj', currentLessonNumber: 3, language: 'es' });

    expect(en).toContain('STANCE: COACH');
    expect(pt).toContain('POSTURA: COACH');
    expect(pt).toContain('O QUE O PARTICIPANTE');
    expect(es).toContain('LO QUE EL PARTICIPANTE');
    expect(en).toContain('WHAT THE PARTICIPANT IS TRYING TO DO');
    expect(en).not.toContain('POSTURA');
  });

  it('uses the course terminology for the participant', async () => {
    const block = await buildStanceBlock({ stance: 'coach', participantNoun: 'entrepreneur', collectionKey: 'pbj', currentLessonNumber: 3, language: 'en' });
    expect(block).toContain('entrepreneur');
  });
});
