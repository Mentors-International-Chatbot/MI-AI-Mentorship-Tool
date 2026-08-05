export { buildSystemPrompt } from './builder';
export { determineMode, parseScore, type DetermineModeResult } from './router';
export { parseMarkers } from './markers';
export {
  RETEACH_THRESHOLD,
  MAX_LESSON_NUMBER,
  MAX_SENTENCES_PER_MESSAGE,
  MAX_EMOJIS_PER_MESSAGE,
  FLAG_YELLOW_THRESHOLD,
  FLAG_RED_THRESHOLD,
  FOLLOWUP_ENABLED,
  FOLLOWUP_DELAY_HOURS,
  MAX_REMINDERS,
  // Dimension sensing
  DIMENSION_DEFINITIONS,
  RETEACH_LEVEL_THRESHOLD,
  CONFUSION_ESCALATE_THRESHOLD,
  DIMENSION_SMOOTHING,
  TREND_THRESHOLD,
  type DimensionDefinition,
  type DimensionCategory,
} from './constants';
export {
  resolveStance,
  buildStanceBlock,
  hasPassedCurrentLessonGates,
  hasActiveDistress,
  readStanceDetour,
  TUTOR_DETOUR_TURNS,
  STANCE_DETOUR_KEY,
} from './stance';
export {
  InteractionMode,
  ROUTABLE_MODES,
  type Stance,
  type StanceDecision,
  type StanceReason,
  type SocioProgress,
  type RouterResult,
  type ParsedMarkers,
  type PromptOverrides,
  type ToneOverride,
  type ConcisivenessLevel,
  type CheckinState,
  type ReteachState,
  type LessonDeliveryState,
  type MentorSession,
  type ReminderState,
} from './types';
