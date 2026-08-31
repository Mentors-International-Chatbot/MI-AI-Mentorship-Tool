/**
 * Groups completed BlockProgress rows into a per-lesson activity summary.
 *
 * Player-surface courses (block-based, e.g. ai-essentials-aug2026) record most
 * learner activity as BlockProgress, not `Message` rows — a learner can finish
 * several blocks and leave at most one row in `messages`. This is the pure
 * grouping step behind the mentor learner-detail activity strip, kept separate
 * from the Prisma reads so it's testable without a DB.
 */
export type BlockProgressRow = {
  lessonKey: string;
  blockId: string;
  completedAt: Date;
};

export type LessonActivity = {
  lessonKey: string;
  completed: number;
  /** Total blocks in the lesson, or null when the content lookup failed. */
  total: number | null;
  lastActivityAt: string;
};

export type ActivityStripData = {
  lessons: LessonActivity[];
} | null;

/**
 * `lessonTotals` maps lessonKey -> block count (or null if the lookup
 * couldn't resolve one). Lessons are sorted most-recently-active first.
 */
export function buildActivityStrip(
  rows: readonly BlockProgressRow[],
  lessonTotals: ReadonlyMap<string, number | null>,
): ActivityStripData {
  if (rows.length === 0) return null;

  const byLesson = new Map<string, { blockIds: Set<string>; lastActivityAt: Date }>();
  for (const row of rows) {
    const entry = byLesson.get(row.lessonKey);
    if (!entry) {
      byLesson.set(row.lessonKey, { blockIds: new Set([row.blockId]), lastActivityAt: row.completedAt });
    } else {
      entry.blockIds.add(row.blockId);
      if (row.completedAt > entry.lastActivityAt) entry.lastActivityAt = row.completedAt;
    }
  }

  const lessons: LessonActivity[] = [...byLesson.entries()]
    .map(([lessonKey, entry]) => ({
      lessonKey,
      completed: entry.blockIds.size,
      total: lessonTotals.get(lessonKey) ?? null,
      lastActivityAt: entry.lastActivityAt.toISOString(),
    }))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

  return { lessons };
}
