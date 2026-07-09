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

function calculateTrend(
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

function calculateNewLevel(
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

export async function updateDimensionState(
  socioId: string,
  sensed: SensedDimension[]
): Promise<DimensionStateMap> {
  const updatedStates: DimensionStateMap = {};

  for (const s of sensed) {
    // Fetch prior state
    const prior = await prisma.socioDimensionState.findUnique({
      where: {
        socioId_dimensionKey: {
          socioId,
          dimensionKey: s.dimensionKey,
        },
      },
    });

    const priorLevel = prior?.level ?? null;
    const newLevel = calculateNewLevel(s.level, s.confidence, priorLevel);
    const trend = calculateTrend(s.dimensionKey, newLevel, priorLevel);

    // Upsert - must update every turn for continuous tracking
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
        level: newLevel,
        trend,
        confidence: s.confidence,
        evidence: s.evidence,
      },
      update: {
        level: newLevel,
        trend,
        confidence: s.confidence,
        evidence: s.evidence,
      },
    });

    updatedStates[s.dimensionKey] = {
      dimensionKey: updated.dimensionKey,
      level: updated.level,
      trend: updated.trend as TrendValue,
      confidence: updated.confidence,
      evidence: updated.evidence,
      updatedAt: updated.updatedAt,
    };
  }

  return updatedStates;
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
