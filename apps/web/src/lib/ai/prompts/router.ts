import { repo } from '@/lib/repo';
import { Socio } from '@/lib/repo/types';
import { SocioProgress as RepoSocioProgress } from '@/lib/repo/types';
import { getLessonData, hasLessonData, getGateAtPosition } from '@/lib/lessons/db-lesson-service';
import {
  RETEACH_THRESHOLD,
  MAX_LESSON_NUMBER,
  FOLLOWUP_ENABLED,
  MAX_REMINDERS,
  RETEACH_LEVEL_THRESHOLD,
} from './constants';
import {
  InteractionMode,
  SocioProgress,
  RouterResult,
  LessonDeliveryState,
  ReminderState,
  GatedAssessmentState,
} from './types';
import type { DimensionStateMap } from '@/lib/ai/sensing/types';

// ─── Mode Router ────────────────────────────────────────────────────
// Inspects the socio's state and returns the correct InteractionMode.
// Key principle: your code decides the mode, not the AI.

function repoProgressToPromptProgress(rp: RepoSocioProgress, daysSince: number): SocioProgress {
  return {
    currentLessonNumber: rp.currentLessonNumber,
    completedLessons: rp.completedLessons,
    weeklyUnderstanding: rp.weeklyUnderstanding,
    weeklyImplementation: rp.weeklyImplementation,
    daysSinceLastInteraction: daysSince,
  };
}

function buildLessonDeliveryState(
  repoProgress: RepoSocioProgress,
  collectionKey: string,
): LessonDeliveryState | null {
  if (!hasLessonData(collectionKey, repoProgress.currentLessonNumber)) return null;

  const lesson = getLessonData(collectionKey, repoProgress.currentLessonNumber);
  const msgIndex = repoProgress.currentMessageIndex;
  const message = lesson.messages[msgIndex];
  if (!message) return null;

  const prevLessonNum = repoProgress.currentLessonNumber - 1;
  const prevTitle = prevLessonNum >= 1 && hasLessonData(collectionKey, prevLessonNum)
    ? getLessonData(collectionKey, prevLessonNum).titleEs
    : undefined;

  return {
    lessonNumber: lesson.lessonNumber,
    lessonTitleEs: lesson.titleEs,
    lessonCategory: lesson.category,
    messageIndex: msgIndex + 1, // 1-based for display
    totalMessages: lesson.messages.length,
    messageType: message.type,
    messageContentEs: message.contentEs,
    keyConcepts: lesson.keyConcepts.map(c => `- ${c}`).join('\n'),
    exercise: lesson.exercise,
    commitment: lesson.commitment,
    previousLessonTitleEs: prevTitle,
    lastUnderstanding: repoProgress.weeklyUnderstanding ?? undefined,
  };
}

/**
 * Checks if student is at a gated position and builds state for assessment.
 * Returns null if:
 *   - No gate at this position
 *   - Gate has been passed (completed session with passedAt)
 *   - Gate's configSnapshot.blocking === false (non-blocking gate)
 */
