/**
 * Grouping logic behind the mentor learner-detail activity strip.
 *
 * Motivated by a production case (ai-essentials-aug2026, 2026-08-28): a
 * learner completed 5 blocks across a lesson in ~7 minutes but only 1 of
 * those turns went through POST /api/chat, so `messages` had at most one row
 * for that stretch and the mentor transcript looked frozen. `buildActivityStrip`
 * is deliberately blind to `messages` — it only ever sees BlockProgress — so
 * this asserts the activity it renders doesn't depend on how many chat
 * messages happened to land alongside it.
 */
import { describe, it, expect } from 'vitest';
import { buildActivityStrip, type BlockProgressRow } from '../blockActivity';

function row(overrides: Partial<BlockProgressRow> & Pick<BlockProgressRow, 'blockId' | 'completedAt'>): BlockProgressRow {
  return { lessonKey: 'lesson-1', ...overrides };
}

describe('buildActivityStrip', () => {
  it('renders visible activity for an enrollment with several completed blocks and no matching messages', () => {
    // Mirrors the production timeline: 5 blocks completed across lesson-1,
    // only one of which (b1-1) would have produced a `messages` row.
    const rows: BlockProgressRow[] = [
      row({ blockId: 'b0-2', completedAt: new Date('2026-08-28T00:08:46Z') }),
      row({ blockId: 'b1-1', completedAt: new Date('2026-08-28T00:12:12Z') }),
      row({ blockId: 'b1-2', completedAt: new Date('2026-08-28T00:13:38Z') }),
      row({ blockId: 'b1-3', completedAt: new Date('2026-08-28T00:14:54Z') }),
      row({ blockId: 'b1-3b', completedAt: new Date('2026-08-28T00:15:54Z') }),
    ];

    const strip = buildActivityStrip(rows, new Map([['lesson-1', 5]]));

    expect(strip).not.toBeNull();
    expect(strip?.lessons).toHaveLength(1);
    expect(strip?.lessons[0]).toEqual({
      lessonKey: 'lesson-1',
      completed: 5,
      total: 5,
      lastActivityAt: '2026-08-28T00:15:54.000Z',
    });
  });

  it('returns null when there is no completed block progress', () => {
    expect(buildActivityStrip([], new Map())).toBeNull();
  });

  it('falls back to a null total when the lesson content lookup failed', () => {
    const rows: BlockProgressRow[] = [row({ blockId: 'b1', completedAt: new Date('2026-08-28T00:00:00Z') })];

    const strip = buildActivityStrip(rows, new Map([['lesson-1', null]]));

    expect(strip?.lessons[0].total).toBeNull();
    expect(strip?.lessons[0].completed).toBe(1);
  });

  it('sorts lessons most-recently-active first and dedupes repeated block ids', () => {
    const rows: BlockProgressRow[] = [
      row({ lessonKey: 'lesson-1', blockId: 'a', completedAt: new Date('2026-08-28T00:00:00Z') }),
      row({ lessonKey: 'lesson-2', blockId: 'a', completedAt: new Date('2026-08-28T00:10:00Z') }),
      // Same lesson+block seen twice — completed count must not double-count it.
      row({ lessonKey: 'lesson-1', blockId: 'a', completedAt: new Date('2026-08-28T00:05:00Z') }),
    ];

    const strip = buildActivityStrip(rows, new Map());

    expect(strip?.lessons.map((l) => l.lessonKey)).toEqual(['lesson-2', 'lesson-1']);
    expect(strip?.lessons.find((l) => l.lessonKey === 'lesson-1')?.completed).toBe(1);
  });
});
