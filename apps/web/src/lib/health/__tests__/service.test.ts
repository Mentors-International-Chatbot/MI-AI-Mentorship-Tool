import { computeHealthFromData } from '@/lib/health/service';
import type { HealthReason } from '@/lib/health/service';
import { formatHealthReason } from '@/lib/health/format';
import { getDashboardStrings } from '@/lib/i18n/dashboard';
import type { SocioFlag, SocioProgress } from '@/lib/repo/types';

// Reasons are structured now; these assertions render them in Spanish, which
// keeps the original expectations meaningful AND pins the Spanish wording.
const es = getDashboardStrings('es');
const renderEs = (reason: HealthReason) => formatHealthReason(reason, es);

function makeProgress(overrides: Partial<SocioProgress> = {}): SocioProgress {
  return {
    id: 'prog-1',
    socioId: 'socio-1',
    currentLessonNumber: 1,
    currentMessageIndex: 0,
    completedLessons: [],
    weeklyUnderstanding: null,
    weeklyImplementation: null,
    lastLessonCompletedAt: null,
    remindersSent: 0,
    lastInteractionAt: new Date(),
    ...overrides,
  };
}

function makeFlag(overrides: Partial<SocioFlag> = {}): SocioFlag {
  return {
    id: 'flag-1',
    socioId: 'socio-1',
    level: 'RED',
    reason: 'test',
    source: 'ai_marker',
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    messageId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('computeHealthFromData', () => {
  it('returns GREEN with no flags and recent activity', () => {
    const result = computeHealthFromData([], makeProgress());
    expect(result.status).toBe('GREEN');
    expect(result.reasons.map(renderEs)).toContain('Sin alertas');
  });

  it('returns RED with unresolved RED flag', () => {
    const flags = [makeFlag({ level: 'RED', resolved: false })];
    const result = computeHealthFromData(flags, makeProgress());
    expect(result.status).toBe('RED');
    expect(renderEs(result.reasons[0])).toMatch(/1 alerta\(s\) roja\(s\)/);
  });

  it('returns RED with multiple unresolved RED flags', () => {
    const flags = [
      makeFlag({ id: 'f1', level: 'RED', resolved: false }),
      makeFlag({ id: 'f2', level: 'RED', resolved: false }),
    ];
    const result = computeHealthFromData(flags, makeProgress());
    expect(result.status).toBe('RED');
    expect(renderEs(result.reasons[0])).toMatch(/2 alerta\(s\) roja\(s\)/);
  });

  it('ignores resolved RED flags', () => {
    const flags = [makeFlag({ level: 'RED', resolved: true })];
    const result = computeHealthFromData(flags, makeProgress());
    expect(result.status).toBe('GREEN');
  });

  it('returns RED when inactive > 21 days', () => {
    const lastInteraction = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
    const result = computeHealthFromData([], makeProgress({ lastInteractionAt: lastInteraction }));
    expect(result.status).toBe('RED');
    expect(renderEs(result.reasons[0])).toMatch(/Inactivo por 25 días/);
  });

  it('returns RED when understanding <= 4', () => {
    const result = computeHealthFromData([], makeProgress({ weeklyUnderstanding: 3 }));
    expect(result.status).toBe('RED');
    expect(renderEs(result.reasons[0])).toMatch(/Comprensión baja: 3\/10/);
  });

  it('returns RED when understanding is exactly 4', () => {
    const result = computeHealthFromData([], makeProgress({ weeklyUnderstanding: 4 }));
    expect(result.status).toBe('RED');
  });

  it('returns YELLOW with unresolved YELLOW flag', () => {
    const flags = [makeFlag({ level: 'YELLOW', resolved: false })];
    const result = computeHealthFromData(flags, makeProgress());
    expect(result.status).toBe('YELLOW');
    expect(renderEs(result.reasons[0])).toMatch(/1 alerta\(s\) amarilla\(s\)/);
  });

  it('returns YELLOW when inactive 7-21 days', () => {
    const lastInteraction = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const result = computeHealthFromData([], makeProgress({ lastInteractionAt: lastInteraction }));
    expect(result.status).toBe('YELLOW');
    expect(renderEs(result.reasons[0])).toMatch(/Inactivo por 10 días/);
  });

  it('returns YELLOW when understanding is 5-6', () => {
    const result = computeHealthFromData([], makeProgress({ weeklyUnderstanding: 5 }));
    expect(result.status).toBe('YELLOW');
    expect(renderEs(result.reasons[0])).toMatch(/Comprensión moderada: 5\/10/);
  });

  it('RED flag takes priority over YELLOW conditions', () => {
    const flags = [
      makeFlag({ id: 'f1', level: 'RED', resolved: false }),
      makeFlag({ id: 'f2', level: 'YELLOW', resolved: false }),
    ];
    const result = computeHealthFromData(flags, makeProgress({ weeklyUnderstanding: 5 }));
    expect(result.status).toBe('RED');
    // YELLOW reasons should not appear when RED
    expect(result.reasons.map(renderEs).every((r) => !r.includes('amarilla'))).toBe(true);
    expect(result.reasons.map(renderEs).every((r) => !r.includes('moderada'))).toBe(true);
  });

  it('accumulates multiple RED reasons', () => {
    const flags = [makeFlag({ level: 'RED', resolved: false })];
    const lastInteraction = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = computeHealthFromData(
      flags,
      makeProgress({ lastInteractionAt: lastInteraction, weeklyUnderstanding: 2 }),
    );
    expect(result.status).toBe('RED');
    expect(result.reasons.length).toBe(3);
  });

  it('returns GREEN with null lastInteractionAt', () => {
    const result = computeHealthFromData([], makeProgress({ lastInteractionAt: null }));
    expect(result.status).toBe('GREEN');
  });

  it('returns GREEN with null weeklyUnderstanding', () => {
    const result = computeHealthFromData([], makeProgress({ weeklyUnderstanding: null }));
    expect(result.status).toBe('GREEN');
  });

  it('returns GREEN with high understanding', () => {
    const result = computeHealthFromData([], makeProgress({ weeklyUnderstanding: 8 }));
    expect(result.status).toBe('GREEN');
  });
});
