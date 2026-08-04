/**
 * Positive signals — derived, never stored
 * ═══════════════════════════════════════════════════════════════════════════
 * There is no `positive_signals` table and there should not be one. Every kind
 * below is computed at read time from data another pipeline already writes for
 * its own reasons. That keeps the set honest: a signal cannot drift out of sync
 * with its source, because it has no independent existence.
 *
 * Structured, not pre-rendered — same split as {@link HealthReason}. This layer
 * decides *what happened*; `formatPositiveSignal` decides how to say it in the
 * viewer's language. Adding a kind without a string is a compile error.
 *
 * Deliberately absent: a "dimension rose by 2+ over 14 days" signal. Neither
 * table can support it. `metric_observations` is append-only and would carry the
 * history, but every row has a null `enrollmentId` and the table has no
 * `socioId`, so no observation is attributable to a person. `socio_dimension_states`
 * is upserted on (socioId, dimensionKey), so it holds current state only. Its
 * `trend` field is a single-turn delta, which is a materially weaker claim than
 * a two-week rise — shipping it under a label mentors would read as the stronger
 * one is worse than four honest kinds.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** A snapshot, not an audit log. The most recent N and nothing more. */
export const POSITIVE_SIGNAL_LIMIT = 10;

/** Lesson completions inside this window count as "this week". */
export const LESSON_COMPLETED_WINDOW_DAYS = 7;

/** A silence at least this long, followed by a message, is a return. */
export const QUIET_RETURN_THRESHOLD_DAYS = 14;

/** Window for the sustained-positive sentiment read. */
export const SUSTAINED_POSITIVE_WINDOW_DAYS = 14;

/** Positive messages needed inside the window to count as sustained. */
export const SUSTAINED_POSITIVE_MIN_COUNT = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Something worth telling a mentor about, that is not a problem.
 *
 * Each variant carries its own typed payload rather than a shared pre-rendered
 * `detail` string. A string would have to be built in the data layer, which has
 * no view of the viewer's language, and would make the exhaustive switch in
 * `formatPositiveSignal` pointless.
 *
 * Plain data — these cross the server → client boundary as props.
 */
export type PositiveSignal =
  | { socioId: string; kind: 'gate_passed_first_try'; lessonKey: string; occurredAt: Date }
  | { socioId: string; kind: 'lesson_completed'; lessonNumber: number; occurredAt: Date }
  | { socioId: string; kind: 'returned_after_quiet'; daysQuiet: number; occurredAt: Date }
  | { socioId: string; kind: 'sustained_positive'; positiveCount: number; occurredAt: Date };

export type PositiveSignalKind = PositiveSignal['kind'];

/**
 * Everything the derivations read, for one socio.
 *
 * Plain arrays rather than repo calls: the derivation stays pure and
 * synchronous, so every kind is testable without a database.
 */
export type PositiveSignalSource = {
  socioId: string;
  /** Any status. `passedAt` is the pass/fail fact; `status` is not. */
  assessmentSessions: readonly {
    lessonKey: string;
    attemptNumber: number;
    passedAt: Date | null;
  }[];
  lessonProgress: readonly { lessonNumber: number; completedAt: Date | null }[];
  /** Timestamps of the socio's own messages. Any order; sorted internally. */
  userMessageDates: readonly Date[];
  sentiments: readonly { sentiment: string; createdAt: Date }[];
};

// ── Per-kind derivations ─────────────────────────────────────────────────────
// One function per kind, each returning zero or more signals. A source with no
// data returns an empty array — never throws, never invents a zero-value signal.

/**
 * Passed a teach-back gate on the first attempt.
 *
 * `attemptNumber === 1` and a non-null `passedAt`. Note that `status` is not
 * consulted: a session can be `completed` with `passedAt` null, which is a
 * completed-but-failed gate and emphatically not good news.
 */
