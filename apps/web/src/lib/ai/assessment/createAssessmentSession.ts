/**
 * Assessment Session Creation Service
 * ═══════════════════════════════════════════════════════════════════════════
 * Creates assessment sessions with config resolved from the journey package.
 *
 * CRITICAL: Config must come from the journey package, NOT hardcoded defaults.
 * Missing config is a bug, not a default case.
 *
 * Config resolution precedence (later wins):
 *   1. config.assessment.passing (from ProgramVersion.config)
 *   2. block.passingOverride (from the specific teach_back block)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { TenantContext } from '@/lib/repo/tenantContext';
import type { TenantRepo, AssessmentSession } from '@/lib/repo/tenantRepo.types';
import type { ProgramVersionConfig } from '@/lib/journey-package/program-version-config.schema';
import type { PackageLesson, LessonBlock, TrackedDimension, PassingConfig, ResponseStyle } from '@/lib/journey-package/journey-package.schema';
import { resolveDelivery, type DeliveryConfig } from '@/lib/journey-package/delivery';
import { mergeAssessmentConfig } from '@/lib/journey-package/mergeAssessmentConfig';
import { DEFAULT_RESPONSE_STYLE } from '@/lib/player/responseStyle';
import { createInitialSessionState } from './senseAssessmentTurn';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface CreateSessionParams {
  ctx: TenantContext;
  repo: TenantRepo;
  socioId: string;
  lessonKey: string;
  blockId: string;
  /** Delivery channel (whatsapp/web) - captured at session creation */
  channel: string;
  /**
   * A.4 (Platform Restructure Phase A). Pass it when the caller already has
   * one (the player-surface gate does, via ValidatedPlayerContext). Omitted
   * by the standalone /api/assessment/start retake path, which has no
   * PlayerAccess — repo.createAssessmentSession resolves it internally in
   * that case.
   */
  enrollmentId?: string;
  /**
   * A.5 (Platform Restructure Phase A, Stage 5). The enrollment-derived
   * course for this session (playerContext.collectionKey when this is a
   * player-surface gate trigger). Without it, resolveProgramConfig fell back
   * to socio.curriculumCollectionKey — the single legacy field — even when
   * the caller already knew the right course, the same content-mismatch
   * shape as messaging/handler.ts:461 before its A.5 fix. Structurally
   * absent for /api/assessment/start (no course in that request's shape at
   * all) and the chat-surface gate trigger (no PlayerAccess) — both keep the
   * curriculumCollectionKey fallback; see resolveProgramConfig's comment.
   */
  collectionKey?: string;
}

export interface SessionConfigSnapshot {
  // Delivery surface resolved once from ProgramVersion.metadata
  surface: DeliveryConfig['surface'];
  // Passing criteria (merged from config + block override)
  passing: {
    dimensionKey: string;
    threshold: number;
    confidenceFloor: number;
    minTurns: number;
    maxTurns: number;
  };
  // What the student sees
  studentVisibleDimensionKeys: string[];
  // Coarse learner score/feedback visibility gate
  showScoreToLearner: boolean;
  // What becomes MetricObservations
  recordedDimensionKeys: string[];
  // Max turns policy
  onMaxTurnsWithoutPass: 'complete_with_scores' | 'return_for_reteach' | 'flag_mentor';
  // Retake and blocking
  allowRetake: boolean;
  blocking: boolean;
  // Tracked dimensions for sensing
  trackedDimensions: TrackedDimension[];
  // AI behavior
  aiBehavior: {
    tone?: string;
    teachingStyle?: string;
    languageInstruction?: string;
  };
  // Block-specific config
  teachBackPrompt: string;
  keyConcepts: string[];
  evaluatesConcepts: string[];
  lessonContext: string;
  // Learner-visible generation limits for the probe conversation. Defaults
  // ON (see DEFAULT_RESPONSE_STYLE) when the course config doesn't declare
  // its own — every course that has shipped without one has needed it added
  // back in after the fact. Absent on snapshots created before this field
  // existed; getSessionConfig leaves those as-is rather than backfilling.
  responseStyle?: ResponseStyle;
}

export class AssessmentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssessmentConfigError';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Config Resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolves the ProgramVersion.config for a socio's active curriculum.
 *
 * A.5: prefers the caller-supplied collectionKey (the player-surface gate
 * trigger has one, enrollment-derived via playerContext). Falling back to
 * socio.curriculumCollectionKey — G3's root cause pattern: current state
 * standing in for a historical/contextual fact — is structurally required
 * for /api/assessment/start (no course anywhere in that request) and the
 * chat-surface gate trigger (no PlayerAccess to carry one). Both are
 * chat/legacy-shaped call sites, not bugs to fix here.
 */
