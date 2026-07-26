/**
 * Types for the decoupled sensing/steering system.
 * Tracks continuous per-dimension state for each socio.
 */

export interface SensedDimension {
  dimensionKey: string;  // "comprehension" | "confusion"
  level: number;         // 0-10, continuous
  confidence: number;    // 0-1, model's certainty in this assessment
  evidence: string;      // ≤15 words, short excerpt/justification
}

export interface DimensionState {
  dimensionKey: string;
  level: number;
  trend: 'improving' | 'flat' | 'declining';
  confidence: number;
  evidence: string | null;
  updatedAt: Date;
}

export type DimensionStateMap = Record<string, DimensionState>;

export interface SensingResult {
  dimensions: SensedDimension[];
  rawResponse?: string;  // For debugging
  /**
   * True when the message was too trivial to sense (bare acknowledgment or a
   * few words). No LLM call was made and `dimensions` is empty - callers must
   * carry the prior state forward unchanged rather than applying an EMA step.
   */
  skipped?: boolean;
}
