import type { StanceDecision } from './stance';

// `stance.ts` imports nothing from this module, so re-exporting through here
// keeps `@/lib/ai/prompts/types` the single import site for router shapes
// without creating a cycle.
export type { Stance, StanceDecision, StanceReason } from './stance';

// ─── Interaction Modes ───────────────────────────────────────────────
// The router inspects socio state and returns one of these.
// Your code decides the mode — not the AI.
//
// Three of these nine are NOT reachable: `determineMode` never returns CHECKIN,
// MENTOR_HANDOFF or POST_MENTOR. Each still has a Layer 3 builder and an
// editable /admin/prompts category, so from outside they look live — which is
// the same shape as an empty `metric_definitions` or an unfed `alert_rules`:
// a mechanism that reads as finished because the missing half is invisible.
//
// They are retained rather than deleted, deliberately:
//   - `buildCheckinPrompt` is the only coach-shaped prompt anyone has written,
//     and the stance framing in `stance.ts` is lifted from it. The authorship
//     was sound; the wiring never happened.
//   - Deleting them also means deleting the `checkin`, `mentor_handoff` and
//     `post_mentor` prompt categories, which `categories.test.ts` binds to
//     their call sites, plus whatever active SystemPrompt rows exist against
//     them. That is a migration-shaped change, not a rename.
//
// So the fact is pinned instead of hidden: ROUTABLE_MODES below is the real
// set, and `router-stance.test.ts` asserts the router never returns anything
// outside it. Removal is a follow-up that must handle the categories and rows.

export enum InteractionMode {
  LESSON_START = 'LESSON_START',
  LESSON_DELIVERY = 'LESSON_DELIVERY',
  FREEFORM_QUESTION = 'FREEFORM_QUESTION',
  /** NOT ROUTABLE — see the note above. Builder retained, never selected. */
  CHECKIN = 'CHECKIN',
  RETEACH = 'RETEACH',
  REMINDER = 'REMINDER',
  /** NOT ROUTABLE — see the note above. Builder retained, never selected. */
  MENTOR_HANDOFF = 'MENTOR_HANDOFF',
  /** NOT ROUTABLE — see the note above. Builder retained, never selected. */
  POST_MENTOR = 'POST_MENTOR',
  /** Gated assessment session - student must complete teach-back to proceed */
  GATED_ASSESSMENT = 'GATED_ASSESSMENT',
}

/**
 * The modes `determineMode` can actually return. Enforced by test, not by hope.
 *
 * REMINDER left this set on 2026-08-09. Its router branch was gated on a
 * `daysSince` that was structurally always zero, so it had never fired; once
 * that figure was corrected the branch would have started answering real
 * learner messages with an unprompted "want to continue?" nudge. The mode is
 * still live — `/api/cron/reminders` builds it directly, which is the context
 * it was written for — it is simply not something the router selects.
 */
export const ROUTABLE_MODES: ReadonlySet<InteractionMode> = new Set([
  InteractionMode.LESSON_START,
  InteractionMode.LESSON_DELIVERY,
  InteractionMode.FREEFORM_QUESTION,
  InteractionMode.RETEACH,
  InteractionMode.GATED_ASSESSMENT,
]);

// ─── Tone Overrides ─────────────────────────────────────────────────
// Stored in socio.promptOverrides.toneOverride

export type ToneOverride =
  | 'more_encouraging'
  | 'more_direct'
  | 'simpler_language'
  | 'family_focused'
  | 'struggling_business';

// ─── Socio Progress (future — stubbed for now) ─────────────────────

export interface SocioProgress {
  currentLessonNumber: number;
  completedLessons: number[];
  weeklyUnderstanding: number | null;
  weeklyImplementation: number | null;
  daysSinceLastInteraction: number;
}

// ─── Checkin State (future — stubbed for now) ───────────────────────

export interface CheckinState {
  step: number;          // 1–5
  responsesSoFar: string;
  understandingScore?: number;
  revenueReported?: string;
}

// ─── Reteach State (future — stubbed for now) ───────────────────────

export interface ReteachState {
  lessonNumber: number;
  lessonTitleEs: string;
  understandingScore: number;
}

// ─── Lesson Delivery State (future — stubbed for now) ───────────────

export interface LessonDeliveryState {
  lessonNumber: number;
  lessonTitleEs: string;
  lessonCategory: string;
  messageIndex: number;
  totalMessages: number;
  messageType: string;       // "escenario" | "explicación" | "ejemplo" | "pregunta"
  messageContentEs: string;
  keyConcepts: string;
  exercise: string;
  commitment: string;
  previousLessonTitleEs?: string;
  lastUnderstanding?: number;
}

// ─── Mentor Session (future — stubbed for now) ──────────────────────

export interface MentorSession {
  mentorName: string;
  mentorNotes?: string;
}

// ─── Reminder State (future — stubbed for now) ──────────────────────

export interface ReminderState {
  lessonNumber: number;
  lessonTitleEs: string;
  messageIndex: number;
  totalMessages: number;
  reminderNumber: number;
  maxReminders: number;
}

// ─── Gated Assessment State ─────────────────────────────────────────

export interface GatedAssessmentState {
  /** The lesson containing the gate */
  lessonNumber: number;
  lessonKey: string;
  lessonTitleEs: string;
  /** The gated block ID */
  blockId: string;
  /** The teach-back prompt */
  prompt: string;
  /** Concepts being evaluated */
  evaluatesConcepts: string[];
  /** Dimension being assessed */
  dimensionKey: string;
  /** Session ID if one already exists (resume) */
  sessionId?: string;
  /** Whether student has already passed (can proceed) */
  passed?: boolean;
}

// ─── Router Result ──────────────────────────────────────────────────

export interface RouterResult {
  mode: InteractionMode;
  lesson?: LessonDeliveryState;
  checkin?: CheckinState;
  reteach?: ReteachState;
  mentor?: MentorSession;
  reminder?: ReminderState;
  gatedAssessment?: GatedAssessmentState;
  /**
   * The second router axis: what the AI's job is this turn, independent of
   * which kind of turn it is. See `stance.ts`. Optional because the callers
   * that build a RouterResult by hand (test-ai, the reminder cron) have no
   * socio state to select one from.
   */
  stance?: StanceDecision;
}

// ─── Parsed Markers ─────────────────────────────────────────────────

export interface ParsedMarkers {
  cleanText: string;
  flags: Array<{ level: 'RED' | 'YELLOW'; reason: string }>;
  lessonsCompleted: number[];
  escalations: string[];
  financials: Array<{ revenue: number; netProfit: number }>;
  /**
   * Milestone keys the learner reported reaching this turn. The first signal in
   * this system that a learner has DONE something, as opposed to been taught it.
   */
  milestones: string[];
}

// ─── Conciseness Levels ─────────────────────────────────────────────

export type ConcisivenessLevel = 'very_brief' | 'brief' | 'standard' | 'detailed' | 'very_detailed';

// ─── Prompt Overrides (shape of socio.promptOverrides JSON) ─────────

export interface PromptOverrides {
  toneOverride?: ToneOverride;
  conciseness?: ConcisivenessLevel;
  complexity?: number;  // 0-1
  warmth?: number;      // 0-1
  positivity?: number;  // 0-1
}
