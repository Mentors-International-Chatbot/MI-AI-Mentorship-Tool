/**
 * formatHealthReason — Spanish output is a provable no-op
 * ----------------------------------------------------------------------------
 * Health reasons used to be composed as finished Spanish strings in the data
 * layer, which is why they ignored the dashboard language. Moving composition
 * to the render layer must not change what MI's current (Spanish) users see.
 *
 * The LEGACY_ES literals below are copied from the pre-change
 * computeHealthFromData template strings. If a Spanish string here needs
 * editing, that is a deliberate copy change — not something to "fix" so a test
 * goes green.
 */
import { describe, it, expect } from 'vitest';
import { formatHealthReason } from '../format';
import type { HealthReason } from '../service';
import { getDashboardStrings } from '@/lib/i18n/dashboard';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n/languages';

const es = getDashboardStrings('es');
const en = getDashboardStrings('en');
const pt = getDashboardStrings('pt');

/** Every case computeHealthFromData can produce, with its exact legacy text. */
const LEGACY_ES: ReadonlyArray<{ reason: HealthReason; text: string }> = [
  {
    reason: { kind: 'unresolved_alerts', count: 1, severity: 'red' },
    text: '1 alerta(s) roja(s) sin resolver',
  },
  {
    reason: { kind: 'unresolved_alerts', count: 4, severity: 'red' },
    text: '4 alerta(s) roja(s) sin resolver',
  },
  {
    reason: { kind: 'unresolved_alerts', count: 1, severity: 'yellow' },
    text: '1 alerta(s) amarilla(s) sin resolver',
  },
  {
    reason: { kind: 'unresolved_alerts', count: 4, severity: 'yellow' },
    text: '4 alerta(s) amarilla(s) sin resolver',
  },
  { reason: { kind: 'inactive', days: 1 }, text: 'Inactivo por 1 días' },
  { reason: { kind: 'inactive', days: 112 }, text: 'Inactivo por 112 días' },
  { reason: { kind: 'low_understanding', score: 3 }, text: 'Comprensión baja: 3/10' },
  { reason: { kind: 'moderate_understanding', score: 5 }, text: 'Comprensión moderada: 5/10' },
  { reason: { kind: 'none' }, text: 'Sin alertas' },
];

describe('formatHealthReason — Spanish is byte-identical to the previous output', () => {
  for (const { reason, text } of LEGACY_ES) {
    const label = reason.kind === 'unresolved_alerts'
      ? `${reason.kind}/${reason.severity}/${reason.count}`
      : reason.kind;

    it(`renders ${label} exactly as before`, () => {
      expect(formatHealthReason(reason, es)).toBe(text);
    });
  }

  it('keeps the "(s)" convention in Spanish, including the singular case', () => {
    // Deliberate: MI users see "1 alerta(s)" today and this change must not
    // alter that. Real pluralisation is an en/pt-only improvement.
    expect(formatHealthReason({ kind: 'unresolved_alerts', count: 1, severity: 'red' }, es)).toContain(
      'alerta(s)',
    );
  });

  it('keeps the grammatically-wrong Spanish singular "1 días"', () => {
    // Also deliberate. The old template had no singular branch; fixing it here
    // would be an unrequested copy change to live MI output.
    expect(formatHealthReason({ kind: 'inactive', days: 1 }, es)).toBe('Inactivo por 1 días');
  });
});

describe('formatHealthReason — English uses real plurals', () => {
  it('singular red alert', () => {
    expect(formatHealthReason({ kind: 'unresolved_alerts', count: 1, severity: 'red' }, en)).toBe(
      '1 unresolved red alert',
    );
  });

  it('plural red alerts', () => {
    expect(formatHealthReason({ kind: 'unresolved_alerts', count: 4, severity: 'red' }, en)).toBe(
      '4 unresolved red alerts',
    );
  });

  it('singular yellow alert', () => {
    expect(formatHealthReason({ kind: 'unresolved_alerts', count: 1, severity: 'yellow' }, en)).toBe(
      '1 unresolved yellow alert',
    );
  });

  it('plural yellow alerts', () => {
    expect(formatHealthReason({ kind: 'unresolved_alerts', count: 4, severity: 'yellow' }, en)).toBe(
      '4 unresolved yellow alerts',
    );
  });

  it('singular and plural days', () => {
    expect(formatHealthReason({ kind: 'inactive', days: 1 }, en)).toBe('Inactive for 1 day');
    expect(formatHealthReason({ kind: 'inactive', days: 112 }, en)).toBe('Inactive for 112 days');
  });

  it('never emits the "(s)" convention', () => {
    for (const { reason } of LEGACY_ES) {
      expect(formatHealthReason(reason, en)).not.toContain('(s)');
    }
  });
});

describe('formatHealthReason — Portuguese uses real plurals', () => {
  it('singular and plural red alerts', () => {
    expect(formatHealthReason({ kind: 'unresolved_alerts', count: 1, severity: 'red' }, pt)).toBe(
      '1 alerta vermelho não resolvido',
    );
    expect(formatHealthReason({ kind: 'unresolved_alerts', count: 4, severity: 'red' }, pt)).toBe(
      '4 alertas vermelhos não resolvidos',
    );
  });

  it('singular and plural yellow alerts', () => {
    expect(formatHealthReason({ kind: 'unresolved_alerts', count: 1, severity: 'yellow' }, pt)).toBe(
      '1 alerta amarelo não resolvido',
    );
    expect(formatHealthReason({ kind: 'unresolved_alerts', count: 4, severity: 'yellow' }, pt)).toBe(
      '4 alertas amarelos não resolvidos',
    );
  });

  it('singular and plural days', () => {
    expect(formatHealthReason({ kind: 'inactive', days: 1 }, pt)).toBe('Inativo há 1 dia');
    expect(formatHealthReason({ kind: 'inactive', days: 112 }, pt)).toBe('Inativo há 112 dias');
  });

  it('never emits the "(s)" convention', () => {
    for (const { reason } of LEGACY_ES) {
      expect(formatHealthReason(reason, pt)).not.toContain('(s)');
    }
  });
});

describe('formatHealthReason — every language covers every kind', () => {
  it('returns a non-empty string for all kinds in all supported languages', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const strings = getDashboardStrings(lang);
      for (const { reason } of LEGACY_ES) {
        const rendered = formatHealthReason(reason, strings);
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered).not.toContain('undefined');
      }
    }
  });
});
