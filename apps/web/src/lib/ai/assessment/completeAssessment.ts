/**
 * Assessment Completion Service
 * ═══════════════════════════════════════════════════════════════════════════
 * Finalizes an assessment session: writes MetricObservations, updates session
 * status, and returns the score report.
 *
 * Called when:
 *   - Student passes (status: 'passed')
 *   - Max turns reached (status: 'max_turns')
 *   - Session cancelled (no observations written)
 *
 * CRITICAL: MetricObservations are written for the flywheel/mentor dashboard.
 * These are the permanent records that feed alerts and progress tracking.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { TenantContext } from '@/lib/repo/tenantContext';
import type { TenantRepo, AssessmentSession, MetricObservation, ObservationSource, Alert } from '@/lib/repo/tenantRepo.types';
import type { DimensionStateMap } from '@/lib/ai/sensing/types';
import { evaluateAlerts } from '@/lib/alerts/evaluateAlerts';
import { repo as socioRepo } from '@/lib/repo';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface CompletionConfig {
  /** Dimension keys to write as MetricObservations */
  recordedDimensionKeys: string[];
  /** The gating dimension for pass/fail */
  passingDimensionKey: string;
  /** Dimension keys visible to student in the report */
  studentVisibleDimensionKeys: string[];
  /** Policy when max turns reached */
  onMaxTurnsPolicy: 'complete_with_scores' | 'return_for_reteach' | 'flag_mentor';
  /** Whether the student can retry after failing */
  allowRetake: boolean;
}

export type CompletionOutcome =
  | 'passed'           // Student demonstrated sufficient understanding
  | 'max_turns'        // Turn limit reached
  | 'cancelled';       // Session cancelled (no observations written)

export interface CompletionResult {
  outcome: CompletionOutcome;
  /** Scores visible to the student */
  studentScores: Record<string, number>;
  /** All scores (for mentor dashboard) */
  allScores: Record<string, number>;
  /** IDs of created MetricObservations */
  observationIds: string[];
  /** Whether a mentor flag was raised */
  mentorFlagged: boolean;
  /** Alerts created by rule evaluation */
  alertsCreated: Alert[];
  /** Updated session object */
  session: AssessmentSession;
  /** Whether return_for_reteach was triggered (lesson pointer reset) */
  reteachTriggered: boolean;
  /** Whether gate was unblocked due to no-dead-end rule */
  unlockedByNoDeadEnd: boolean;
}

export interface CompleteAssessmentParams {
  ctx: TenantContext;
  repo: TenantRepo;
  sessionId: string;
  /** Socio ID for lesson pointer reset (return_for_reteach) */
  socioId: string;
  finalState: DimensionStateMap;
  outcome: CompletionOutcome;
  config: CompletionConfig;
  /** Enrollment ID for linking observations (optional, looked up if not provided) */
  enrollmentId?: string | null;
  /** Delivery channel the assessment was taken on (whatsapp/web) */
  channel: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Score Extraction
// ═══════════════════════════════════════════════════════════════════════════

function extractScores(
  state: DimensionStateMap,
  keys: string[],
): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const key of keys) {
    const dimState = state[key];
    if (dimState) {
      scores[key] = dimState.level;
    }
  }
  return scores;
}

function extractAllScores(state: DimensionStateMap): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const [key, dimState] of Object.entries(state)) {
    scores[key] = dimState.level;
  }
  return scores;
}

// ═══════════════════════════════════════════════════════════════════════════
// MetricObservation Writer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Looks up MetricDefinition IDs by dimension keys.
 * Returns a map of dimensionKey -> metricId.
 */
async function lookupMetricIds(
  ctx: TenantContext,
  repo: TenantRepo,
  dimensionKeys: string[],
): Promise<Map<string, string>> {
  const metricMap = new Map<string, string>();

  for (const key of dimensionKeys) {
    const metric = await repo.getMetricDefinitionByKey(ctx, key);
    if (metric) {
      metricMap.set(key, metric.id);
    } else {
      console.warn(`[CompleteAssessment] No MetricDefinition found for key: ${key}`);
    }
  }

  return metricMap;
}

/**
 * Creates MetricObservation records for the recorded dimensions.
 */
