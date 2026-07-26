/**
 * Numeric Update - State persistence with exponential moving average
 *
 * Updates the SocioDimensionState table with new sensing observations.
 * Uses exponential moving average (EMA) to smooth out noise while
 * remaining responsive to genuine shifts.
 *
 * Key principles:
 * - Pure math, no LLM calls
 * - Upserts every turn (never skip-if-exists)
 * - Calculates trend from level change
 * - Preserves evidence for debugging/transparency
 */

import { prisma } from '@/lib/db';
import {
  DIMENSION_SMOOTHING,
  TREND_THRESHOLD,
} from '@/lib/ai/prompts/constants';
import type { SensedDimension, DimensionState, DimensionStateMap } from './types';

type TrendValue = 'improving' | 'flat' | 'declining';

/**
 * Calculates the trend based on level change.
 * For "confusion", lower is better (inverted interpretation).
 * Exported for use in session-scoped assessment sensing.
 */
export function calculateTrend(
  dimensionKey: string,
  newLevel: number,
  priorLevel: number | null
): TrendValue {
  if (priorLevel === null) return 'flat';

  const delta = newLevel - priorLevel;

  // For "confusion", LOWER is better, so flip the interpretation
  if (dimensionKey === 'confusion') {
    if (delta < -TREND_THRESHOLD) return 'improving'; // Confusion decreased
    if (delta > TREND_THRESHOLD) return 'declining';  // Confusion increased
    return 'flat';
  }

  // For "comprehension", HIGHER is better
  if (delta > TREND_THRESHOLD) return 'improving';
  if (delta < -TREND_THRESHOLD) return 'declining';
  return 'flat';
}

/**
 * Calculates new level using exponential moving average.
 * Higher confidence = trust the new observation more.
 * Exported for use in session-scoped assessment sensing.
 */
export function calculateNewLevel(
  observedLevel: number,
  observedConfidence: number,
  priorLevel: number | null
): number {
  if (priorLevel === null) {
    // First observation - use directly
    return observedLevel;
  }

  // Exponential moving average, weighted by confidence
  // Higher confidence = trust the new observation more
  const effectiveSmoothing = DIMENSION_SMOOTHING * observedConfidence;
  const newLevel = priorLevel + effectiveSmoothing * (observedLevel - priorLevel);

  // Clamp to 0-10 range
  return Math.max(0, Math.min(10, newLevel));
}

/**
 * Pure function: applies sensed dimensions to a prior state map.
 * Returns a NEW map with updated levels/trends/confidence.
 * Does NOT touch the database - used by both global and session-scoped sensing.
 */
export function applySensedToState(
  prior: DimensionStateMap,
  sensed: SensedDimension[],
): DimensionStateMap {
  const updated: DimensionStateMap = { ...prior };
  const now = new Date();

  for (const s of sensed) {
    const priorState = prior[s.dimensionKey];
    const priorLevel = priorState?.level ?? null;

    const newLevel = calculateNewLevel(s.level, s.confidence, priorLevel);
    const trend = calculateTrend(s.dimensionKey, newLevel, priorLevel);

    updated[s.dimensionKey] = {
      dimensionKey: s.dimensionKey,
      level: newLevel,
      trend,
      confidence: s.confidence,
      evidence: s.evidence,
      updatedAt: now,
    };
  }

  return updated;
}

/**
 * Persists dimension state to the database for a socio.
 * Uses applySensedToState for the math, then writes to SocioDimensionState.
 */
export async function updateDimensionState(
  socioId: string,
  sensed: SensedDimension[]
): Promise<DimensionStateMap> {
  // Fetch prior state from DB
  const priorStates = await prisma.socioDimensionState.findMany({
    where: { socioId },
  });

  const priorMap: DimensionStateMap = {};
  for (const state of priorStates) {
    priorMap[state.dimensionKey] = {
      dimensionKey: state.dimensionKey,
      level: state.level,
      trend: state.trend as TrendValue,
      confidence: state.confidence,
      evidence: state.evidence,
      updatedAt: state.updatedAt,
    };
  }

  // Apply sensing using the pure function
  const updatedMap = applySensedToState(priorMap, sensed);

  // Persist each updated dimension
  const finalStates: DimensionStateMap = {};

  for (const s of sensed) {
    const computed = updatedMap[s.dimensionKey];
    if (!computed) continue;

    const updated = await prisma.socioDimensionState.upsert({
      where: {
        socioId_dimensionKey: {
          socioId,
          dimensionKey: s.dimensionKey,
        },
      },
      create: {
        socioId,
        dimensionKey: s.dimensionKey,
        level: computed.level,
        trend: computed.trend,
        confidence: computed.confidence,
        evidence: computed.evidence,
      },
      update: {
        level: computed.level,
        trend: computed.trend,
        confidence: computed.confidence,
        evidence: computed.evidence,
      },
    });

    finalStates[s.dimensionKey] = {
      dimensionKey: updated.dimensionKey,
      level: updated.level,
      trend: updated.trend as TrendValue,
      confidence: updated.confidence,
      evidence: updated.evidence,
      updatedAt: updated.updatedAt,
    };
  }

  return finalStates;
}

/**
 * Fetches the current dimension state for a socio.
 * Returns an empty map if no state exists yet.
 */
export async function getDimensionStateMap(socioId: string): Promise<DimensionStateMap> {
  const states = await prisma.socioDimensionState.findMany({
    where: { socioId },
  });

  const stateMap: DimensionStateMap = {};
  for (const state of states) {
    stateMap[state.dimensionKey] = {
      dimensionKey: state.dimensionKey,
      level: state.level,
      trend: state.trend as TrendValue,
      confidence: state.confidence,
      evidence: state.evidence,
      updatedAt: state.updatedAt,
    };
  }

  return stateMap;
}

/**
 * Clears dimension state for a socio (useful for testing or reset).
 */
export async function clearDimensionState(socioId: string): Promise<void> {
  await prisma.socioDimensionState.deleteMany({
    where: { socioId },
  });
}
