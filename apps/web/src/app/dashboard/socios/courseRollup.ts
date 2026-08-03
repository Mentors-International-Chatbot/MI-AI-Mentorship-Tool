/**
 * Per-course rollups for the socios list
 * ═══════════════════════════════════════════════════════════════════════════
 * Derived entirely from the socio rows the page already fetched — deliberately
 * NOT a separate aggregate query. The cards therefore inherit whatever scoping
 * the list has: when the list becomes org-scoped or mentor-scoped, the cards
 * narrow with it automatically instead of quietly reporting platform-wide
 * totals next to a filtered table.
 *
 * Pure and synchronous, so it is testable without a database.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { SocioHealth } from '@/lib/health';
import type { CourseSummary } from '@/lib/journey-package/course-summaries';

export type SocioRow = {
  id: string;
  name: string | null;
  channelType: string;
  health: SocioHealth;
  currentLesson: number;
  lastInteractionAt: string | null;
  /** null when the socio is enrolled in no course. */
  curriculumCollectionKey: string | null;
  /**
   * Exact unresolved flag counts, not derived from `health.reasons`. The health
   * service suppresses the yellow reason on a socio that is already RED, so
   * reading yellow totals off the reason list undercounts.
   */
  unresolvedRed: number;
  unresolvedYellow: number;
};

export type CourseRollup = {
  /** null identifies the unassigned bucket, which is not a course. */
  collectionKey: string | null;
  /** ContentCollection.name; null for the unassigned bucket, whose label is i18n. */
  displayName: string | null;
  participantCount: number;
  /** Rounded to a whole lesson — a card never shows "lesson 2.3333333". */
  averageLesson: number;
  /** 0 when the collection could not be resolved, or for unassigned. */
  lessonCount: number;
  unresolvedRed: number;
  unresolvedYellow: number;
  /** Most recent interaction across the course's participants, ISO or null. */
  lastInteractionAt: string | null;
};

/** Sentinel for the unassigned bucket where a React key or filter value is needed. */
export const UNASSIGNED_COURSE_KEY = '__unassigned__';

/**
 * Groups rows by `curriculumCollectionKey`.
 *
 * Socios with a null key are collected into a single bucket with a null
 * `collectionKey` rather than being folded into a default course — "no course"
 * is a distinct fact about a socio, and hiding it inside a course would make
 * both numbers wrong.
 *
 * Courses come first, ordered by display name; the unassigned bucket, if any,
 * is always last.
 */
export function buildCourseRollups(
  rows: readonly SocioRow[],
  courses: readonly CourseSummary[],
): CourseRollup[] {
  const summaryByKey = new Map(courses.map((c) => [c.collectionKey, c]));

  type Accumulator = {
    collectionKey: string | null;
    participantCount: number;
    lessonSum: number;
    unresolvedRed: number;
    unresolvedYellow: number;
    lastInteractionAt: string | null;
  };

  const groups = new Map<string, Accumulator>();

  for (const row of rows) {
    const key = row.curriculumCollectionKey;
    const groupId = key ?? UNASSIGNED_COURSE_KEY;

    let group = groups.get(groupId);
    if (!group) {
      group = {
        collectionKey: key,
        participantCount: 0,
        lessonSum: 0,
        unresolvedRed: 0,
        unresolvedYellow: 0,
        lastInteractionAt: null,
      };
      groups.set(groupId, group);
    }

    group.participantCount += 1;
    group.lessonSum += row.currentLesson;
    group.unresolvedRed += row.unresolvedRed;
    group.unresolvedYellow += row.unresolvedYellow;
    group.lastInteractionAt = laterOf(group.lastInteractionAt, row.lastInteractionAt);
  }

  const rollups: CourseRollup[] = [...groups.values()].map((group) => {
    const summary = group.collectionKey ? summaryByKey.get(group.collectionKey) : undefined;
    return {
      collectionKey: group.collectionKey,
      displayName: summary?.displayName ?? null,
      participantCount: group.participantCount,
      averageLesson: Math.round(group.lessonSum / group.participantCount),
      lessonCount: summary?.lessonCount ?? 0,
      unresolvedRed: group.unresolvedRed,
      unresolvedYellow: group.unresolvedYellow,
      lastInteractionAt: group.lastInteractionAt,
    };
  });

  rollups.sort((a, b) => {
    if (a.collectionKey === null) return 1;
    if (b.collectionKey === null) return -1;
    // A course whose collection did not resolve has no name to sort by; fall
    // back to its key so ordering stays stable rather than arbitrary.
    const aLabel = a.displayName ?? a.collectionKey;
    const bLabel = b.displayName ?? b.collectionKey;
    return aLabel.localeCompare(bLabel);
  });

  return rollups;
}

export type HealthFilter = 'ALL' | 'RED' | 'YELLOW' | 'GREEN';
/**
 * 'ALL', a ContentCollection slug, or {@link UNASSIGNED_COURSE_KEY}. Slugs are
 * `^[a-z0-9][a-z0-9-]*$`, so neither sentinel can collide with a real key.
 */
export type CourseFilter = 'ALL' | string;

/**
 * Whether a row survives both filters. They compose: each narrows the same
 * list, so an active pair shows the intersection rather than a union.
 */
export function matchesFilters(
  row: SocioRow,
  healthFilter: HealthFilter,
  courseFilter: CourseFilter,
): boolean {
  if (healthFilter !== 'ALL' && row.health.status !== healthFilter) return false;
  if (courseFilter === 'ALL') return true;
  return (row.curriculumCollectionKey ?? UNASSIGNED_COURSE_KEY) === courseFilter;
}

export type CourseAlertPill = { severity: 'red' | 'yellow'; count: number };

/**
 * The alert pills a course card should render. A severity with no unresolved
 * flags produces no pill at all — a card for a healthy course shows nothing
 * rather than a pair of zeroes.
 */
export function courseAlertPills(rollup: CourseRollup): CourseAlertPill[] {
  const pills: CourseAlertPill[] = [];
  if (rollup.unresolvedRed > 0) pills.push({ severity: 'red', count: rollup.unresolvedRed });
  if (rollup.unresolvedYellow > 0) {
    pills.push({ severity: 'yellow', count: rollup.unresolvedYellow });
  }
  return pills;
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}