async function checkGatePosition(
  socioId: string,
  repoProgress: RepoSocioProgress,
  collectionKey: string,
): Promise<GatedAssessmentState | null> {
  if (!hasLessonData(collectionKey, repoProgress.currentLessonNumber)) return null;

  const lesson = getLessonData(collectionKey, repoProgress.currentLessonNumber);
  const msgIndex = repoProgress.currentMessageIndex;

  // Check each gate to see if we've passed all teach messages before it
  for (const gate of lesson.gates) {
    // Gate activates when currentMessageIndex > afterMessageIndex
    // This means student has completed all messages up to and including afterMessageIndex
    if (msgIndex > gate.afterMessageIndex) {
      // Check if there's an existing assessment session for this gate
      const sessions = await repo.getAssessmentSessionsForSocioLesson?.(
        socioId,
        lesson.lessonKey,
        gate.blockId
      );

      // If there's a completed session (regardless of passedAt), gate is cleared.
      // Blocking is about open sessions (pending/in_progress), not pass/fail status.
      const completedSession = sessions?.find((s) => s.status === 'completed');
      if (completedSession) {
        continue; // Gate already cleared by completion, check next gate
      }

      // Check if there's an existing incomplete session
      const existingSession = sessions?.find((s) => s.status !== 'completed');

      // If session exists, check configSnapshot.blocking
      // If blocking === false, allow progression (don't return gate state)
      // Note: createAssessmentSession guarantees configSnapshot is always present
      // (throws AssessmentConfigError if config is missing). The fallback to true
      // is a fail-safe that should never be reached in normal operation.
      if (existingSession) {
        const configSnapshot = existingSession.configSnapshot as Record<string, unknown> | null;
        const isBlocking = configSnapshot?.blocking !== false;
        if (!isBlocking) {
          console.log(`[Router] Gate ${gate.blockId} is non-blocking, allowing progression`);
          continue;
        }
      }

      // Gate is blocking - need assessment
      return {
        lessonNumber: lesson.lessonNumber,
        lessonKey: lesson.lessonKey,
        lessonTitleEs: lesson.titleEs,
        blockId: gate.blockId,
        prompt: gate.prompt,
        evaluatesConcepts: gate.evaluatesConcepts,
        dimensionKey: gate.dimensionKey,
        sessionId: existingSession?.id,
        passed: false,
      };
    }
  }

  return null;
}

export interface DetermineModeResult {
  routerResult: RouterResult;
  progress: SocioProgress;
  repoProgress: RepoSocioProgress;
  /** True if reteach was triggered by dimension state (continuous sensing) */
  reteachFromDimension?: boolean;
}

/**
 * Check if dimension state suggests reteaching is needed.
 * Returns true if comprehension is below threshold.
 */
function shouldReteachFromDimensions(dimensionState?: DimensionStateMap): boolean {
  if (!dimensionState) return false;

  const comprehension = dimensionState['comprehension'];
  if (!comprehension) return false;

  // Only trigger reteach if confidence is reasonable
  return comprehension.level < RETEACH_LEVEL_THRESHOLD && comprehension.confidence >= 0.4;
}

