import { describe, it, expect } from 'vitest';
import { assignZone, buildAlertZones, type ZoneFlagInput, type ZoneSocioInput } from '@/lib/signals/zones';
import type { PositiveSignal } from '@/lib/signals/positive';
import { computeHealthFromData } from '@/lib/health';
import { getDashboardStrings } from '@/lib/i18n/dashboard';
import type { SocioFlag, SocioProgress } from '@/lib/repo/types';

const NOW = new Date('2026-08-03T12:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * MS_PER_DAY);

function makeFlag(overrides: Partial<ZoneFlagInput> = {}): ZoneFlagInput {
  return {
    level: 'RED',
    resolved: false,
    status: 'OPEN',
    snoozedUntil: null,
    reason: 'reason',
    createdAt: NOW,
    ...overrides,
  };
}

function makeProgress(): SocioProgress {
  return {
    id: 'prog-1',
    socioId: 'socio-1',
    currentLessonNumber: 3,
    currentMessageIndex: 0,
    completedLessons: [],
    weeklyUnderstanding: null,
    weeklyImplementation: null,
    lastLessonCompletedAt: null,
    remindersSent: 0,
    lastInteractionAt: NOW,
  };
}

/** Builds a zone input whose health verdict comes from the real health service. */
function makeSocio(
  socioId: string,
  flags: ZoneFlagInput[],
  overrides: Partial<ZoneSocioInput> = {},
): ZoneSocioInput {
  const asSocioFlags = flags.map((f, i): SocioFlag => ({
    id: `${socioId}-flag-${i}`,
    socioId,
    level: f.level as SocioFlag['level'],
    reason: f.reason,
    source: 'sentiment_auto',
    resolved: f.resolved,
    resolvedBy: null,
    resolvedAt: null,
    messageId: null,
    createdAt: f.createdAt,
    reasonCode: null,
    reasonParams: null,
    status: 'OPEN',
    disposition: null,
    snoozedUntil: null,
    occurrenceCount: 1,
    lastOccurredAt: null,
  }));

  return {
    socioId,
    name: socioId,
    curriculumCollectionKey: 'mi-colombia-curriculum',
    currentLesson: 3,
    health: computeHealthFromData(asSocioFlags, makeProgress()),
    flags,
    ...overrides,
  };
}

describe('assignZone', () => {
  it('puts a socio with red AND yellow in zone 1 only — red wins', () => {
    const flags = [
      makeFlag({ level: 'RED' }),
      makeFlag({ level: 'YELLOW' }),
    ];
    expect(assignZone(flags)).toBe('needs_you_now');
  });

  it('puts a socio with yellow only in zone 2', () => {
    expect(assignZone([makeFlag({ level: 'YELLOW' })])).toBe('watching');
  });

  it('assigns no zone when every flag is resolved', () => {
    expect(assignZone([
      makeFlag({ level: 'RED', resolved: true }),
      makeFlag({ level: 'YELLOW', resolved: true }),
    ])).toBeNull();
  });

  it('assigns no zone with no flags at all', () => {
    expect(assignZone([])).toBeNull();
  });
});

describe('buildAlertZones — zone membership', () => {
  it('never places a socio in both zone 1 and zone 2', () => {
    const socio = makeSocio('ana', [
      makeFlag({ level: 'RED' }),
      makeFlag({ level: 'YELLOW' }),
    ]);

    const zones = buildAlertZones([socio], []);

    expect(zones.needsYouNow.map((s) => s.socioId)).toEqual(['ana']);
    expect(zones.watching).toHaveLength(0);
  });

  it('lets a socio appear in zone 3 while also in zone 1', () => {
    // Passing a gate and being in crisis are both true at once. Hiding the
    // win to keep the zones disjoint would hide a real fact.
    const socio = makeSocio('ana', [makeFlag({ level: 'RED' })]);
    const positive: PositiveSignal = {
      socioId: 'ana',
      kind: 'gate_passed_first_try',
      lessonKey: 'assemble-the-sandwich',
      occurredAt: daysAgo(1),
    };

    const zones = buildAlertZones([socio], [positive]);

    expect(zones.needsYouNow.map((s) => s.socioId)).toEqual(['ana']);
    expect(zones.goodNews.map((s) => s.socioId)).toEqual(['ana']);
  });

  it('excludes a socio with no unresolved flags from both zones 1 and 2', () => {
    const zones = buildAlertZones([makeSocio('ok', [makeFlag({ resolved: true })])], []);
    expect(zones.needsYouNow).toHaveLength(0);
    expect(zones.watching).toHaveLength(0);
  });

  it('counts only unresolved flags in signalCount', () => {
    const socio = makeSocio('ana', [
      makeFlag({ level: 'RED' }),
      makeFlag({ level: 'RED' }),
      makeFlag({ level: 'YELLOW' }),
      makeFlag({ level: 'RED', resolved: true }),
    ]);

    const [card] = buildAlertZones([socio], []).needsYouNow;

    expect(card.signalCount).toBe(3);
    expect(card.unresolvedRed).toBe(2);
    expect(card.unresolvedYellow).toBe(1);
  });

  it('carries every unresolved flag reason on the card, newest first', () => {
    const socio = makeSocio('ana', [
      makeFlag({ level: 'RED', reason: 'older', createdAt: daysAgo(5) }),
      makeFlag({ level: 'RED', reason: 'newest', createdAt: daysAgo(1) }),
    ]);

    const [card] = buildAlertZones([socio], []).needsYouNow;

    expect(card.flagReasons).toEqual(['newest', 'older']);
    expect(card.mostRecentSignalAt).toEqual(daysAgo(1));
  });
});

describe('buildAlertZones — sorting', () => {
  it('sorts each zone by most recent signal', () => {
    const socios = [
      makeSocio('old', [makeFlag({ level: 'RED', createdAt: daysAgo(10) })]),
      makeSocio('new', [makeFlag({ level: 'RED', createdAt: daysAgo(1) })]),
      makeSocio('mid', [makeFlag({ level: 'RED', createdAt: daysAgo(5) })]),
      makeSocio('y-old', [makeFlag({ level: 'YELLOW', createdAt: daysAgo(9) })]),
      makeSocio('y-new', [makeFlag({ level: 'YELLOW', createdAt: daysAgo(2) })]),
    ];

    const zones = buildAlertZones(socios, []);

    expect(zones.needsYouNow.map((s) => s.socioId)).toEqual(['new', 'mid', 'old']);
    expect(zones.watching.map((s) => s.socioId)).toEqual(['y-new', 'y-old']);
  });
});

describe('zone 2 is labelled "Watching", not "AI is handling"', () => {
  // The AI never learns a flag fired: SocioFlag has no read path in any prompt
  // layer, and the dimension map the AI does see carries no counterpart to
  // urgency, distress, or frustration. "AI is handling" would be a fiction.
  // If someone wires flags into the prompt, this test should be the thing that
  // makes them change the label deliberately.
  it.each(['es', 'en', 'pt'] as const)('%s says watching, never handling', (lang) => {
    const t = getDashboardStrings(lang);
    const label = t.zoneWatchingTitle.toLowerCase();

    expect(label).not.toContain('ai');
    expect(label).not.toContain('handling');
    expect(label).not.toContain('atendiendo');
    expect(label).not.toContain('gestionando');
  });

  it('uses the watching wording in each language', () => {
    expect(getDashboardStrings('en').zoneWatchingTitle).toBe('Watching');
    expect(getDashboardStrings('es').zoneWatchingTitle).toBe('En observación');
    expect(getDashboardStrings('pt').zoneWatchingTitle).toBe('Em observação');
  });
});