async function writeObservations(params: {
  ctx: TenantContext;
  repo: TenantRepo;
  state: DimensionStateMap;
  metricMap: Map<string, string>;
  enrollmentId: string | null;
  sessionId: string;
  channel: string;
}): Promise<string[]> {
  const { ctx, repo, state, metricMap, enrollmentId, sessionId, channel } = params;
  const observationIds: string[] = [];
  const now = new Date();

  for (const [dimensionKey, metricId] of metricMap) {
    const dimState = state[dimensionKey];
    if (!dimState) continue;

    const observationData: Omit<MetricObservation, 'id' | 'createdAt'> = {
      metricId,
      enrollmentId,
      signalType: 'assessment_session',
      value: dimState.level,
      confidence: dimState.confidence,
      evidenceRefs: {
        sessionId,
        channel,
        evidence: dimState.evidence,
        trend: dimState.trend,
      },
      modelVersion: 'assessment-v1',
      promptVersion: null,
      verificationStatus: null,
      source: 'ai_inferred' as ObservationSource,
      observedAt: now,
    };

    try {
      const observation = await repo.createObservation(ctx, observationData);
      observationIds.push(observation.id);
    } catch (error) {
      console.error(`[CompleteAssessment] Failed to write observation for ${dimensionKey}:`, error);
      // Continue with other observations
    }
  }

  return observationIds;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Completion Logic
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Completes an assessment session.
 *
 * This is the final step after runAssessmentTurn returns a terminal outcome.
 * It persists scores as MetricObservations and updates the session status.
 *
 * @param params - Completion parameters
 * @returns CompletionResult with scores and created observation IDs
 */
export async function completeAssessment(
  params: CompleteAssessmentParams,
): Promise<CompletionResult> {
  const { ctx, repo, sessionId, socioId, finalState, outcome, config, enrollmentId, channel } = params;
  const { recordedDimensionKeys, studentVisibleDimensionKeys, passingDimensionKey, onMaxTurnsPolicy, allowRetake } = config;

  const now = new Date();
  let observationIds: string[] = [];
  let mentorFlagged = false;
  let reteachTriggered = false;
  let unlockedByNoDeadEnd = false;

  // ─── Step 1: Extract scores ───────────────────────────────────────────────
  const studentScores = extractScores(finalState, studentVisibleDimensionKeys);
  const allScores = extractAllScores(finalState);

  // ─── Step 2: Handle outcome-specific logic ────────────────────────────────
  if (outcome === 'cancelled') {
    // No observations written for cancelled sessions
    const session = await repo.updateAssessmentSession(ctx, sessionId, {
      status: 'completed',
      completedAt: now,
      scores: allScores,
      liveState: finalState as Record<string, unknown>,
    });

    return {
      outcome,
      studentScores,
      allScores,
      observationIds: [],
      mentorFlagged: false,
      alertsCreated: [],
      session,
      reteachTriggered: false,
      unlockedByNoDeadEnd: false,
    };
  }

  // ─── Step 3: Look up MetricDefinition IDs ─────────────────────────────────
  const metricMap = await lookupMetricIds(ctx, repo, recordedDimensionKeys);

  // ─── Step 4: Write MetricObservations ─────────────────────────────────────
  observationIds = await writeObservations({
    ctx,
    repo,
    state: finalState,
    metricMap,
    enrollmentId: enrollmentId ?? null,
    sessionId,
    channel,
  });

  // ─── Step 5: Evaluate alert rules ─────────────────────────────────────────
  // This is where alert rules get checked against the new observation values.
  // Alerts are created when thresholds are crossed (respecting cooldown).
  let alertsCreated: Alert[] = [];

  if (enrollmentId) {
    const alertResult = await evaluateAlerts({
      ctx,
      repo,
      state: finalState,
      enrollmentId,
    });
    alertsCreated = alertResult.alertsCreated;

    if (alertResult.rulesFired.length > 0) {
      console.log(`[CompleteAssessment] Fired ${alertResult.rulesFired.length} alert rules`);
    }
  }

  // ─── Step 6: Handle max_turns policy ──────────────────────────────────────
  // Each policy determines what happens when student doesn't pass within turn limit
  if (outcome === 'max_turns') {
    switch (onMaxTurnsPolicy) {
      case 'flag_mentor':
        // Alert mentor for review
        mentorFlagged = true;
        console.log(`[CompleteAssessment] Mentor flagged for session ${sessionId} (max_turns with flag_mentor policy)`);
        break;

      case 'return_for_reteach':
        // Send student back through the lesson to review material.
        // Note: Blocking is based on session.status, not passedAt. Completing
        // the session (even without passing) unblocks the gate. If allowRetake
        // is false, they just won't be able to retry - but they can proceed.
        if (allowRetake) {
          // Reset lesson pointer so student reviews the material before retry
          await socioRepo.resetMessageIndex(socioId);
          reteachTriggered = true;
          console.log(`[CompleteAssessment] Reteach triggered: lesson pointer reset for socio ${socioId}`);
        }
        // If allowRetake is false, just complete normally - completed status unblocks
        break;

      case 'complete_with_scores':
      default:
        // Just complete with scores, no special action
        break;
    }
  }

  // ─── Step 7: Update session status ────────────────────────────────────────
  const updateData: {
    status: 'completed';
    completedAt: Date;
    passedAt?: Date;
    scores: Record<string, number>;
    liveState: Record<string, unknown>;
  } = {
    status: 'completed',
    completedAt: now,
    scores: allScores,
    liveState: finalState as Record<string, unknown>,
  };

  // Set passedAt only if student actually passed
  // Note: Gate unblocking is based on session.status === 'completed', not passedAt
  if (outcome === 'passed') {
    updateData.passedAt = now;
  }

  const session = await repo.updateAssessmentSession(ctx, sessionId, updateData);

  return {
    outcome,
    studentScores,
    allScores,
    observationIds,
    mentorFlagged,
    alertsCreated,
    session,
    reteachTriggered,
    unlockedByNoDeadEnd,
  };
}

/**
 * Builds a student-facing score report message.
 *
 * @param scores - Dimension scores to display
 * @param passed - Whether the student passed
 * @param labels - Optional dimension key -> label mapping
 */
export function buildScoreReport(
  scores: Record<string, number>,
  passed: boolean,
  labels?: Record<string, string>,
): string {
  const lines: string[] = [];

  if (passed) {
    lines.push('You passed this assessment.');
  } else {
    lines.push('Assessment completed.');
  }

  lines.push('');
  lines.push('Your scores:');

  for (const [key, value] of Object.entries(scores)) {
    const label = labels?.[key] ?? key;
    const formattedValue = value.toFixed(1);
    lines.push(`  ${label}: ${formattedValue}/10`);
  }

  return lines.join('\n');
}

/**
 * Determines if a session should allow retake based on outcome and config.
 */
export function shouldAllowRetake(
  outcome: CompletionOutcome,
  passed: boolean,
  allowRetake: boolean,
): boolean {
  // Passed sessions don't need retake
  if (passed) return false;

  // Cancelled sessions always allow retake
  if (outcome === 'cancelled') return true;

  // Max turns sessions depend on config
  return allowRetake;
}
