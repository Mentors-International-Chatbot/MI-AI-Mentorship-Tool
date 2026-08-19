import { repo } from '@/lib/repo';
import { Socio, SocioFlag } from '@/lib/repo/types';
import { SocioProgress as RepoSocioProgress } from '@/lib/repo/types';
import { getLessonData, hasLessonData } from '@/lib/lessons/db-lesson-service';
// FOLLOWUP_ENABLED and MAX_REMINDERS are no longer read here: they gated the
// removed REMINDER branch and now belong solely to `/api/cron/reminders`.
import {
  RETEACH_THRESHOLD,
  MAX_LESSON_NUMBER,
  RETEACH_LEVEL_THRESHOLD,
} from './constants';
import {
  InteractionMode,
  SocioProgress,
  RouterResult,
  LessonDeliveryState,
  GatedAssessmentState,
} from './types';
import type { DimensionStateMap } from '@/lib/ai/sensing/types';
import { resolveStance, type StanceDecision } from './stance';
import { createGateSessionLoader, type GateSessionLoader } from './gateSessions';
import { resolvePromptScope } from './resolveScope';
import { resolveCourseMilestones } from './courseOutcome';
import { canDeliverGatedAssessment } from '@/lib/ai/assessment/channelSupport';
import { readGateRecency, type GateRecency } from './gateRecency';
import type { DeliveryConfig } from '@/lib/journey-package/delivery';

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
  repoProgress: RepoSocioProgress,
  collectionKey: string,
  loadGateSessions: GateSessionLoader,
  channelType: string,
): Promise<GatedAssessmentState | null> {
  if (!hasLessonData(collectionKey, repoProgress.currentLessonNumber)) return null;

  const lesson = getLessonData(collectionKey, repoProgress.currentLessonNumber);
  const msgIndex = repoProgress.currentMessageIndex;

  // A gate this channel cannot deliver must not block progression. Returning
  // the gate state here on WhatsApp is what bricked those accounts: the handler
  // suppresses the message when an open session exists, so every subsequent
  // turn answered with an empty string. See assessment/channelSupport.ts.
  if (!canDeliverGatedAssessment(channelType) && lesson.gates.length > 0) {
    console.warn(
      `[Router] Skipping ${lesson.gates.length} gate(s) on lesson ${lesson.lessonKey} — ` +
        `channel "${channelType}" cannot deliver a gated assessment. Progression continues.`,
    );
    return null;
  }

  // Check each gate to see if we've passed all teach messages before it
  for (const gate of lesson.gates) {
    // Gate activates when currentMessageIndex > afterMessageIndex
    // This means student has completed all messages up to and including afterMessageIndex
    if (msgIndex > gate.afterMessageIndex) {
      // Shared with stance's own read of these rows — see gateSessions.ts.
      const sessions = await loadGateSessions(lesson.lessonKey, gate.blockId);

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
  /**
   * Active (unresolved, un-snoozed, not auto-closed) flags for this socio,
   * fetched once here so stance selection and Layer 2 share one query instead
   * of each running their own.
   */
  activeFlags?: SocioFlag[];
  /** Milestone keys already reached. Present only when stance is coach. */
  reachedMilestoneKeys?: ReadonlySet<string>;
  /**
   * The current lesson's most recent gate resolution, and whether the AI has
   * had a chance to acknowledge it. Absent when the lesson has no gate, the
   * channel cannot deliver one, or no attempt has completed. Rendered by
   * Layer 2; deliberately NOT an input to stance, which asks the durable
   * question rather than the recent one.
   */
  gateRecency?: GateRecency;
}

/**
 * The legacy curriculum router belongs only to the chat delivery surface.
 * Requiring the discriminator in the function type makes a player caller a
 * compile error instead of relying on a course-code check or an internal
 * suppression branch.
 */
export type ChatDelivery = DeliveryConfig & { surface: 'chat' };

/**
 * Milestone keys this learner has reached, fetched at most once per turn and
 * only when something actually asks.
 *
 * The `declared.length === 0` short circuit is what keeps the ungated stance
 * ladder free for courses like the legacy MI collection, which declare no
 * outcome at all: both lookups it consults are process-level caches, so a
 * course with no milestones never touches the database for this.
 */
function createReachedMilestoneLoader(
  socioId: string,
  collectionKey: string,
): () => Promise<ReadonlySet<string>> {
  let pending: Promise<ReadonlySet<string>> | null = null;

  return () => {
    if (!pending) {
      pending = (async () => {
        const scope = await resolvePromptScope(collectionKey);
        const declared = await resolveCourseMilestones(scope);
        if (declared.length === 0) return new Set<string>();

        const rows = await repo.getMilestoneProgress(socioId, collectionKey);
        return new Set(rows.map((r) => r.milestoneKey));
      })();
    }
    return pending;
  };
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

/**
 * Picks the turn type AND the stance, the two independent router axes.
 *
 * Mode selection is unchanged and lives in `determineTurnType`. Stance is
 * layered on top rather than folded in, because the two answer different
 * questions and their inputs barely overlap: mode reads lesson position, stance
 * reads distress flags and gate results. Keeping them separate is also what
 * lets the stance rules be read in one place.
 */
export async function determineMode(
  _delivery: ChatDelivery,
  socio: Socio,
  incomingText: string,
  collectionKey: string,
  dimensionState?: DimensionStateMap,
  /**
   * Progress the caller already read. `service.ts` needs it before this call to
   * build the sensing pass's lesson context, and re-reading it here was a
   * second round trip for a value that cannot have changed in between.
   */
  prefetchedProgress?: RepoSocioProgress,
): Promise<DetermineModeResult> {
  // One loader for the whole turn, shared by the router's progression check and
  // stance's pass check. See gateSessions.ts for why they must not share the
  // *answer*, only the rows.
  const loadGateSessions = createGateSessionLoader(socio.id);

  // One loader for the turn, shared by the "days since last contact" figure and
  // the gate-recency read. Both want the same instant and neither always runs.
  const loadLastAssistantAt = createLastAssistantAtLoader(socio.id);

  const core = await determineTurnType(
    socio, incomingText, collectionKey, dimensionState, loadGateSessions,
    loadLastAssistantAt, prefetchedProgress,
  );

  // GATED_ASSESSMENT never reaches Layer 3 — service.ts returns the gate prompt
  // before buildSystemPrompt is called — so selecting a stance for it would be
  // two queries spent on a prompt that is never assembled.
  if (core.routerResult.mode === InteractionMode.GATED_ASSESSMENT) return core;

  // One read, two consumers: stance rule (a) below and the "active flags" line
  // in Layer 2, which asserted "None" unconditionally before this change.
  let activeFlags: SocioFlag[] = [];
  try {
    activeFlags = await repo.getActiveFlags(socio.id);
  } catch (error) {
    // Failing closed here would mean silently treating a distressed learner as
    // undistressed, so the failure is logged rather than swallowed. Stance then
    // falls through to the gate rules, which is the pre-existing behaviour.
    console.error(`[Router] Failed to read active flags for socio ${socio.id}:`, error);
  }

  // Milestone progress is now BOTH an input to the stance decision (the first
  // rung of the ungated ladder) and something coach stance renders. One
  // memoized loader serves both, so a turn reads the rows at most once.
  //
  // It stays lazy because most turns never need it: a gated lesson decides on
  // gates alone, and a course that declares no milestones has nothing to read.
  // That second check runs against two process-level caches, not the database.
  const loadReachedMilestones = createReachedMilestoneLoader(socio.id, collectionKey);

  const stance: StanceDecision = await resolveStance({
    socioId: socio.id,
    promptOverrides: socio.promptOverrides,
    collectionKey,
    currentLessonNumber: core.repoProgress.currentLessonNumber,
    currentMessageIndex: core.repoProgress.currentMessageIndex,
    weeklyUnderstanding: core.repoProgress.weeklyUnderstanding,
    // Same fact the progression check consults: a gate this channel cannot
    // deliver is not a bar the learner failed to clear.
    channelType: socio.channelType,
    activeFlags,
    reteachThisTurn: core.routerResult.mode === InteractionMode.RETEACH,
    loadGateSessions,
    loadReachedMilestones,
  });

  // Tutor's prompt does not mention the project at all, so only coach renders
  // these. On a coach turn reached via the milestone rung the loader has
  // already run and this costs nothing.
  let reachedMilestoneKeys: ReadonlySet<string> | undefined;
  if (stance.stance === 'coach') {
    try {
      reachedMilestoneKeys = await loadReachedMilestones();
    } catch (error) {
      // Losing progress for a turn renders every milestone as pending, which
      // is wrong but harmless — the marker path validates and dedupes anyway.
      console.error(`[Router] Failed to read milestone progress for ${socio.id}:`, error);
    }
  }

  // Gate recency for Layer 2. Reuses the turn's gate-session loader, so on a
  // lesson whose sessions were already read this adds no gate query at all —
  // only the lazy "when did the AI last speak" lookup, and only when a
  // completed session actually exists.
  let gateRecency: GateRecency | undefined;
  try {
    gateRecency = (await readGateRecency({
      collectionKey,
      lessonNumber: core.repoProgress.currentLessonNumber,
      loadGateSessions,
      loadLastAssistantAt,
      channelType: socio.channelType,
    })) ?? undefined;
  } catch (error) {
    // Losing the recency line costs the AI one fact; failing the turn costs the
    // learner their reply.
    console.error(`[Router] Failed to read gate recency for socio ${socio.id}:`, error);
  }

  return {
    ...core,
    routerResult: { ...core.routerResult, stance },
    activeFlags,
    reachedMilestoneKeys,
    gateRecency,
  };
}

/** Memoized so a turn asks at most once, and only if something asks at all. */
function createLastAssistantAtLoader(socioId: string): () => Promise<Date | null> {
  let pending: Promise<Date | null> | null = null;
  return () => {
    if (!pending) pending = repo.getLastAssistantMessageAt(socioId);
    return pending;
  };
}

async function determineTurnType(
  socio: Socio,
  incomingText: string,
  collectionKey: string,
  dimensionState: DimensionStateMap | undefined,
  loadGateSessions: GateSessionLoader,
  loadLastAssistantAt: () => Promise<Date | null>,
  prefetchedProgress?: RepoSocioProgress,
): Promise<DetermineModeResult> {
  // ── Days since last contact ─────────────────────────────────────────────
  // Measured from when the AI last spoke, NOT from the last message.
  //
  // This used to read `getMessages(socio.id, 1)`, which on the inbound path is
  // the learner's own message — `handleIncomingMessage` persists it before
  // calling into generation. The gap was therefore always zero, and Layer 2 has
  // been asserting "Days since last contact: 0" into every prompt since launch
  // regardless of whether the learner had been gone a month. Same class of
  // defect as the old "Active flags: None": not a missing signal, a false one.
  //
  // The AI's last message is the honest reference point: it is the last thing
  // that happened before the learner came back, and it cannot be polluted by
  // the turn currently being handled.
  const [repoProgress, lastAssistantAt] = await Promise.all([
    prefetchedProgress ?? repo.getSocioProgress(socio.id),
    loadLastAssistantAt(),
  ]);

  const daysSince = lastAssistantAt
    ? Math.max(0, Math.floor((Date.now() - lastAssistantAt.getTime()) / (1000 * 60 * 60 * 24)))
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

  // ── REMINDER is not routable from here, deliberately ────────────────────
  // There used to be a Priority 0 branch returning REMINDER when a learner
  // came back mid-lesson after a day. It never fired, because `daysSince` was
  // structurally zero (see above) — and fixing that would have activated it
  // into a regression, not a feature.
  //
  // The reminder prompt is written for an UNPROMPTED nudge: "Hi Ana, we were
  // talking about pricing. Want to continue? 😊". It has no slot for anything
  // the learner said. Firing it on an inbound message means a learner who
  // returns after two days with a real question gets that question ignored and
  // a nudge in reply.
  //
  // Unprompted nudges belong to `/api/cron/reminders`, which builds its own
  // REMINDER RouterResult, has no learner message to ignore, and already
  // handles this. The mode and its /admin/prompts category stay live for that
  // caller; only the unreachable branch is gone, along with REMINDER's
  // membership in ROUTABLE_MODES.

  // ── Priority 1: Mid-lesson (messageIndex > 0) ──
  if (hasLesson && repoProgress.currentMessageIndex > 0) {
    const lesson = getLessonData(collectionKey, repoProgress.currentLessonNumber);

    // ── Check for gated assessment first ──
    // If student has passed all teach messages before a gate, route to assessment
    const gateState = await checkGatePosition(
      repoProgress, collectionKey, loadGateSessions, socio.channelType,
    );
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
