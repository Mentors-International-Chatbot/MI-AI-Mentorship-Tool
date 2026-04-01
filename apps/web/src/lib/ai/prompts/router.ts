import { repo } from '@/lib/repo';
import { Socio } from '@/lib/repo/types';
import { SocioProgress as RepoSocioProgress } from '@/lib/repo/types';
import { getLessonData, hasLessonData } from '@/lib/lessons/data';
import { RETEACH_THRESHOLD, MAX_LESSON_NUMBER, FOLLOWUP_ENABLED, MAX_REMINDERS } from './constants';
import {
  InteractionMode,
  SocioProgress,
  RouterResult,
  LessonDeliveryState,
  ReminderState,
} from './types';

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
): LessonDeliveryState | null {
  if (!hasLessonData(repoProgress.currentLessonNumber)) return null;

  const lesson = getLessonData(repoProgress.currentLessonNumber);
  const msgIndex = repoProgress.currentMessageIndex;
  const message = lesson.messages[msgIndex];
  if (!message) return null;

  const prevLessonNum = repoProgress.currentLessonNumber - 1;
  const prevTitle = prevLessonNum >= 1 && hasLessonData(prevLessonNum)
    ? getLessonData(prevLessonNum).titleEs
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

export interface DetermineModeResult {
  routerResult: RouterResult;
  progress: SocioProgress;
  repoProgress: RepoSocioProgress;
}

export async function determineMode(
  socio: Socio,
  incomingText: string,
): Promise<DetermineModeResult> {
  const repoProgress = await repo.getSocioProgress(socio.id);

  const lastMessages = await repo.getMessages(socio.id, 1);
  const lastMsg = lastMessages[lastMessages.length - 1];
  const daysSince = lastMsg
    ? Math.floor((Date.now() - lastMsg.createdAt.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const progress = repoProgressToPromptProgress(repoProgress, daysSince);

  // Can we load lesson data for the current lesson?
  const hasLesson = hasLessonData(repoProgress.currentLessonNumber);

  const trimmed = incomingText.trim();
  const startNextPatterns =
    /^(siguiente|next|próxima|próximo|empezar|comenzar|start|lección\s*\d+)/i;
  if (
    startNextPatterns.test(trimmed) &&
    repoProgress.currentMessageIndex === 0 &&
    hasLesson
  ) {
    const lessonState = buildLessonDeliveryState(repoProgress);
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
    const lesson = getLessonData(repoProgress.currentLessonNumber);
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
    const lesson = getLessonData(repoProgress.currentLessonNumber);

    if (repoProgress.currentMessageIndex < lesson.messages.length) {
      // Check if the user just gave a low understanding score (on last message)
      if (repoProgress.currentMessageIndex === lesson.messages.length - 1) {
        const score = parseScore(incomingText);
        if (score !== null && score <= RETEACH_THRESHOLD) {
          return {
            routerResult: {
              mode: InteractionMode.RETEACH,
              reteach: {
                lessonNumber: repoProgress.currentLessonNumber,
                lessonTitleEs: lesson.titleEs,
                understandingScore: score,
              },
            },
            progress,
            repoProgress,
          };
        }
      }

      const lessonState = buildLessonDeliveryState(repoProgress);
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
    const lessonState = buildLessonDeliveryState(repoProgress);
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
