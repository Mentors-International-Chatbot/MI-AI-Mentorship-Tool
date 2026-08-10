/**
 * The lesson closing, now that the AI owns it
 * ═══════════════════════════════════════════════════════════════════════════
 * A system banner used to be concatenated onto the AI's reply whenever a
 * `[LESSON_COMPLETE]` marker came back: a horizontal rule, "✅ Lesson N
 * complete!", and then either "type next" or "Congratulations on completing all
 * the lessons!". Three problems, all of them visible to the learner:
 *
 *   - a different voice, glued to a reply the AI had just written, regularly
 *     contradicting it — assigning a commitment and then declaring the course over
 *   - it could not tell a finished lesson from a finished course. The branch was
 *     `hasLessonData(n+1)`, so a ONE-lesson course said "all the lessons" on
 *     lesson one: literally true, reads like a bug
 *   - the end of a course is the most personal moment the program has, and it
 *     was a string constant
 *
 * The banner is gone. What replaces it is a fact the AI gets BEFORE it decides
 * to emit the marker — whether another lesson follows — plus instructions for
 * each case. This pins that the two cases really do read differently, which is
 * the whole substance of the change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/lessons/db-lesson-service', () => ({
  getLessonTitle: vi.fn(() => 'A lesson'),
  hasLessonData: vi.fn(),
}));

import { hasLessonData } from '@/lib/lessons/db-lesson-service';
import { buildLessonClosingNote } from '../layers/task';

const mockHasLessonData = hasLessonData as ReturnType<typeof vi.fn>;

/** Lesson 1 of a course whose lesson 2 exists. */
function midCourse() {
  mockHasLessonData.mockImplementation((_key: string, n: number) => n <= 3);
}
/** A course with exactly one lesson — the case that read like a bug. */
function oneLessonCourse() {
  mockHasLessonData.mockImplementation((_key: string, n: number) => n <= 1);
}

const base = { collectionKey: 'pbj', participantNoun: 'participant', language: 'en' as const };

beforeEach(() => vi.clearAllMocks());

describe('buildLessonClosingNote', () => {
  it('points at the next lesson when there is one', () => {
    midCourse();
    const note = buildLessonClosingNote({ ...base, lessonNumber: 1 });

    expect(note).toContain('type "next"');
    expect(note).toContain('lesson 2');
    expect(note).toContain('closes ONE lesson, not the course');
  });

  it('closes the COURSE on the final lesson, and forbids "next"', () => {
    midCourse();
    const note = buildLessonClosingNote({ ...base, lessonNumber: 3 });

    expect(note).toContain('LAST lesson of the course');
    expect(note).toContain('close the COURSE');
    expect(note).toContain('Do NOT tell them to type "next"');
    expect(note).not.toContain('when they want to start lesson');
  });

  it('treats a one-lesson course as a course ending, not a lesson ending', () => {
    // The reported symptom. Lesson 1 of 1 must read as "you finished the
    // course", never as "congratulations on completing all the lessons" bolted
    // onto a reply that just assigned homework.
    oneLessonCourse();
    const note = buildLessonClosingNote({ ...base, lessonNumber: 1 });

    expect(note).toContain('LAST lesson of the course');
    // Matching the bare substring would pass against the PROHIBITION ("Do NOT
    // tell them to type \"next\""), so assert on the instruction's own phrasing.
    expect(note).not.toContain('when they want to start lesson');
    expect(note).toContain('Do NOT tell them to type "next"');
  });

  it('sends the learner to their own next step at course end', () => {
    // A course ending has to point somewhere. The banner pointed nowhere.
    oneLessonCourse();
    const note = buildLessonClosingNote({ ...base, lessonNumber: 1 });

    expect(note).toMatch(/commitment or their project/);
  });

  it('localizes instead of leaking English into a Spanish prompt', () => {
    midCourse();
    const es = buildLessonClosingNote({ ...base, language: 'es', lessonNumber: 1 });
    expect(es).toContain('AL CERRAR LA LECCIÓN');
    expect(es).toContain('siguiente');

    const pt = buildLessonClosingNote({ ...base, language: 'pt', lessonNumber: 1 });
    expect(pt).toContain('AO FECHAR A LIÇÃO');
  });

  it('falls back to English for an unknown language rather than emitting nothing', () => {
    midCourse();
    const note = buildLessonClosingNote({
      ...base,
      language: 'fr' as unknown as 'en',
      lessonNumber: 1,
    });
    expect(note).toContain('WHEN CLOSING THE LESSON');
  });
});
