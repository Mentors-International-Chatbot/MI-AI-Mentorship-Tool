/**
 * Alert Evaluation Service
 * ═══════════════════════════════════════════════════════════════════════════
 * Evaluates alert rules against dimension state and creates alerts when
 * thresholds are crossed.
 *
 * Called by:
 *   - completeAssessment (gated teach-back sessions)
 *
 * NOTE: Passive main-chat sensing also produces MetricObservations, but
 * nothing evaluates those yet. When that pipeline lands, it should call
 * evaluateAlerts after writing observations — same pattern as gated sessions.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { TenantContext } from '@/lib/repo/tenantContext';
import type { TenantRepo, Alert } from '@/lib/repo/tenantRepo.types';
import type { DimensionStateMap } from '@/lib/ai/sensing/types';

export interface EvaluateAlertsParams {
  ctx: TenantContext;
  repo: TenantRepo;
  state: DimensionStateMap;
  enrollmentId: string;
}

export interface EvaluateAlertsResult {
  alertsCreated: Alert[];
  rulesFired: string[];
}

/**
 * Checks if an operator condition is met.
 */
function checkCondition(
  value: number,
  operator: string,
  threshold: number,
): boolean {
  switch (operator) {
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'eq':
      return value === threshold;
    default:
      console.warn(`[EvaluateAlerts] Unknown operator: ${operator}`);
      return false;
  }
}

/**
 * Checks if a rule is on cooldown (recently fired for this enrollment).
 */
async function isOnCooldown(
  ctx: TenantContext,
  repo: TenantRepo,
  ruleId: string,
  enrollmentId: string,
  cooldownHours: number,
): Promise<boolean> {
  const alerts = await repo.getAlerts(ctx, { enrollmentId, unresolved: false });
  const ruleAlerts = alerts.filter((a) => a.ruleId === ruleId);

  if (ruleAlerts.length === 0) return false;

  // Find the most recent alert for this rule
  const mostRecent = ruleAlerts.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )[0];

  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  const timeSinceAlert = Date.now() - mostRecent.createdAt.getTime();

  return timeSinceAlert < cooldownMs;
}

/**
 * Evaluates all active alert rules against the current dimension state.
 * Creates alerts when thresholds are crossed and cooldown has passed.
 *
 * @param params - Evaluation parameters
 * @returns List of created alerts and fired rule IDs
 */
export async function evaluateAlerts(
  params: EvaluateAlertsParams,
): Promise<EvaluateAlertsResult> {
  const { ctx, repo, state, enrollmentId } = params;

  const alertsCreated: Alert[] = [];
  const rulesFired: string[] = [];

  // Get all active alert rules for this org
  const rules = await repo.getAlertRules(ctx);
  const activeRules = rules.filter((r) => r.active);

  // Get metric definitions to map rule.metricId to dimension keys
  const metricDefs = await repo.getMetricDefinitions(ctx);
  const metricKeyMap = new Map<string, string>();
  for (const def of metricDefs) {
    metricKeyMap.set(def.id, def.key);
  }

  for (const rule of activeRules) {
    const dimensionKey = metricKeyMap.get(rule.metricId);
    if (!dimensionKey) {
      console.warn(`[EvaluateAlerts] No dimension key for metricId: ${rule.metricId}`);
      continue;
    }

    const dimState = state[dimensionKey];
    if (!dimState) {
      // Dimension not in state - can't evaluate
      continue;
    }

    // Check if condition is met
    const conditionMet = checkCondition(dimState.level, rule.operator, rule.threshold);
    if (!conditionMet) continue;

    // Check cooldown
    const onCooldown = await isOnCooldown(ctx, repo, rule.id, enrollmentId, rule.cooldownHours);
    if (onCooldown) {
      console.log(`[EvaluateAlerts] Rule ${rule.id} on cooldown for enrollment ${enrollmentId}`);
      continue;
    }

    // Create the alert
    try {
      const alert = await repo.createAlert(ctx, {
        ruleId: rule.id,
        enrollmentId,
        severity: rule.severity,
        triggerValue: dimState.level,
        message: `${dimensionKey} ${rule.operator} ${rule.threshold} (actual: ${dimState.level.toFixed(1)})`,
        resolvedAt: null,
      });

      alertsCreated.push(alert);
      rulesFired.push(rule.id);

      console.log(`[EvaluateAlerts] Created alert for rule ${rule.name} (${rule.id})`);
    } catch (error) {
      console.error(`[EvaluateAlerts] Failed to create alert for rule ${rule.id}:`, error);
    }
  }

  return { alertsCreated, rulesFired };
}
