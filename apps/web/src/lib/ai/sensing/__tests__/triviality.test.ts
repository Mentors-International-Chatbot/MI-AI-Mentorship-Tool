import { describe, it, expect } from 'vitest';
import { isTrivialMessage } from '../triviality';

describe('isTrivialMessage', () => {
  describe('chat mode', () => {
    it('skips bare acknowledgments in English and Spanish', () => {
      for (const t of ['ok', 'Okay', 'yes', 'sure', 'sí', 'vale', 'dale', 'listo', 'got it']) {
        expect(isTrivialMessage(t, 'chat'), t).toBe(true);
      }
    });

    it('skips messages under four words', () => {
      expect(isTrivialMessage('no entiendo bien', 'chat')).toBe(true);
      expect(isTrivialMessage('siguiente por favor', 'chat')).toBe(true);
    });

    it('senses substantive messages', () => {
      expect(
        isTrivialMessage('No entiendo bien cómo separar el dinero del negocio', 'chat'),
      ).toBe(false);
    });

    it('ignores surrounding punctuation and case', () => {
      expect(isTrivialMessage('  OK!  ', 'chat')).toBe(true);
      expect(isTrivialMessage('¿Sí?', 'chat')).toBe(true);
    });
  });

  describe('assessment mode', () => {
    it('still skips bare acknowledgments', () => {
      expect(isTrivialMessage('ok', 'assessment')).toBe(true);
      expect(isTrivialMessage('listo', 'assessment')).toBe(true);
    });

    it('does NOT skip a terse but real explanation', () => {
      // Under four words, so chat mode would skip it - the assessment must not,
      // because this message is the thing being graded.
      expect(isTrivialMessage('separate slices first', 'assessment')).toBe(false);
      expect(isTrivialMessage('separate slices first', 'chat')).toBe(true);
    });

    it('skips empty or near-empty input', () => {
      expect(isTrivialMessage('', 'assessment')).toBe(true);
      expect(isTrivialMessage('hi', 'assessment')).toBe(true);
    });
  });
});