async function resolveProgramConfig(
  ctx: TenantContext,
  repo: TenantRepo,
  socioId: string,
  collectionKeyOverride?: string,
): Promise<{ config: ProgramVersionConfig; collectionKey: string; surface: DeliveryConfig['surface'] }> {
  const collectionKey = collectionKeyOverride ?? await repo.getSocioCurriculumCollectionKey(socioId);

  if (!collectionKey) {
    throw new AssessmentConfigError(
      `Socio ${socioId} has no curriculumCollectionKey assigned`
    );
  }

  // Find the active ProgramVersion that references this collection
  const programVersion = await repo.getActiveProgramVersionByCollection(ctx, collectionKey);

  if (!programVersion) {
    throw new AssessmentConfigError(
      `No active ProgramVersion found for collection "${collectionKey}"`
    );
  }

  return {
    config: programVersion.config as ProgramVersionConfig,
    collectionKey,
    surface: resolveDelivery(programVersion.metadata).surface,
  };
}

/**
 * Resolves the lesson and locates the gated teach_back block.
 */
async function resolveLessonAndBlock(
  ctx: TenantContext,
  repo: TenantRepo,
  collectionKey: string,
  lessonKey: string,
  blockId: string,
): Promise<{ lesson: PackageLesson; block: LessonBlock & { blockType: 'teach_back' } }> {
  // Get the lesson version
  const lessonVersion = await repo.getActiveLessonVersionBySlug(ctx, collectionKey, lessonKey);

  if (!lessonVersion) {
    throw new AssessmentConfigError(
      `No active lesson found for key "${lessonKey}" in collection "${collectionKey}"`
    );
  }

  const lesson = lessonVersion.body as unknown as PackageLesson;
  if (!lesson || !lesson.blocks) {
    throw new AssessmentConfigError(
      `Lesson "${lessonKey}" has no blocks`
    );
  }

  // Find the specific teach_back block
  const block = lesson.blocks.find(
    (b) => b.id === blockId && b.blockType === 'teach_back'
  );

  if (!block) {
    throw new AssessmentConfigError(
      `Block "${blockId}" not found in lesson "${lessonKey}" or is not a teach_back block`
    );
  }

  // Legacy chat packages use delivery="gated_session"; Track E player
  // packages use the explicit block assessment mode. Both reach the same
  // channel-agnostic conversational session core.
  const teachBackBlock = block as LessonBlock & { blockType: 'teach_back'; delivery?: string };
  if (teachBackBlock.delivery !== 'gated_session' && teachBackBlock.assessment?.mode !== 'reteach_gate') {
    throw new AssessmentConfigError(
      `Block "${blockId}" is not a gated teach_back block (delivery: "${teachBackBlock.delivery || 'inline'}")`
    );
  }

  return {
    lesson,
    block: teachBackBlock as LessonBlock & { blockType: 'teach_back' },
  };
}

/**
 * Builds the complete config snapshot for a session.
 */
