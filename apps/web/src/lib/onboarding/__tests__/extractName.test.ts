import { isValid, regexFallback } from '@/lib/onboarding/extractName';

describe('isValid', () => {
  it('accepts a normal name', () => {
    expect(isValid('María')).toBe(true);
  });

  it('accepts a full name', () => {
    expect(isValid('Carlos Andrés López')).toBe(true);
  });

  it('rejects names shorter than 2 characters', () => {
    expect(isValid('A')).toBe(false);
  });

  it('accepts exactly 2 character name', () => {
    expect(isValid('Lu')).toBe(true);
  });

  it('rejects names longer than 60 characters', () => {
    expect(isValid('A'.repeat(61))).toBe(false);
  });

  it('accepts exactly 60 character name', () => {
    expect(isValid('A'.repeat(60))).toBe(true);
  });

  it('rejects all-digit strings', () => {
    expect(isValid('12345')).toBe(false);
  });

  it('accepts names with digits mixed in', () => {
    expect(isValid('Juan3')).toBe(true);
  });

  it('rejects URLs with http', () => {
    expect(isValid('http://example.com')).toBe(false);
  });

  it('rejects URLs with https', () => {
    expect(isValid('https://google.com')).toBe(false);
  });

  it('rejects URLs with www', () => {
    expect(isValid('www.example.com')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValid('')).toBe(false);
  });
});

describe('regexFallback', () => {
  describe('Spanish (es)', () => {
    it('extracts name from "me llamo X"', () => {
      expect(regexFallback('Me llamo Carlos', 'es')).toBe('Carlos');
    });

    it('extracts full name from "me llamo X Y"', () => {
      expect(regexFallback('Me llamo María García', 'es')).toBe('María García');
    });

    it('extracts name from "mi nombre es X"', () => {
      expect(regexFallback('Mi nombre es Ana', 'es')).toBe('Ana');
    });

    it('extracts name from "soy X"', () => {
      expect(regexFallback('Soy Pedro', 'es')).toBe('Pedro');
    });

    it('extracts bare name (just a capitalized word)', () => {
      expect(regexFallback('María', 'es')).toBe('María');
    });

    it('extracts bare full name', () => {
      expect(regexFallback('Juan Pablo', 'es')).toBe('Juan Pablo');
    });

    it('returns null for unrecognizable input', () => {
      expect(regexFallback('no sé qué decir', 'es')).toBeNull();
    });

    it('returns null for just digits', () => {
      expect(regexFallback('12345', 'es')).toBeNull();
    });
  });

  describe('English (en)', () => {
    it('extracts name from "my name is X"', () => {
      expect(regexFallback('My name is John', 'en')).toBe('John');
    });

    it('extracts name from "I\'m X"', () => {
      expect(regexFallback("I'm Sarah", 'en')).toBe('Sarah');
    });

    it('extracts name from "call me X"', () => {
      expect(regexFallback('Call me Mike', 'en')).toBe('Mike');
    });
  });

  describe('Portuguese (pt)', () => {
    it('extracts name from "meu nome é X"', () => {
      expect(regexFallback('Meu nome é João', 'pt')).toBe('João');
    });

    it('extracts name from "me chamo X"', () => {
      expect(regexFallback('Me chamo Ana', 'pt')).toBe('Ana');
    });
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      expect(regexFallback('', 'es')).toBeNull();
    });

    it('handles names with accented characters', () => {
      expect(regexFallback('Me llamo José Ángel', 'es')).toBe('José Ángel');
    });
  });
});
