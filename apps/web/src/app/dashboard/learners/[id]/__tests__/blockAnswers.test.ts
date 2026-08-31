/**
 * Formats the three block types a mentor could not see any answer for
 * before this: quiz_checkpoint, drag_order, and onboarding_survey never post
 * through /api/chat (they're graded deterministically server-side — see
 * gradePlayerBlock), so they never produce a Message row. This is the pure
 * grouping/formatting step, kept separate from the Prisma + lesson-content
 * reads so it's testable without a DB — same split as blockActivity.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { lessonBlockSchema, type ParsedLessonBlock } from '@/lib/journey-package/journey-package.schema';
import { buildBlockAnswers, type BlockProgressRow } from '../blockAnswers';

const quiz = lessonBlockSchema.parse({
  id: 'q1', order: 1, blockType: 'quiz_checkpoint', concepts: [],
  questions: [
    { id: 'q1', prompt: 'Pick the right one', format: 'multiple_choice', options: ['A', 'B'], answerKey: 'B', explanation: 'B is correct' },
    { id: 'q2', prompt: 'Your opinion?', format: 'multiple_choice', options: ['Yes', 'No'], graded: false },
  ],
});

const drag = lessonBlockSchema.parse({
  id: 'd1', order: 2, blockType: 'drag_order', concepts: [],
  prompt: 'Put these in order', items: ['First', 'Second', 'Third'], correctOrder: [0, 1, 2],
});

const survey = lessonBlockSchema.parse({
  id: 's1', order: 3, blockType: 'onboarding_survey', concepts: [],
  steps: [
    { id: 'step1', field: 'name', prompt: "What's your name?" },
    { id: 'step2', field: 'major', prompt: "What's your major?" },
  ],
});

function blocksByKey(lessonKey: string, ...blocks: ParsedLessonBlock[]) {
  return new Map(blocks.map((b) => [`${lessonKey}:${b.id}`, b]));
}

function row(overrides: Partial<BlockProgressRow> & Pick<BlockProgressRow, 'blockId' | 'response' | 'completedAt'>): BlockProgressRow {
  return { lessonKey: 'lesson-1', ...overrides };
}

describe('buildBlockAnswers', () => {
  it('grades a graded quiz question and leaves an ungraded one without a correct/incorrect verdict', () => {
    const rows = [row({ blockId: 'q1', response: { q1: 'B', q2: 'Yes' }, completedAt: new Date('2026-08-28T00:00:00Z') })];
    const result = buildBlockAnswers(rows, blocksByKey('lesson-1', quiz));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ lessonKey: 'lesson-1', blockId: 'q1', blockType: 'quiz_checkpoint' });
    expect(result[0].items).toEqual([
      { prompt: 'Pick the right one', answer: 'B', correct: true },
      { prompt: 'Your opinion?', answer: 'Yes', correct: undefined },
    ]);
  });

  it('marks a wrong graded answer incorrect', () => {
    const rows = [row({ blockId: 'q1', response: { q1: 'A', q2: 'No' }, completedAt: new Date('2026-08-28T00:00:00Z') })];
    const result = buildBlockAnswers(rows, blocksByKey('lesson-1', quiz));
    expect(result[0].items[0]).toEqual({ prompt: 'Pick the right one', answer: 'A', correct: false });
  });

  it('maps a drag_order response through item labels and checks it against correctOrder', () => {
    const correctRows = [row({ blockId: 'd1', response: [0, 1, 2], completedAt: new Date('2026-08-28T00:00:00Z') })];
    expect(buildBlockAnswers(correctRows, blocksByKey('lesson-1', drag))[0].items).toEqual([
      { prompt: 'Put these in order', answer: 'First → Second → Third', correct: true },
    ]);

    const wrongRows = [row({ blockId: 'd1', response: [1, 0, 2], completedAt: new Date('2026-08-28T00:00:00Z') })];
    expect(buildBlockAnswers(wrongRows, blocksByKey('lesson-1', drag))[0].items).toEqual([
      { prompt: 'Put these in order', answer: 'Second → First → Third', correct: false },
    ]);
  });

  it('renders every answered onboarding_survey step, keyed by field', () => {
    const rows = [row({ blockId: 's1', response: { name: 'Michael', major: 'Information Systems' }, completedAt: new Date('2026-08-28T00:00:00Z') })];
    const result = buildBlockAnswers(rows, blocksByKey('lesson-1', survey));
    expect(result[0].items).toEqual([
      { prompt: "What's your name?", answer: 'Michael' },
      { prompt: "What's your major?", answer: 'Information Systems' },
    ]);
  });

  it('drops an onboarding_survey row with no answered steps rather than emitting an empty block', () => {
    const rows = [row({ blockId: 's1', response: {}, completedAt: new Date('2026-08-28T00:00:00Z') })];
    expect(buildBlockAnswers(rows, blocksByKey('lesson-1', survey))).toEqual([]);
  });

  it('skips a row whose block no longer exists in the current content (renamed or removed)', () => {
    const rows = [row({ blockId: 'gone', response: {}, completedAt: new Date('2026-08-28T00:00:00Z') })];
    expect(buildBlockAnswers(rows, blocksByKey('lesson-1', quiz))).toEqual([]);
  });

  it('skips a teach_back block — it already posts through /api/chat and shows up in the message history instead', () => {
    const teachBack = lessonBlockSchema.parse({ id: 't1', order: 4, blockType: 'teach_back', concepts: [], prompt: 'Explain it back', dimensionKey: 'ai_impact' });
    const rows = [row({ blockId: 't1', response: 'my explanation', completedAt: new Date('2026-08-28T00:00:00Z') })];
    expect(buildBlockAnswers(rows, blocksByKey('lesson-1', teachBack))).toEqual([]);
  });
});
