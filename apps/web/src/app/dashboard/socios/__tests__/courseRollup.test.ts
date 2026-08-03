/**
 * Per-course rollups for the socios list.
 *
 * These cover the arithmetic and the grouping rules, which is where the numbers
 * a mentor reads off the cards can go wrong. The card markup is not asserted
 * here — the repo has no DOM test environment — so the two view-shaped rules
 * (which pills render, which rows survive the filters) are tested through the
 * pure helpers the component actually calls.
 */
import { describe, it, expect } from 'vitest';
import type { SocioHealth } from '@/lib/health';
import type { CourseSummary } from '@/lib/journey-package/course-summaries';
import {
  buildCourseRollups,
  courseAlertPills,
  matchesFilters,
  UNASSIGNED_COURSE_KEY,
  type SocioRow,
} from '../courseRollup';

const MI = 'mi-colombia-curriculum';
const PBJ = 'pbj-basics';

const COURSES: CourseSummary[] = [
  { collectionKey: MI, displayName: 'Mentors International - Colombia Pilot Curriculum', lessonCount: 28 },
  { collectionKey: PBJ, displayName: 'How to Make a PB&J Sandwich', lessonCount: 1 },
];

function health(status: SocioHealth['status']): SocioHealth {
  return { status, reasons: [{ kind: 'none' }] };
}

function row(overrides: Partial<SocioRow> & Pick<SocioRow, 'id'>): SocioRow {
  return {
    name: `socio ${overrides.id}`,
    channelType: 'whatsapp',
    health: health('GREEN'),
    currentLesson: 1,
    lastInteractionAt: null,
    curriculumCollectionKey: MI,
    unresolvedRed: 0,
    unresolvedYellow: 0,
    ...overrides,
  };
}

