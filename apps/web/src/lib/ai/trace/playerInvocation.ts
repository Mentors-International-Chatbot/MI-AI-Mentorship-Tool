export const PLAYER_INVOCATION_TRACE_SCHEMA_VERSION = 2 as const;

export type PlayerGenerationStage = "initial" | "repair";

export type PlayerInvocationTraceFields = {
  turnTraceId: string;
  generationStage: PlayerGenerationStage;
  repairIndex: number;
  providerAttempt: number;
};

export function buildPlayerInvocationTraceContext(
  base: Record<string, unknown>,
  fields: PlayerInvocationTraceFields,
): Record<string, unknown> {
  return {
    ...base,
    traceSchemaVersion: PLAYER_INVOCATION_TRACE_SCHEMA_VERSION,
    ...fields,
  };
}

type InvocationRow = { context: unknown };

type ParsedInvocation = PlayerInvocationTraceFields;

function parseInvocation(context: unknown): ParsedInvocation | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const value = context as Record<string, unknown>;
  if (value.traceSchemaVersion !== PLAYER_INVOCATION_TRACE_SCHEMA_VERSION) return null;
  if (typeof value.turnTraceId !== "string" || value.turnTraceId.length === 0) return null;
  if (value.generationStage !== "initial" && value.generationStage !== "repair") return null;
  if (!Number.isInteger(value.repairIndex) || (value.repairIndex as number) < 0) return null;
  if (!Number.isInteger(value.providerAttempt) || (value.providerAttempt as number) < 1) return null;
  return {
    turnTraceId: value.turnTraceId,
    generationStage: value.generationStage,
    repairIndex: value.repairIndex as number,
    providerAttempt: value.providerAttempt as number,
  };
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

/** Summarizes only correlated v2 player-call rows; legacy logical rows remain explicit unknowns. */
export function summarizePlayerInvocationFlow(rows: readonly InvocationRow[]) {
  const parsed = rows.flatMap((row) => {
    const invocation = parseInvocation(row.context);
    return invocation ? [invocation] : [];
  });
  const byTurn = Map.groupBy(parsed, (row) => row.turnTraceId);
  const turns = [...byTurn.values()];
  const callsPerTurn = turns.map((turn) => turn.length);
  const repairTurns = turns.filter((turn) => turn.some((row) => row.generationStage === "repair"));
  const retryTurns = turns.filter((turn) => turn.some((row) => row.providerAttempt > 1));

  return {
    traceSchemaVersion: PLAYER_INVOCATION_TRACE_SCHEMA_VERSION,
    tracedTurnCount: turns.length,
    tracedInvocationCount: parsed.length,
    callsPerTurn: {
      p50: percentile(callsPerTurn, 0.5),
      p95: percentile(callsPerTurn, 0.95),
    },
    repair: {
      turnCount: repairTurns.length,
      rate: turns.length ? repairTurns.length / turns.length : null,
    },
    providerRetry: {
      turnCount: retryTurns.length,
      rate: turns.length ? retryTurns.length / turns.length : null,
    },
    historicalUncorrelatedInvocationCount: rows.length - parsed.length,
  };
}
