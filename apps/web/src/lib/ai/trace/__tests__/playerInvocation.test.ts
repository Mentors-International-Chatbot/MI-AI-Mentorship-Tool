import { describe, expect, it } from "vitest";
import {
  buildPlayerInvocationTraceContext,
  PLAYER_INVOCATION_TRACE_SCHEMA_VERSION,
  summarizePlayerInvocationFlow,
} from "../playerInvocation";

function row(
  turnTraceId: string,
  generationStage: "initial" | "repair",
  providerAttempt = 1,
) {
  return {
    context: buildPlayerInvocationTraceContext(
      { surface: "player", programVersionId: "pv-1", intent: "question" },
      {
        turnTraceId,
        generationStage,
        repairIndex: generationStage === "initial" ? 0 : 1,
        providerAttempt,
      },
    ),
  };
}

describe("player invocation trace v2", () => {
  it("adds call correlation without replacing the existing player context", () => {
    expect(row("turn-1", "repair").context).toEqual({
      surface: "player",
      programVersionId: "pv-1",
      intent: "question",
      traceSchemaVersion: PLAYER_INVOCATION_TRACE_SCHEMA_VERSION,
      turnTraceId: "turn-1",
      generationStage: "repair",
      repairIndex: 1,
      providerAttempt: 1,
    });
  });

  it("reports calls per turn, repair rate, retries, and legacy unknowns", () => {
    const summary = summarizePlayerInvocationFlow([
      row("turn-1", "initial"),
      row("turn-2", "initial"),
      row("turn-2", "repair"),
      row("turn-3", "initial"),
      row("turn-3", "initial", 2),
      row("turn-3", "repair"),
      { context: { surface: "player", programVersionId: "pv-1" } },
    ]);

    expect(summary).toEqual({
      traceSchemaVersion: 2,
      tracedTurnCount: 3,
      tracedInvocationCount: 6,
      callsPerTurn: { p50: 2, p95: 3 },
      repair: { turnCount: 2, rate: 2 / 3 },
      providerRetry: { turnCount: 1, rate: 1 / 3 },
      historicalUncorrelatedInvocationCount: 1,
    });
  });

  it("returns null rates and percentiles before the first v2 live turn", () => {
    expect(summarizePlayerInvocationFlow([{ context: null }])).toEqual({
      traceSchemaVersion: 2,
      tracedTurnCount: 0,
      tracedInvocationCount: 0,
      callsPerTurn: { p50: null, p95: null },
      repair: { turnCount: 0, rate: null },
      providerRetry: { turnCount: 0, rate: null },
      historicalUncorrelatedInvocationCount: 1,
    });
  });
});