function deriveGatePassedFirstTry(source: PositiveSignalSource): PositiveSignal[] {
  return source.assessmentSessions
    .filter((s) => s.attemptNumber === 1 && s.passedAt !== null)
    .map((s) => ({
      socioId: source.socioId,
      kind: 'gate_passed_first_try' as const,
      lessonKey: s.lessonKey,
      // Non-null by the filter above; narrowing does not survive .map().
      occurredAt: s.passedAt as Date,
    }));
}

/** Completed a lesson inside the recent window. */
function deriveLessonCompleted(source: PositiveSignalSource, now: Date): PositiveSignal[] {
  const cutoff = new Date(now.getTime() - LESSON_COMPLETED_WINDOW_DAYS * MS_PER_DAY);

  return source.lessonProgress
    .filter((p): p is typeof p & { completedAt: Date } =>
      p.completedAt !== null && p.completedAt >= cutoff)
    .map((p) => ({
      socioId: source.socioId,
      kind: 'lesson_completed' as const,
      lessonNumber: p.lessonNumber,
      occurredAt: p.completedAt,
    }));
}

/**
 * Came back after going quiet.
 *
 * Scans consecutive message pairs for a gap at or over the threshold; the
 * *later* message of the pair is the return. Emits one signal per return, so a
 * socio who lapsed and came back twice produces two — both are true.
 */
function deriveReturnedAfterQuiet(source: PositiveSignalSource): PositiveSignal[] {
  const dates = [...source.userMessageDates].sort((a, b) => a.getTime() - b.getTime());
  const signals: PositiveSignal[] = [];

  for (let i = 1; i < dates.length; i++) {
    const gapDays = (dates[i].getTime() - dates[i - 1].getTime()) / MS_PER_DAY;
    if (gapDays >= QUIET_RETURN_THRESHOLD_DAYS) {
      signals.push({
        socioId: source.socioId,
        kind: 'returned_after_quiet',
        daysQuiet: Math.floor(gapDays),
        occurredAt: dates[i],
      });
    }
  }

  return signals;
}

/**
 * Sustained positive sentiment across the window.
 *
 * Requires enough positive messages *and* no negative or distressed ones — a
 * socio with four positives and one distressed message is not having a good
 * week, and the flag pipeline has already raised that separately.
 *
 * `message_sentiments` stores positivity as the `sentiment` label only; the
 * three numeric scores (confusion/frustration/urgency) all measure
 * negative-leaning states, so there is no positive score to threshold on.
 */
function deriveSustainedPositive(source: PositiveSignalSource, now: Date): PositiveSignal[] {
  const cutoff = new Date(now.getTime() - SUSTAINED_POSITIVE_WINDOW_DAYS * MS_PER_DAY);
  const inWindow = source.sentiments.filter((s) => s.createdAt >= cutoff);

  const positives = inWindow.filter((s) => s.sentiment === 'positive');
  const hasNegative = inWindow.some(
    (s) => s.sentiment === 'negative' || s.sentiment === 'distressed',
  );

  if (hasNegative || positives.length < SUSTAINED_POSITIVE_MIN_COUNT) return [];

  const mostRecent = positives.reduce((latest, s) =>
    s.createdAt > latest.createdAt ? s : latest);

  return [{
    socioId: source.socioId,
    kind: 'sustained_positive',
    positiveCount: positives.length,
    occurredAt: mostRecent.createdAt,
  }];
}

// ── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Derives every positive signal across a set of socios, most recent first,
 * capped at {@link POSITIVE_SIGNAL_LIMIT}.
 *
 * The cap is applied after the global sort, so it keeps the newest signals
 * across all socios rather than the newest of whichever socio sorted first.
 *
 * @param sources - One entry per socio in scope
 * @param now - Injected so window boundaries are testable
 */
export function derivePositiveSignals(
  sources: readonly PositiveSignalSource[],
  now: Date = new Date(),
): PositiveSignal[] {
  const all = sources.flatMap((source) => [
    ...deriveGatePassedFirstTry(source),
    ...deriveLessonCompleted(source, now),
    ...deriveReturnedAfterQuiet(source),
    ...deriveSustainedPositive(source, now),
  ]);

  all.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  return all.slice(0, POSITIVE_SIGNAL_LIMIT);
}