function buildConfigSnapshot(
  programConfig: ProgramVersionConfig,
  lesson: PackageLesson,
  block: LessonBlock & { blockType: 'teach_back' },
  surface: DeliveryConfig['surface'],
): SessionConfigSnapshot {
  const assessment = programConfig.assessment;
  if (!assessment) {
    throw new AssessmentConfigError(
      'ProgramVersion.config.assessment is missing. Gated assessments require assessment config.'
    );
  }

  // Extract teach_back block fields
  const teachBackBlock = block as LessonBlock & {
    blockType: 'teach_back';
    prompt: string;
    evaluatesConcepts?: string[];
    passingOverride?: Partial<PassingConfig>;
  };

  const mergedAssessment = mergeAssessmentConfig(
    assessment,
    block.assessment,
    teachBackBlock.passingOverride,
  );
  const passing = mergedAssessment.passing;

  // Resolve dimension keys
  const trackedDimensions = programConfig.trackedDimensions || [];
  const allDimensionKeys = trackedDimensions.map((d) => d.key);

  const studentVisibleDimensionKeys =
    assessment.studentVisibleDimensionKeys ?? [passing.dimensionKey];
  const recordedDimensionKeys =
    assessment.recordedDimensionKeys ?? allDimensionKeys;

  return {
    surface,
    passing,
    studentVisibleDimensionKeys,
    showScoreToLearner: mergedAssessment.showScoreToLearner,
    recordedDimensionKeys,
    onMaxTurnsWithoutPass: assessment.onMaxTurnsWithoutPass ?? 'complete_with_scores',
    allowRetake: mergedAssessment.allowRetake,
    blocking: assessment.blocking ?? true,
    trackedDimensions,
    aiBehavior: programConfig.aiBehavior || {},
    teachBackPrompt: teachBackBlock.prompt,
    keyConcepts: lesson.keyConcepts || [],
    evaluatesConcepts: teachBackBlock.evaluatesConcepts || [],
    lessonContext: `${lesson.title}: ${lesson.keyConcepts?.join('; ') || ''}`,
    responseStyle: programConfig.responseStyle ?? DEFAULT_RESPONSE_STYLE,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Export
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a new assessment session with config resolved from the journey package.
 *
 * THROWS if:
 * - Socio has no curriculumCollectionKey
 * - No active ProgramVersion found
 * - config.assessment is missing
 * - Lesson or block not found
 * - Block is not a gated_session teach_back
 *
 * These are configuration bugs, NOT cases to fall back to defaults.
 */
export async function createAssessmentSession(
  params: CreateSessionParams,
): Promise<AssessmentSession> {
  const { ctx, repo, socioId, lessonKey, blockId, channel, enrollmentId, collectionKey: collectionKeyOverride } = params;

  // ─── 1. Resolve program config ────────────────────────────────────────────
  const { config: programConfig, collectionKey, surface } = await resolveProgramConfig(ctx, repo, socioId, collectionKeyOverride);

  // ─── 2. Resolve lesson and block ──────────────────────────────────────────
  const { lesson, block } = await resolveLessonAndBlock(ctx, repo, collectionKey, lessonKey, blockId);

  // ─── 3. Build config snapshot ─────────────────────────────────────────────
  const configSnapshot = buildConfigSnapshot(programConfig, lesson, block, surface);

  // ─── 4. Check for existing open session ───────────────────────────────────
  const existingSessions = await repo.getAssessmentSessionsForSocio(ctx, socioId);
  // A.6.2: scope to the current enrollment when the caller has one — every
  // player-surface gate does — so a retake's open-session check and attempt
  // count start fresh instead of inheriting the prior enrollment's history.
  // Chat-surface callers with no course signal to resolve an enrollmentId
  // from (the /api/assessment/start route — see A.6.5) keep the pre-A.6.2
  // lifetime-by-socio scope; that gap is deferred, not silently changed here.
  const scopedSessions = enrollmentId
    ? existingSessions.filter((s) => s.enrollmentId === enrollmentId)
    : existingSessions;
  const openSession = scopedSessions.find(
    (s) => s.lessonKey === lessonKey && s.blockId === blockId && s.status !== 'completed'
  );

  if (openSession) {
    throw new AssessmentConfigError(
      `An assessment session is already open for lesson "${lessonKey}" block "${blockId}"`
    );
  }

  // ─── 5. Determine attempt number ──────────────────────────────────────────
  const completedSessions = scopedSessions.filter(
    (s) => s.lessonKey === lessonKey && s.blockId === blockId && s.status === 'completed'
  );
  const attemptNumber = completedSessions.length + 1;

  // ─── 6. Create initial state ──────────────────────────────────────────────
  const initialState = createInitialSessionState(configSnapshot.trackedDimensions);

  // ─── 7. Create session ────────────────────────────────────────────────────
  const session = await repo.createAssessmentSession(ctx, {
    socioId,
    lessonKey,
    blockId,
    channel,
    configSnapshot: configSnapshot as unknown as Record<string, unknown>,
    attemptNumber,
    enrollmentId,
  });

  // ─── 8. Update with initial state ─────────────────────────────────────────
  return repo.updateAssessmentSession(ctx, session.id, {
    liveState: initialState as Record<string, unknown>,
  });
}

/**
 * Gets the config snapshot from an existing session.
 * Use this in turn pipeline and completion - NEVER read from journey package there.
 */
export function getSessionConfig(session: AssessmentSession): SessionConfigSnapshot {
  const snapshot = session.configSnapshot as SessionConfigSnapshot | null;
  if (!snapshot) {
    throw new AssessmentConfigError(
      `Session ${session.id} has no configSnapshot`
    );
  }
  // Rows created before Track E have neither field. They are all legacy chat
  // sessions, and showScoreToLearner's schema default is false.
  return {
    ...snapshot,
    surface: snapshot.surface ?? 'chat',
    showScoreToLearner: snapshot.showScoreToLearner ?? false,
  };
}
