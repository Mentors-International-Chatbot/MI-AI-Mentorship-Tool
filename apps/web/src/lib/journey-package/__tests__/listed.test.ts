/**
 * resolveListed — D4 course-listing flag.
 * ----------------------------------------------------------------------------
 * Default true; MI2024 is the one deliberate exception. Metadata is
 * untrusted, partially-present JSON — this must tolerate null/absent
 * metadata exactly like resolveDelivery does, since that's the real shape of
 * both MI2024's and pbj-basics's ProgramVersion.metadata today.
 */
import { describe, it, expect } from 'vitest';
import { resolveListed } from '../listed';

describe('resolveListed', () => {
  it('defaults to true when metadata is null', () => {
    expect(resolveListed(null)).toBe(true);
  });

  it('defaults to true when metadata is undefined', () => {
    expect(resolveListed(undefined)).toBe(true);
  });

  it('defaults to true when metadata has no listed key', () => {
    expect(resolveListed({ title: 'Some Course' })).toBe(true);
  });

  it('defaults to true when metadata is not a plain object', () => {
    expect(resolveListed('not an object')).toBe(true);
    expect(resolveListed(['array'])).toBe(true);
    expect(resolveListed(42)).toBe(true);
  });

  it('returns false only when listed is exactly false', () => {
    expect(resolveListed({ listed: false })).toBe(false);
  });

  it('returns true when listed is explicitly true', () => {
    expect(resolveListed({ listed: true })).toBe(true);
  });

  it('treats a non-boolean listed value as absent (defaults true)', () => {
    expect(resolveListed({ listed: 'false' })).toBe(true);
  });
});
