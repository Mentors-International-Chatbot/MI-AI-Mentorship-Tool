import { getConcisivenessInstruction, buildSliderSnippet } from '@/lib/ai/prompts/layers/core';
import { MAX_SENTENCES_PER_MESSAGE } from '@/lib/ai/prompts/constants';

describe('getConcisivenessInstruction', () => {
  it('returns very_brief instruction', () => {
    const result = getConcisivenessInstruction('very_brief');
    expect(result).toContain('Máximo 2 oraciones');
  });

  it('returns brief instruction', () => {
    const result = getConcisivenessInstruction('brief');
    expect(result).toContain('Máximo 3 oraciones');
  });

  it('returns standard instruction with default sentence limit', () => {
    const result = getConcisivenessInstruction('standard');
    expect(result).toContain(`Máximo ${MAX_SENTENCES_PER_MESSAGE} oraciones`);
  });

  it('returns detailed instruction', () => {
    const result = getConcisivenessInstruction('detailed');
    expect(result).toContain('hasta 6 oraciones');
  });

  it('returns very_detailed instruction', () => {
    const result = getConcisivenessInstruction('very_detailed');
    expect(result).toContain('hasta 8 oraciones');
  });

  it('returns standard instruction for undefined', () => {
    const result = getConcisivenessInstruction(undefined);
    expect(result).toContain(`Máximo ${MAX_SENTENCES_PER_MESSAGE} oraciones`);
  });
});

describe('buildSliderSnippet', () => {
  it('returns empty string when no overrides', () => {
    expect(buildSliderSnippet()).toBe('');
    expect(buildSliderSnippet(undefined)).toBe('');
  });

  it('returns empty string when overrides have no sliders', () => {
    expect(buildSliderSnippet({})).toBe('');
  });

  it('returns empty string when sliders are mid-range', () => {
    expect(buildSliderSnippet({ complexity: 0.5, warmth: 0.5, positivity: 0.5 })).toBe('');
  });

  it('adds simple language for low complexity', () => {
    const result = buildSliderSnippet({ complexity: 0.1 });
    expect(result).toContain('sencillo');
  });

  it('adds technical language for high complexity', () => {
    const result = buildSliderSnippet({ complexity: 0.8 });
    expect(result).toContain('técnico');
  });

  it('adds directness for low warmth', () => {
    const result = buildSliderSnippet({ warmth: 0.1 });
    expect(result).toContain('directo');
  });

  it('adds extra warmth for high warmth', () => {
    const result = buildSliderSnippet({ warmth: 0.9 });
    expect(result).toContain('cálido');
  });

  it('adds realism for low positivity', () => {
    const result = buildSliderSnippet({ positivity: 0.1 });
    expect(result).toContain('realista');
  });

  it('adds positivity focus for high positivity', () => {
    const result = buildSliderSnippet({ positivity: 0.9 });
    expect(result).toContain('positivo');
  });

  it('combines multiple slider adjustments', () => {
    const result = buildSliderSnippet({ complexity: 0.1, warmth: 0.9, positivity: 0.9 });
    expect(result).toContain('sencillo');
    expect(result).toContain('cálido');
    expect(result).toContain('positivo');
    expect(result).toContain('AJUSTES DEL MENTOR');
  });

  it('does not trigger at boundary values (0.33 and 0.66)', () => {
    expect(buildSliderSnippet({ complexity: 0.33 })).toBe('');
    expect(buildSliderSnippet({ complexity: 0.66 })).toBe('');
    expect(buildSliderSnippet({ warmth: 0.33 })).toBe('');
    expect(buildSliderSnippet({ warmth: 0.66 })).toBe('');
    expect(buildSliderSnippet({ positivity: 0.33 })).toBe('');
    expect(buildSliderSnippet({ positivity: 0.66 })).toBe('');
  });
});
