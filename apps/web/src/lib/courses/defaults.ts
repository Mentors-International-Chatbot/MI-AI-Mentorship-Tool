/**
 * Platform Defaults for Course Configuration
 * ═══════════════════════════════════════════════════════════════════════════
 * Neutral, English-first fallback values for every configurable field.
 * NO course-specific content here - this is the generic platform baseline.
 *
 * Resolution order: course value → defaults.ts values
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type {
  LocalizedString,
  Identity,
  Terminology,
  LearnerContext,
  OnboardingConfig,
  ScheduledCheckin,
} from '@/lib/journey-package/journey-package.schema';

// ── Identity Defaults ────────────────────────────────────────────────────────

export const DEFAULT_IDENTITY: Identity = {
  mentorName: 'Tutor',
  displayName: undefined, // falls back to courseName
};

// ── Terminology Defaults ─────────────────────────────────────────────────────

export const DEFAULT_TERMINOLOGY: Terminology = {
  participant: { en: 'participant' },
};

// ── Learner Context Defaults ─────────────────────────────────────────────────
// undefined = no learner context collection (generic course)

export const DEFAULT_LEARNER_CONTEXT: LearnerContext | undefined = undefined;

// Generic personalization instruction for courses that define learnerContext
export const DEFAULT_PERSONALIZATION_INSTRUCTION: LocalizedString = {
  en: "Adapt examples to the participant's context and interests.",
  es: 'Adapta los ejemplos al contexto e intereses del participante.',
  pt: 'Adapte os exemplos ao contexto e interesses do participante.',
};

// ── Onboarding Defaults ──────────────────────────────────────────────────────

export const DEFAULT_ONBOARDING: OnboardingConfig = {
  welcome: undefined,
  steps: [],
};

// ── Scheduled Check-ins Defaults ─────────────────────────────────────────────

export const DEFAULT_SCHEDULED_CHECKINS: ScheduledCheckin[] = [];

// ── Course Meta Defaults ─────────────────────────────────────────────────────

export const DEFAULT_COURSE_NAME = 'Virtual Mentor';
export const DEFAULT_DESCRIPTION = 'Educational curriculum';
export const DEFAULT_LANGUAGE = 'en';
