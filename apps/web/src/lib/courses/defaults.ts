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

/**
 * Generic welcome message template.
 * Uses {mentorName}, {courseName}, {participantName} placeholders.
 * Course-neutral: no business/negocio framing.
 */
export const DEFAULT_WELCOME_TEMPLATE: LocalizedString = {
  en: `Hi{participantName}! 👋 I'm {mentorName}, your guide for {courseName}.

I'm here to help you learn through practical lessons. When you're ready, type "start" to begin your first lesson.`,
  es: `¡Hola{participantName}! 👋 Soy {mentorName}, tu guía para {courseName}.

Estoy aquí para ayudarte a aprender con lecciones prácticas. Cuando estés listo(a), escribe "comenzar" para iniciar tu primera lección.`,
  pt: `Olá{participantName}! 👋 Sou {mentorName}, seu guia para {courseName}.

Estou aqui para ajudá-lo a aprender com lições práticas. Quando estiver pronto(a), digite "começar" para iniciar sua primeira lição.`,
};

// ── Scheduled Check-ins Defaults ─────────────────────────────────────────────

export const DEFAULT_SCHEDULED_CHECKINS: ScheduledCheckin[] = [];

// ── Course Meta Defaults ─────────────────────────────────────────────────────

export const DEFAULT_COURSE_NAME = 'Virtual Mentor';
export const DEFAULT_DESCRIPTION = 'Educational curriculum';
export const DEFAULT_LANGUAGE = 'en';