export async function determineMode(
  socio: Socio,
  incomingText: string,
  collectionKey: string,
  dimensionState?: DimensionStateMap,
): Promise<DetermineModeResult> {
  const repoProgress = await repo.getSocioProgress(socio.id);

  const lastMessages = await repo.getMessages(socio.id, 1);
  const lastMsg = lastMessages[lastMessages.length - 1];
  const daysSince = lastMsg
    ? Math.floor((Date.now() - lastMsg.createdAt.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const progress = repoProgressToPromptProgress(repoProgress, daysSince);

  // Can we load lesson data for the current lesson?
  const hasLesson = hasLessonData(collectionKey, repoProgress.currentLessonNumber);

  const trimmed = incomingText.trim();
  const startNextPatterns =
    /^(siguiente|next|próxima|próximo|empezar|comenzar|start|lección\s*\d+)/i;
  if (
    startNextPatterns.test(trimmed) &&
    repoProgress.currentMessageIndex === 0 &&
    hasLesson
  ) {
    const lessonState = buildLessonDeliveryState(repoProgress, collectionKey);
    if (lessonState) {
      return {
        routerResult: {
          mode: InteractionMode.LESSON_START,
          lesson: lessonState,
        },
        progress,
        repoProgress,
      };
    }
  }

  // ── Priority 0: Reminder nudge (silent socio returning mid-lesson) ──
  if (
    FOLLOWUP_ENABLED &&
    hasLesson &&
    repoProgress.currentMessageIndex > 0 &&
    daysSince >= 1 &&
    repoProgress.remindersSent < MAX_REMINDERS
  ) {
    const lesson = getLessonData(collectionKey, repoProgress.currentLessonNumber);
    const reminder: ReminderState = {
      lessonNumber: repoProgress.currentLessonNumber,
      lessonTitleEs: lesson.titleEs,
      messageIndex: repoProgress.currentMessageIndex,
      totalMessages: lesson.messages.length,
      reminderNumber: repoProgress.remindersSent + 1,
      maxReminders: MAX_REMINDERS,
    };
    return {
      routerResult: {
        mode: InteractionMode.REMINDER,
        reminder,
      },
      progress,
      repoProgress,
    };
  }

  // ── Priority 1: Mid-lesson (messageIndex > 0) ──
  if (hasLesson && repoProgress.currentMessageIndex > 0) {
    const lesson = getLessonData(collectionKey, repoProgress.currentLessonNumber);

    // ── Check for gated assessment first ──
    // If student has passed all teach messages before a gate, route to assessment
    const gateState = await checkGatePosition(socio.id, repoProgress, collectionKey);
    if (gateState) {
      return {
        routerResult: {
          mode: InteractionMode.GATED_ASSESSMENT,
          gatedAssessment: gateState,
        },
        progress,
        repoProgress,
      };
    }

    if (repoProgress.currentMessageIndex < lesson.messages.length) {
      // Check if reteach is needed from two signals:
      // 1. Explicit low understanding score (on last message)
      // 2. Continuous dimension state showing low comprehension
      const dimensionTriggersReteach = shouldReteachFromDimensions(dimensionState);

      if (repoProgress.currentMessageIndex === lesson.messages.length - 1) {
        const score = parseScore(incomingText);
        // Trigger reteach if EITHER:
        // - User gave an explicit low score, OR
        // - Dimension sensing shows low comprehension with reasonable confidence
        if ((score !== null && score <= RETEACH_THRESHOLD) || dimensionTriggersReteach) {
          return {
            routerResult: {
              mode: InteractionMode.RETEACH,
              reteach: {
                lessonNumber: repoProgress.currentLessonNumber,
                lessonTitleEs: lesson.titleEs,
                understandingScore: score ?? Math.round(dimensionState?.['comprehension']?.level ?? 3),
              },
            },
            progress,
            repoProgress,
            reteachFromDimension: dimensionTriggersReteach && score === null,
          };
        }
      }

      const lessonState = buildLessonDeliveryState(repoProgress, collectionKey);
      return {
        routerResult: {
          mode: InteractionMode.LESSON_DELIVERY,
          lesson: lessonState ?? undefined,
        },
        progress,
        repoProgress,
      };
    }
  }

  // ── Priority 2: Ready for a new lesson (messageIndex == 0, within range) ──
  if (
    repoProgress.currentMessageIndex === 0 &&
    repoProgress.currentLessonNumber <= MAX_LESSON_NUMBER &&
    hasLesson
  ) {
    const lessonState = buildLessonDeliveryState(repoProgress, collectionKey);
    return {
      routerResult: {
        mode: InteractionMode.LESSON_START,
        lesson: lessonState ?? undefined,
      },
      progress,
      repoProgress,
    };
  }

  // ── Default: Freeform question ──
  return {
    routerResult: {
      mode: InteractionMode.FREEFORM_QUESTION,
    },
    progress,
    repoProgress,
  };
}

// ─── Score Parser ───────────────────────────────────────────────────
// Exported so the webhook can also use it for extracting scores.

const SPANISH_NUMBERS: Record<string, number> = {
  uno: 1, una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

export function parseScore(text: string): number | null {
  const cleaned = text.trim().toLowerCase();

  // "7/10" or "7 de 10"
  const slashMatch = cleaned.match(/(\d{1,2})\s*(?:\/|de)\s*10/);
  if (slashMatch) {
    const n = parseInt(slashMatch[1], 10);
    if (n >= 1 && n <= 10) return n;
  }

  // Plain number: "7"
  const numMatch = cleaned.match(/^(\d{1,2})$/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= 10) return n;
  }

  // Spanish word: "siete"
  for (const [word, value] of Object.entries(SPANISH_NUMBERS)) {
    if (cleaned.includes(word)) return value;
  }

  return null;
}
