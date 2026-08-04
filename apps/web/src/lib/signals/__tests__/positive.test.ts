import { describe, it, expect } from 'vitest';
import {
  derivePositiveSignals,
  POSITIVE_SIGNAL_LIMIT,
  type PositiveSignal,
  type PositiveSignalKind,
  type PositiveSignalSource,
} from '@/lib/signals/positive';
import { formatPositiveSignal, positiveSignalIcon } from '@/lib/signals/format';
import { getDashboardStrings } from '@/lib/i18n/dashboard';

const NOW = new Date('2026-08-03T12:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * MS_PER_DAY);

function makeSource(overrides: Partial<PositiveSignalSource> = {}): PositiveSignalSource {
  return {
    socioId: 'socio-1',
    assessmentSessions: [],
    lessonProgress: [],
    userMessageDates: [],
    sentiments: [],
    ...overrides,
  };
}

describe('derivePositiveSignals — each kind derives from its source', () => {
  it('derives gate_passed_first_try from a first-attempt session with passedAt', () => {
    const signals = derivePositiveSignals([
      makeSource({
        assessmentSessions: [
          { lessonKey: 'assemble-the-sandwich', attemptNumber: 1, passedAt: daysAgo(1) },
        ],
      }),
    ], NOW);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      kind: 'gate_passed_first_try',
      lessonKey: 'assemble-the-sandwich',
      socioId: 'socio-1',
    });
  });

  it('does not treat a completed-but-failed gate as good news', () => {
    // A session can be `completed` with passedAt null. That is a failed gate.
    const signals = derivePositiveSignals([
      makeSource({
        assessmentSessions: [
          { lessonKey: 'assemble-the-sandwich', attemptNumber: 1, passedAt: null },
        ],
      }),
    ], NOW);

    expect(signals).toHaveLength(0);
  });

  it('does not treat a second-attempt pass as first-try', () => {
    const signals = derivePositiveSignals([
      makeSource({
        assessmentSessions: [
          { lessonKey: 'assemble-the-sandwich', attemptNumber: 2, passedAt: daysAgo(1) },
        ],
      }),
    ], NOW);

    expect(signals).toHaveLength(0);
  });

  it('derives lesson_completed inside the 7-day window and ignores older ones', () => {
    const signals = derivePositiveSignals([
      makeSource({
        lessonProgress: [
          { lessonNumber: 4, completedAt: daysAgo(2) },
          { lessonNumber: 3, completedAt: daysAgo(30) },
          { lessonNumber: 5, completedAt: null },
        ],
      }),
    ], NOW);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: 'lesson_completed', lessonNumber: 4 });
  });

  it('derives returned_after_quiet from a 14+ day gap between messages', () => {
    const signals = derivePositiveSignals([
      makeSource({ userMessageDates: [daysAgo(40), daysAgo(3)] }),
    ], NOW);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: 'returned_after_quiet', daysQuiet: 37 });
    expect((signals[0] as Extract<PositiveSignal, { kind: 'returned_after_quiet' }>).occurredAt)
      .toEqual(daysAgo(3));
  });

  it('does not derive returned_after_quiet from a gap under the threshold', () => {
    const signals = derivePositiveSignals([
      makeSource({ userMessageDates: [daysAgo(20), daysAgo(8)] }),
    ], NOW);

    expect(signals).toHaveLength(0);
  });

  it('derives sustained_positive from 3+ positives with no negatives', () => {
    const signals = derivePositiveSignals([
      makeSource({
        sentiments: [
          { sentiment: 'positive', createdAt: daysAgo(1) },
          { sentiment: 'positive', createdAt: daysAgo(3) },
          { sentiment: 'positive', createdAt: daysAgo(5) },
          { sentiment: 'neutral', createdAt: daysAgo(6) },
        ],
      }),
    ], NOW);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: 'sustained_positive', positiveCount: 3 });
  });

  it('suppresses sustained_positive when a distressed message is in the window', () => {
    // Four good messages and one crisis is not a good week, and the flag
    // pipeline has already raised the crisis separately.
    const signals = derivePositiveSignals([
      makeSource({
        sentiments: [
          { sentiment: 'positive', createdAt: daysAgo(1) },
          { sentiment: 'positive', createdAt: daysAgo(2) },
          { sentiment: 'positive', createdAt: daysAgo(3) },
          { sentiment: 'distressed', createdAt: daysAgo(4) },
        ],
      }),
    ], NOW);

    expect(signals).toHaveLength(0);
  });

  it('ignores sentiment outside the 14-day window', () => {
    const signals = derivePositiveSignals([
      makeSource({
        sentiments: [
          { sentiment: 'positive', createdAt: daysAgo(20) },
          { sentiment: 'positive', createdAt: daysAgo(21) },
          { sentiment: 'positive', createdAt: daysAgo(22) },
        ],
      }),
    ], NOW);

    expect(signals).toHaveLength(0);
  });
});