describe('buildCourseRollups', () => {
  it('groups by collection key', () => {
    const rollups = buildCourseRollups(
      [
        row({ id: 'a', curriculumCollectionKey: MI }),
        row({ id: 'b', curriculumCollectionKey: MI }),
        row({ id: 'c', curriculumCollectionKey: PBJ }),
      ],
      COURSES,
    );

    expect(rollups).toHaveLength(2);
    const mi = rollups.find((r) => r.collectionKey === MI);
    const pbj = rollups.find((r) => r.collectionKey === PBJ);
    expect(mi?.participantCount).toBe(2);
    expect(pbj?.participantCount).toBe(1);
  });

  it('takes the course name and lesson count from the collection, not a constant', () => {
    const rollups = buildCourseRollups([row({ id: 'a' })], COURSES);

    expect(rollups[0].displayName).toBe('Mentors International - Colombia Pilot Curriculum');
    expect(rollups[0].lessonCount).toBe(28);
  });

  it('puts null-key socios in unassigned rather than a course', () => {
    const rollups = buildCourseRollups(
      [
        row({ id: 'a', curriculumCollectionKey: MI }),
        row({ id: 'b', curriculumCollectionKey: null }),
      ],
      COURSES,
    );

    const mi = rollups.find((r) => r.collectionKey === MI);
    const unassigned = rollups.find((r) => r.collectionKey === null);

    expect(mi?.participantCount).toBe(1);
    expect(unassigned?.participantCount).toBe(1);
    // Not a course: no name of its own, and no course length to divide by.
    expect(unassigned?.displayName).toBeNull();
    expect(unassigned?.lessonCount).toBe(0);
    // And it never absorbs a real course's participants.
    expect(rollups.reduce((sum, r) => sum + r.participantCount, 0)).toBe(2);
  });

  it('sorts unassigned last', () => {
    const rollups = buildCourseRollups(
      [row({ id: 'a', curriculumCollectionKey: null }), row({ id: 'b', curriculumCollectionKey: MI })],
      COURSES,
    );

    expect(rollups.at(-1)?.collectionKey).toBeNull();
  });

  it('rounds the average lesson to a whole number', () => {
    const rollups = buildCourseRollups(
      [
        row({ id: 'a', currentLesson: 2 }),
        row({ id: 'b', currentLesson: 2 }),
        row({ id: 'c', currentLesson: 3 }),
      ],
      COURSES,
    );

    // 7 / 3 = 2.333…
    expect(rollups[0].averageLesson).toBe(2);
    expect(Number.isInteger(rollups[0].averageLesson)).toBe(true);
  });

  it('sums unresolved flags across the course', () => {
    const rollups = buildCourseRollups(
      [
        row({ id: 'a', unresolvedRed: 2, unresolvedYellow: 1 }),
        row({ id: 'b', unresolvedRed: 3, unresolvedYellow: 4 }),
      ],
      COURSES,
    );

    expect(rollups[0].unresolvedRed).toBe(5);
    expect(rollups[0].unresolvedYellow).toBe(5);
  });

  it('reports the most recent interaction, ignoring socios who have none', () => {
    const rollups = buildCourseRollups(
      [
        row({ id: 'a', lastInteractionAt: '2026-07-01T00:00:00.000Z' }),
        row({ id: 'b', lastInteractionAt: null }),
        row({ id: 'c', lastInteractionAt: '2026-08-01T00:00:00.000Z' }),
      ],
      COURSES,
    );

    expect(rollups[0].lastInteractionAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('falls back to no lesson total when the collection did not resolve', () => {
    const rollups = buildCourseRollups([row({ id: 'a', curriculumCollectionKey: 'ghost-course' })], []);

    expect(rollups[0].lessonCount).toBe(0);
    expect(rollups[0].displayName).toBeNull();
  });

  it('returns nothing for an empty list', () => {
    expect(buildCourseRollups([], COURSES)).toEqual([]);
  });
});

describe('courseAlertPills', () => {
  const base = buildCourseRollups([row({ id: 'a' })], COURSES)[0];

  it('renders no pills for a course with zero unresolved flags', () => {
    expect(courseAlertPills({ ...base, unresolvedRed: 0, unresolvedYellow: 0 })).toEqual([]);
  });

  it('omits only the severity that is zero', () => {
    expect(courseAlertPills({ ...base, unresolvedRed: 0, unresolvedYellow: 3 })).toEqual([
      { severity: 'yellow', count: 3 },
    ]);
    expect(courseAlertPills({ ...base, unresolvedRed: 2, unresolvedYellow: 0 })).toEqual([
      { severity: 'red', count: 2 },
    ]);
  });

  it('renders both when both are present, red first', () => {
    expect(courseAlertPills({ ...base, unresolvedRed: 2, unresolvedYellow: 3 })).toEqual([
      { severity: 'red', count: 2 },
      { severity: 'yellow', count: 3 },
    ]);
  });
});

describe('matchesFilters', () => {
  const miRed = row({ id: 'a', curriculumCollectionKey: MI, health: health('RED') });
  const miGreen = row({ id: 'b', curriculumCollectionKey: MI, health: health('GREEN') });
  const pbjRed = row({ id: 'c', curriculumCollectionKey: PBJ, health: health('RED') });
  const unassignedRed = row({ id: 'd', curriculumCollectionKey: null, health: health('RED') });
  const all = [miRed, miGreen, pbjRed, unassignedRed];

  it('passes everything when both filters are ALL', () => {
    expect(all.filter((r) => matchesFilters(r, 'ALL', 'ALL'))).toHaveLength(4);
  });

  it('filters by course alone', () => {
    expect(all.filter((r) => matchesFilters(r, 'ALL', MI)).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('filters by health alone', () => {
    expect(all.filter((r) => matchesFilters(r, 'RED', 'ALL')).map((r) => r.id)).toEqual([
      'a',
      'c',
      'd',
    ]);
  });

  it('composes: course and health narrow to the intersection', () => {
    expect(all.filter((r) => matchesFilters(r, 'RED', MI)).map((r) => r.id)).toEqual(['a']);
    expect(all.filter((r) => matchesFilters(r, 'GREEN', PBJ))).toEqual([]);
  });

  it('selects the unassigned bucket by sentinel', () => {
    expect(all.filter((r) => matchesFilters(r, 'ALL', UNASSIGNED_COURSE_KEY)).map((r) => r.id)).toEqual([
      'd',
    ]);
  });
});
