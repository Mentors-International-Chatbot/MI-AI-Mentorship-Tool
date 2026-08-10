/**
 * Assessment closing lines must exist in every language
 * ═══════════════════════════════════════════════════════════════════════════
 * These four were English string literals inside
 * `/api/assessment/[sessionId]/complete` until 2026-08-09. A Spanish-speaking
 * learner finished a Spanish assessment and was told "Congratulations! You've
 * successfully completed this assessment." in English.
 *
 * That is the failure this file guards: not a missing key, which TypeScript
 * catches, but a key present and filled with the wrong language, which nothing
 * catches. A copy-paste of the `en` block into `pt` typechecks perfectly.
 */
import { describe, it, expect } from 'vitest';
import { ASSESSMENT_STRINGS, PROGRESS_STRINGS, SUPPORTED_LANGUAGES } from '../languages';

const CLOSING_KEYS = [
  'completedPassed',
  'completedNotPassed',
  'completedReteach',
  'completedCancelled',
] as const;

describe('assessment closing strings', () => {
  it('defines every closing line for every supported language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      for (const key of CLOSING_KEYS) {
        const value = ASSESSMENT_STRINGS[lang][key];
        expect(value, `${lang}.${key}`).toBeTruthy();
        expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('does not reuse one language\'s wording in another', () => {
    // The copy-paste failure. Each language's set must be distinct from the
    // others', which is the cheapest available proxy for "actually translated".
    for (const key of CLOSING_KEYS) {
      const values = SUPPORTED_LANGUAGES.map((l) => ASSESSMENT_STRINGS[l][key]);
      expect(new Set(values).size, `${key} is identical across languages`).toBe(values.length);
    }
  });

  it('leaves congratulating and redirecting to the AI follow-up turn', () => {
    // These lines close the ASSESSMENT. The conversational half — celebrating
    // and pointing at what comes next — belongs to the AI's turn, and two
    // voices doing that job is what this whole change removed. A closing line
    // that starts telling the learner what to do next is the regression.
    for (const lang of SUPPORTED_LANGUAGES) {
      const passed = ASSESSMENT_STRINGS[lang].completedPassed;
      expect(passed.toLowerCase(), lang).not.toMatch(/next lesson|próxima lección|siguiente lección/);
    }
  });
});

describe('progress panel strings', () => {
  const PLAIN_KEYS = [
    'heading', 'gateHeading', 'gateNotReached', 'gatePassed', 'gateNotPassed',
    'projectHeading', 'milestoneDone', 'milestonePending', 'toggleLabel',
  ] as const;

  it('defines every panel label for every supported language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      for (const key of PLAIN_KEYS) {
        expect(PROGRESS_STRINGS[lang][key], `${lang}.${key}`).toBeTruthy();
      }
    }
  });

  it('formats the counters with the numbers it is given', () => {
    // The panel is the answer to "how far along am I", so a formatter that
    // drops one of its arguments is the one bug that empties the feature.
    for (const lang of SUPPORTED_LANGUAGES) {
      const t = PROGRESS_STRINGS[lang];
      expect(t.lessonOf(2, 7), `${lang}.lessonOf`).toContain('2');
      expect(t.lessonOf(2, 7), `${lang}.lessonOf`).toContain('7');
      expect(t.partOf(3, 5), `${lang}.partOf`).toContain('3');
      expect(t.partOf(3, 5), `${lang}.partOf`).toContain('5');
    }
  });

  it('distinguishes the three gate states in every language', () => {
    // "Not yet reached" and "not passed" collapsing into one label would tell a
    // learner they failed something they have not attempted.
    for (const lang of SUPPORTED_LANGUAGES) {
      const t = PROGRESS_STRINGS[lang];
      const states = [t.gateNotReached, t.gatePassed, t.gateNotPassed];
      expect(new Set(states).size, lang).toBe(3);
    }
  });
});
