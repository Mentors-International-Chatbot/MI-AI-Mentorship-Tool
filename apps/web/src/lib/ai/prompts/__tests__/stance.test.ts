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

vi.mock('../courseOutcome', () => ({
  resolveCourseProject: vi.fn(async () => null),
  resolveCourseMilestones: vi.fn(async () => []),
}));

import { repo } from '@/lib/repo';
import { hasLessonData, getLessonData } from '@/lib/lessons/db-lesson-service';
import { resolveCourseProject, resolveCourseMilestones } from '../courseOutcome';
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
  // Mid-lesson with no score on record: the neutral starting point, so a case
  // that does not opt into the ungated ladder is unaffected by it.
  currentMessageIndex: 0,
  weeklyUnderstanding: null as number | null,
};

/** An ungated lesson with real teaching messages, for the taught-out rung. */
const ungatedLesson = {
  ...lessonWithGate,
  gates: [],
  messages: [
    { order: 1, type: 'escenario' as const, contentEs: 'Scenario' },
    { order: 2, type: 'explicación' as const, contentEs: 'Explanation' },
  ],
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

  it('does not consult gate sessions on a lesson that declares no gate', async () => {
    setLesson(lessonWithoutGate);

    const d = await resolveStance({ ...base, promptOverrides: null, activeFlags: [] });
    // Not `gate_not_passed`: this course set no bar, so the learner did not
    // fail to clear one. The ungated ladder answers instead.
    expect(d).toEqual({ stance: 'tutor', reason: 'awaiting_evidence' });
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

describe('rule (c): the ungated evidence ladder', () => {
  /**
   * The bug this ladder fixes: every curriculum imported without teach-back
   * gates — the legacy MI collection among them — was pinned to tutor for the
   * entire course, so the coach half of the system never ran for those
   * learners. "This course set no bar" was being read as "this learner did not
   * clear the bar".
   */
  it('reaches coach once the lesson has been taught out', async () => {
    setLesson(ungatedLesson);

    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [],
      currentMessageIndex: ungatedLesson.messages.length,
    });

    expect(d).toEqual({ stance: 'coach', reason: 'lesson_taught_out' });
  });

  it('stays tutor while there is still teaching left to deliver', async () => {
    setLesson(ungatedLesson);

    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [],
      currentMessageIndex: 1, // one message still undelivered
    });

    expect(d).toEqual({ stance: 'tutor', reason: 'awaiting_evidence' });
  });

  it('lets a recorded low understanding veto the taught-out rung', async () => {
    setLesson(ungatedLesson);

    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [],
      currentMessageIndex: ungatedLesson.messages.length,
      weeklyUnderstanding: 2, // at or below RETEACH_THRESHOLD
    });

    expect(d.stance).toBe('tutor');
  });

  it('does not let a MISSING understanding score veto it', async () => {
    // Most lessons complete without a parsed score. Treating absence as failure
    // would leave the ladder as unreachable as the gate rule it replaces.
    setLesson(ungatedLesson);

    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [],
      currentMessageIndex: ungatedLesson.messages.length,
      weeklyUnderstanding: null,
    });

    expect(d.stance).toBe('coach');
  });

  it('reaches coach on a reported milestone even mid-lesson', async () => {
    setLesson(ungatedLesson);

    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [],
      currentMessageIndex: 0,
      loadReachedMilestones: async () => new Set(['first-sale']),
    });

    expect(d).toEqual({ stance: 'coach', reason: 'milestone_reached' });
  });

  it('is unmoved by an empty milestone set', async () => {
    setLesson(ungatedLesson);

    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [],
      currentMessageIndex: 0,
      loadReachedMilestones: async () => new Set<string>(),
    });

    expect(d).toEqual({ stance: 'tutor', reason: 'awaiting_evidence' });
  });

  it('survives a milestone read failure and falls to the next rung', async () => {
    setLesson(ungatedLesson);

    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [],
      currentMessageIndex: ungatedLesson.messages.length,
      loadReachedMilestones: async () => { throw new Error('connection reset'); },
    });

    expect(d).toEqual({ stance: 'coach', reason: 'lesson_taught_out' });
  });

  it('never lets the ladder override a gate the course DID declare', async () => {
    // The rigour that made the old rule right about gated courses has to
    // survive: a failed teach-back is not overridden by a milestone or by
    // having run out of teaching messages.
    setLesson({ ...lessonWithGate, messages: ungatedLesson.messages });
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue(failedSession());

    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [],
      currentMessageIndex: ungatedLesson.messages.length,
      weeklyUnderstanding: 9,
      loadReachedMilestones: async () => new Set(['first-sale']),
    });

    expect(d).toEqual({ stance: 'tutor', reason: 'gate_not_passed' });
  });

  it('does not read milestones at all on a gated lesson', async () => {
    // The gate answers on its own, so the extra query is never issued.
    setLesson(lessonWithGate);
    mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue(passedSession());
    const load = vi.fn(async () => new Set<string>());

    await resolveStance({
      ...base, promptOverrides: null, activeFlags: [], loadReachedMilestones: load,
    });

    expect(load).not.toHaveBeenCalled();
  });

  it('still applies the tutor detour to a milestone-earned coach', async () => {
    // Hysteresis belongs to every route into coach, not only the gate route.
    setLesson(ungatedLesson);

    const d = await resolveStance({
      ...base,
      promptOverrides: null,
      activeFlags: [],
      reteachThisTurn: true,
      loadReachedMilestones: async () => new Set(['first-sale']),
    });

    expect(d).toEqual({ stance: 'tutor', reason: 'tutor_detour' });
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

  it('gives coach the course project, not just this lesson', async () => {
    // The project was validated-then-dropped at import until 2026-08-08, so
    // coach stance knew the immediate task and never the goal it served.
    const mockProject = resolveCourseProject as unknown as ReturnType<typeof vi.fn>;
    mockProject.mockResolvedValue({
      title: 'A peanut butter and jelly sandwich',
      description: 'Made start to finish, unaided',
      deliverables: [{ name: 'The sandwich' }, { name: 'A written recipe', description: 'One page' }],
    });

    const coach = await buildStanceBlock({
      stance: 'coach', participantNoun: 'learner', collectionKey: 'pbj',
      currentLessonNumber: 3, language: 'en',
      scope: { organizationId: 'org-1', collectionKey: 'pbj' },
    });

    expect(coach).toContain('Course project: A peanut butter and jelly sandwich');
    expect(coach).toContain('Made start to finish, unaided');
    expect(coach).toContain('Deliverables: The sandwich; A written recipe (One page)');
    // Both scopes together: the goal AND this lesson's slice of it.
    expect(coach).toContain('narrating each step out loud');
  });

  it('withholds the project from tutor', async () => {
    const mockProject = resolveCourseProject as unknown as ReturnType<typeof vi.fn>;
    mockProject.mockResolvedValue({ title: 'A sandwich', deliverables: [] });

    const tutor = await buildStanceBlock({
      stance: 'tutor', participantNoun: 'learner', collectionKey: 'pbj',
      currentLessonNumber: 3, language: 'en',
      scope: { organizationId: 'org-1', collectionKey: 'pbj' },
    });

    expect(tutor).not.toContain('Course project');
    expect(mockProject).not.toHaveBeenCalled();
  });

  it('still emits the lesson task when the course has no project', async () => {
    const mockProject = resolveCourseProject as unknown as ReturnType<typeof vi.fn>;
    mockProject.mockResolvedValue(null);

    const coach = await buildStanceBlock({
      stance: 'coach', participantNoun: 'learner', collectionKey: 'pbj',
      currentLessonNumber: 3, language: 'en',
      scope: { organizationId: 'org-1', collectionKey: 'pbj' },
    });

    expect(coach).not.toContain('Course project');
    expect(coach).toContain('narrating each step out loud');
  });

  it('emits the project even when the lesson has no exercise or commitment', async () => {
    setLesson({ ...lessonWithGate, exercise: '', commitment: '' });
    const mockProject = resolveCourseProject as unknown as ReturnType<typeof vi.fn>;
    mockProject.mockResolvedValue({ title: 'A sandwich', deliverables: [] });

    const coach = await buildStanceBlock({
      stance: 'coach', participantNoun: 'learner', collectionKey: 'pbj',
      currentLessonNumber: 3, language: 'en',
      scope: { organizationId: 'org-1', collectionKey: 'pbj' },
    });

    expect(coach).toContain('WHAT THE PARTICIPANT IS TRYING TO DO');
    expect(coach).toContain('Course project: A sandwich');
  });

  it('tells coach how far along the participant is, with keys for the marker', async () => {
    // The first time the system can answer "how far along are they" — before
    // milestone_progress existed there was no record that anyone DID anything.
    const mockMs = resolveCourseMilestones as unknown as ReturnType<typeof vi.fn>;
    mockMs.mockResolvedValue([
      { key: 'assembled', name: 'Assembled a sandwich', afterLessonKey: 'l1', checkDescription: 'Ask about assembly.' },
      { key: 'delivered', name: 'Gave one to someone', afterLessonKey: 'l2', checkDescription: 'Ask who received it and what happened.' },
      { key: 'reflected', name: 'Reflected on it', afterLessonKey: 'l3', checkDescription: 'Ask what they learned.' },
    ]);

    const coach = await buildStanceBlock({
      stance: 'coach', participantNoun: 'learner', collectionKey: 'pbj',
      currentLessonNumber: 3, language: 'en',
      scope: { organizationId: 'org-1', collectionKey: 'pbj' },
      reachedMilestoneKeys: new Set(['assembled']),
    });

    expect(coach).toContain('Assembled a sandwich [assembled] — done');
    expect(coach).toContain('Gave one to someone [delivered] — pending');
    expect(coach).toContain('Current milestone conversation: Ask who received it and what happened.');
    expect(coach).not.toContain('Ask about assembly.');
    expect(coach).not.toContain('Ask what they learned.');
    // The marker instruction must quote an exact key, so the key is rendered.
    expect(coach).toContain('[MILESTONE:key]');
  });

  it('stops inviting the marker once every milestone is reached', async () => {
    // Asking for a marker with nothing outstanding invites a duplicate emit.
    const mockMs = resolveCourseMilestones as unknown as ReturnType<typeof vi.fn>;
    mockMs.mockResolvedValue([{ key: 'assembled', name: 'Assembled', afterLessonKey: 'l1' }]);

    const coach = await buildStanceBlock({
      stance: 'coach', participantNoun: 'learner', collectionKey: 'pbj',
      currentLessonNumber: 3, language: 'en',
      scope: { organizationId: 'org-1', collectionKey: 'pbj' },
      reachedMilestoneKeys: new Set(['assembled']),
    });

    expect(coach).toContain('— done');
    expect(coach).not.toContain('[MILESTONE:key]');
  });

  it('treats absent progress as everything pending rather than throwing', async () => {
    const mockMs = resolveCourseMilestones as unknown as ReturnType<typeof vi.fn>;
    mockMs.mockResolvedValue([{ key: 'assembled', name: 'Assembled', afterLessonKey: 'l1' }]);

    const coach = await buildStanceBlock({
      stance: 'coach', participantNoun: 'learner', collectionKey: 'pbj',
      currentLessonNumber: 3, language: 'en',
      scope: { organizationId: 'org-1', collectionKey: 'pbj' },
    });

    expect(coach).toContain('— pending');
  });

  it('uses the course terminology for the participant', async () => {
    const block = await buildStanceBlock({ stance: 'coach', participantNoun: 'entrepreneur', collectionKey: 'pbj', currentLessonNumber: 3, language: 'en' });
    expect(block).toContain('entrepreneur');
  });
});
