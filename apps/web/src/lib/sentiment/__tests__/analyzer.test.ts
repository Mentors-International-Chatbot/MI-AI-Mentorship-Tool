import { clamp, validateSentiment } from '@/lib/sentiment/analyzer';

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to min when below range', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('clamps to max when above range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns min when value equals min', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it('returns max when value equals max', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('handles negative ranges', () => {
    expect(clamp(-5, -10, -1)).toBe(-5);
  });

  it('clamps to min with negative range', () => {
    expect(clamp(-15, -10, -1)).toBe(-10);
  });

  it('handles zero range', () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });
});

describe('validateSentiment', () => {
  it('accepts "positive"', () => {
    expect(validateSentiment('positive')).toBe('positive');
  });

  it('accepts "neutral"', () => {
    expect(validateSentiment('neutral')).toBe('neutral');
  });

  it('accepts "negative"', () => {
    expect(validateSentiment('negative')).toBe('negative');
  });

  it('accepts "distressed"', () => {
    expect(validateSentiment('distressed')).toBe('distressed');
  });

  it('returns "neutral" for unknown string', () => {
    expect(validateSentiment('happy')).toBe('neutral');
  });

  it('returns "neutral" for null', () => {
    expect(validateSentiment(null)).toBe('neutral');
  });

  it('returns "neutral" for undefined', () => {
    expect(validateSentiment(undefined)).toBe('neutral');
  });

  it('returns "neutral" for number', () => {
    expect(validateSentiment(42)).toBe('neutral');
  });

  it('returns "neutral" for empty string', () => {
    expect(validateSentiment('')).toBe('neutral');
  });
});
