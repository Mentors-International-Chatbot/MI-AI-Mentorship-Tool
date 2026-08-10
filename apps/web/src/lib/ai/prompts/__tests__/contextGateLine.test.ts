/**
 * The gate line in Layer 2
 * ═══════════════════════════════════════════════════════════════════════════
 * `gateRecency.test.ts` pins the decision. This pins that the decision reaches
 * the assembled prompt, in every language, on both branches of
 * `buildContextPrompt` — including the new-socio branch, which is the one the
 * observed bug went through.
 *
 * That branch matters more than it looks: gates fire mid-lesson, so a learner
 * can pass the lesson-1 teach-back while `completedLessons` is still empty.
 * Wiring only the progressed-socio branch would have left the exact reported
 * case unfixed while every test passed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socio } from '@/lib/repo/types';

vi.mock('@/lib/repo', () => ({
  repo: { getSocioContext: vi.fn() },
}));

vi.mock('@/lib/lessons/db-lesson-service', () => ({
  getLessonTitle: vi.fn(() => 'Make the sandwich'),
  getLessonCount: vi.fn(() => 3),
}));

vi.mock('@/lib/courses/course-meta', () => ({
  getCourseMeta: vi.fn(async () => ({
    courseName: 'PB&J',
    terminology: { participant: { es: 'participante', en: 'participant', pt: 'participante' } },
    learnerContext: undefined,
  })),
  resolveLocalized: vi.fn((v: Record<string, string>, lang: string) => v[lang] ?? v['en']),
}));

import { repo } from '@/lib/repo';
import { buildContextPrompt } from '../layers/context';
import type { GateRecency } from '../gateRecency';

const mockRepo = repo as unknown as { getSocioContext: ReturnType<typeof vi.fn> };

const socio: Socio = {
  id: 'socio-1',
  channelType: 'web',
  externalId: 'ext-1',
  language: 'en',
  status: 'ACTIVE',
  aiPaused: false,
  name: 'Ana',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** A learner partway through, so the main branch renders. */
const progressed = {
  currentLessonNumber: 2,
  completedLessons: [1],
  weeklyUnderstanding: 7,
  weeklyImplementation: null,
  daysSinceLastInteraction: 0,
};

/** Lesson 1, nothing completed yet — the new-socio branch. */
const brandNew = {
  currentLessonNumber: 1,
  completedLessons: [] as number[],
  weeklyUnderstanding: null,
  weeklyImplementation: null,
  daysSinceLastInteraction: 0,
};

const passedNow: GateRecency = { lessonNumber: 1, outcome: 'passed', justResolved: true };

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.getSocioContext.mockResolvedValue(null);
});

describe('Layer 2 gate line', () => {
  it('tells the model a gate passed just now, and that it has not said so', async () => {
    const text = await buildContextPrompt(socio, progressed, 'pbj', 'en', [], passedNow);

    expect(text).toContain('Lesson 1 assessment: PASSED just now');
    expect(text).toContain('you have not acknowledged it yet');
  });

  it('renders on the lesson-1 branch, where the reported bug happened', async () => {
    // completedLessons is empty here, which routes through buildNewSocioContext.
    const text = await buildContextPrompt(socio, brandNew, 'pbj', 'en', [], passedNow);

    expect(text).toContain('Lesson 1 assessment: PASSED just now');
  });

  it('distinguishes a pass it has already acknowledged', async () => {
    const text = await buildContextPrompt(socio, progressed, 'pbj', 'en', [], {
      ...passedNow,
      justResolved: false,
    });

    expect(text).toContain('Lesson 1 assessment: passed earlier');
    expect(text).not.toContain('just now');
  });

  it('never phrases a failed attempt as a pass', async () => {
    const text = await buildContextPrompt(socio, progressed, 'pbj', 'en', [], {
      lessonNumber: 1,
      outcome: 'not_passed',
      justResolved: true,
    });

    expect(text).toContain('NOT passed just now');
    expect(text).not.toContain('PASSED just now');
  });

  it('says nothing at all when there is no gate result', async () => {
    const text = await buildContextPrompt(socio, progressed, 'pbj', 'en', [], undefined);

    expect(text).not.toContain('assessment');
  });

  it('localizes rather than leaking English into a Spanish prompt', async () => {
    const es = await buildContextPrompt(socio, progressed, 'pbj', 'es', [], passedNow);
    expect(es).toContain('Evaluación de la lección 1: APROBADA justo ahora');

    const pt = await buildContextPrompt(socio, progressed, 'pbj', 'pt', [], passedNow);
    expect(pt).toContain('Avaliação da lição 1: APROVADA agora mesmo');
  });
});
