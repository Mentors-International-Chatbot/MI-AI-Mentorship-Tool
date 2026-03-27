// ─── Tunable Constants ──────────────────────────────────────────────
// Sync defaults kept for backward compatibility. Hot path code should
// use the async getConfig*() helpers which read from the DB-backed
// ProgramConfig table with a 60-second in-memory cache.

import { getConfigNumber, getConfigBool } from '@/lib/config/service';

// ── Sync defaults (used as fallbacks) ──

export const RETEACH_THRESHOLD = 3;
export const MAX_LESSON_NUMBER = 28;
export const MAX_LESSONS_PER_DAY = 1;
export const LESSONS_PER_WEEK = 2;
export const MAX_SENTENCES_PER_MESSAGE = 4;
export const MAX_EMOJIS_PER_MESSAGE = 2;
export const FLAG_YELLOW_THRESHOLD = 5;
export const FLAG_RED_THRESHOLD = 2;
export const FOLLOWUP_ENABLED = true;
export const FOLLOWUP_DELAY_HOURS = 24;
export const MAX_REMINDERS = 2;

// ── Async DB-backed getters (prefer these in new code) ──

export const config = {
  reteachThreshold:       () => getConfigNumber('RETEACH_THRESHOLD'),
  maxLessonNumber:        () => getConfigNumber('MAX_LESSON_NUMBER'),
  maxLessonsPerDay:       () => getConfigNumber('MAX_LESSONS_PER_DAY'),
  lessonsPerWeek:         () => getConfigNumber('LESSONS_PER_WEEK'),
  maxSentencesPerMessage: () => getConfigNumber('MAX_SENTENCES_PER_MESSAGE'),
  maxEmojisPerMessage:    () => getConfigNumber('MAX_EMOJIS_PER_MESSAGE'),
  flagYellowThreshold:    () => getConfigNumber('FLAG_YELLOW_THRESHOLD'),
  flagRedThreshold:       () => getConfigNumber('FLAG_RED_THRESHOLD'),
  followupEnabled:        () => getConfigBool('FOLLOWUP_ENABLED'),
  followupDelayHours:     () => getConfigNumber('FOLLOWUP_DELAY_HOURS'),
  maxReminders:           () => getConfigNumber('MAX_REMINDERS'),
  requireLegalConsent:    () => getConfigBool('REQUIRE_LEGAL_CONSENT'),
};
