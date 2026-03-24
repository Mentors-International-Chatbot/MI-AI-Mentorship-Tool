// ─── Interaction Modes ───────────────────────────────────────────────
// The router inspects socio state and returns one of these.
// Your code decides the mode — not the AI.

export enum InteractionMode {
  LESSON_START = 'LESSON_START',
  LESSON_DELIVERY = 'LESSON_DELIVERY',
  FREEFORM_QUESTION = 'FREEFORM_QUESTION',
  CHECKIN = 'CHECKIN',
  RETEACH = 'RETEACH',
  REMINDER = 'REMINDER',
  MENTOR_HANDOFF = 'MENTOR_HANDOFF',
  POST_MENTOR = 'POST_MENTOR',
}

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

// ─── Router Result ──────────────────────────────────────────────────

export interface RouterResult {
  mode: InteractionMode;
  lesson?: LessonDeliveryState;
  checkin?: CheckinState;
  reteach?: ReteachState;
  mentor?: MentorSession;
  reminder?: ReminderState;
}

// ─── Parsed Markers ─────────────────────────────────────────────────

export interface ParsedMarkers {
  cleanText: string;
  flags: Array<{ level: 'RED' | 'YELLOW'; reason: string }>;
  lessonsCompleted: number[];
  escalations: string[];
  financials: Array<{ revenue: number; netProfit: number }>;
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
