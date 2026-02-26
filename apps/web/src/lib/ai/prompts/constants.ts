// ─── Tunable Constants ──────────────────────────────────────────────
// Central place for values referenced by the router, task prompts,
// and webhook. Change one number here, the whole system adjusts.

// ── Lesson pacing ──

/** Understanding score at or below this triggers RETEACH mode. */
export const RETEACH_THRESHOLD = 3;

/** Highest lesson number with structured data. Router won't start lessons beyond this. */
export const MAX_LESSON_NUMBER = 5;

/** Maximum lessons a socio can complete in a single day (self-paced mode). */
export const MAX_LESSONS_PER_DAY = 1;

/** Target lessons per week (weekly pacing mode). */
export const LESSONS_PER_WEEK = 2;

// ── Prompt format ──

/** Max sentences the AI should use per WhatsApp message. */
export const MAX_SENTENCES_PER_MESSAGE = 4;

/** Max emojis the AI should use per message. */
export const MAX_EMOJIS_PER_MESSAGE = 2;

// ── Flag thresholds (understanding score at or below triggers) ──

/** Score at or below this triggers a YELLOW flag during check-in. */
export const FLAG_YELLOW_THRESHOLD = 5;

/** Score at or below this triggers a RED flag / persistent-low-comprehension escalation. */
export const FLAG_RED_THRESHOLD = 2;

// ── Follow-up / reminder settings ──

/** Master toggle for follow-up reminder messages. */
export const FOLLOWUP_ENABLED = true;

/** Hours of inactivity before a proactive reminder is sent. */
export const FOLLOWUP_DELAY_HOURS = 24;

/** Max reminder messages per lesson before stopping. */
export const MAX_REMINDERS = 2;
