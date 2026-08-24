/**
 * resolveIntroMessage — B.1 course intro message.
 * ----------------------------------------------------------------------------
 * No legacy behavior to fall back to (unlike resolveDelivery): default is
 * simply "no intro message." Metadata is untrusted, partially-present JSON —
 * must tolerate null/absent metadata and a malformed introMessage shape.
 */
import { describe, it, expect } from 'vitest';
import { resolveIntroMessage } from '../introMessage';

describe('resolveIntroMessage', () => {
  it('returns null when metadata is null', () => {
    expect(resolveIntroMessage(null)).toBeNull();
  });

  it('returns null when metadata is undefined', () => {
    expect(resolveIntroMessage(undefined)).toBeNull();
  });

  it('returns null when metadata has no introMessage key', () => {
    expect(resolveIntroMessage({ title: 'Some Course' })).toBeNull();
  });

  it('returns null when metadata is not a plain object', () => {
    expect(resolveIntroMessage('not an object')).toBeNull();
    expect(resolveIntroMessage(['array'])).toBeNull();
    expect(resolveIntroMessage(42)).toBeNull();
  });

  it('returns null when introMessage fails localizedStringSchema validation', () => {
    expect(resolveIntroMessage({ introMessage: { es: 'Solo español' } })).toBeNull();
    expect(resolveIntroMessage({ introMessage: 'not localized' })).toBeNull();
  });

  it('defaults to en when no language is requested', () => {
    expect(resolveIntroMessage({ introMessage: { en: 'Welcome!' } })).toBe('Welcome!');
  });

  it('resolves the requested language when present', () => {
    expect(resolveIntroMessage({ introMessage: { en: 'Welcome!', es: '¡Bienvenido!' } }, 'es')).toBe('¡Bienvenido!');
  });

  it('falls back to en when the requested language is absent', () => {
    expect(resolveIntroMessage({ introMessage: { en: 'Welcome!' } }, 'pt')).toBe('Welcome!');
  });
});