describe('derivePositiveSignals — empty sources', () => {
  it('yields no signals rather than throwing when every source is empty', () => {
    expect(() => derivePositiveSignals([makeSource()], NOW)).not.toThrow();
    expect(derivePositiveSignals([makeSource()], NOW)).toEqual([]);
  });

  it('yields no signals for an empty socio list', () => {
    expect(derivePositiveSignals([], NOW)).toEqual([]);
  });

  it('handles a single message with no prior message', () => {
    // No pair to compare, so no gap. Must not read index -1.
    expect(derivePositiveSignals([
      makeSource({ userMessageDates: [daysAgo(1)] }),
    ], NOW)).toEqual([]);
  });
});

describe('derivePositiveSignals — cap and ordering', () => {
  it('caps at 10 and keeps the most recent, newest first', () => {
    // 15 completions, 1 through 15 days ago. Only the 7-day window qualifies
    // for lesson_completed, so pad with gate passes to exceed the cap.
    const source = makeSource({
      assessmentSessions: Array.from({ length: 15 }, (_, i) => ({
        lessonKey: `lesson-${i}`,
        attemptNumber: 1,
        passedAt: daysAgo(i + 1),
      })),
    });

    const signals = derivePositiveSignals([source], NOW);

    expect(signals).toHaveLength(POSITIVE_SIGNAL_LIMIT);
    // Newest first
    for (let i = 1; i < signals.length; i++) {
      expect(signals[i - 1].occurredAt.getTime()).toBeGreaterThanOrEqual(
        signals[i].occurredAt.getTime(),
      );
    }
    // The oldest five were dropped, not the newest five
    expect(signals[0]).toMatchObject({ lessonKey: 'lesson-0' });
    expect(signals[9]).toMatchObject({ lessonKey: 'lesson-9' });
  });

  it('caps across socios, not per socio', () => {
    const sources = Array.from({ length: 4 }, (_, s) =>
      makeSource({
        socioId: `socio-${s}`,
        assessmentSessions: Array.from({ length: 5 }, (_, i) => ({
          lessonKey: `l-${s}-${i}`,
          attemptNumber: 1,
          passedAt: daysAgo(s * 5 + i + 1),
        })),
      }),
    );

    const signals = derivePositiveSignals(sources, NOW);

    expect(signals).toHaveLength(POSITIVE_SIGNAL_LIMIT);
    // socio-0 and socio-1 hold the 10 newest; socio-3's are all older.
    expect(signals.every((s) => s.socioId !== 'socio-3')).toBe(true);
  });
});

describe('formatPositiveSignal', () => {
  const KINDS: PositiveSignalKind[] = [
    'gate_passed_first_try',
    'lesson_completed',
    'returned_after_quiet',
    'sustained_positive',
  ];

  const samples: Record<PositiveSignalKind, PositiveSignal> = {
    gate_passed_first_try: {
      socioId: 's', kind: 'gate_passed_first_try', lessonKey: 'k', occurredAt: NOW,
    },
    lesson_completed: {
      socioId: 's', kind: 'lesson_completed', lessonNumber: 3, occurredAt: NOW,
    },
    returned_after_quiet: {
      socioId: 's', kind: 'returned_after_quiet', daysQuiet: 21, occurredAt: NOW,
    },
    sustained_positive: {
      socioId: 's', kind: 'sustained_positive', positiveCount: 4, occurredAt: NOW,
    },
  };

  it.each(['es', 'en', 'pt'] as const)('renders every kind non-empty in %s', (lang) => {
    const t = getDashboardStrings(lang);
    for (const kind of KINDS) {
      const rendered = formatPositiveSignal(samples[kind], t);
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered).not.toContain('undefined');
    }
  });

  it('gives every kind a distinct icon', () => {
    const icons = KINDS.map((k) => positiveSignalIcon(samples[k]));
    expect(new Set(icons).size).toBe(KINDS.length);
  });
});
