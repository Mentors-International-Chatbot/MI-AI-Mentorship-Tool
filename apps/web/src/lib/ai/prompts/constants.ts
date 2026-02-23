// ─── Tunable Constants ──────────────────────────────────────────────
// Central place for values referenced by the router, task prompts,
// and webhook. Change one number here, the whole system adjusts.

/** Understanding score at or below this triggers RETEACH mode. Default: 3 */
export const RETEACH_THRESHOLD = 3;

/** Highest lesson number with structured data. Router won't start lessons beyond this. */
export const MAX_LESSON_NUMBER = 5;

/** Maximum lessons a socio can complete in a single day (self-paced mode). */
export const MAX_LESSONS_PER_DAY = 1;

/** Target lessons per week (weekly pacing mode). */
export const LESSONS_PER_WEEK = 2;
