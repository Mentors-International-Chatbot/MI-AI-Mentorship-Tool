/**
 * The b1-12 near-miss fix: senseAssessmentTurn's per-turn scoring instruction
 * already grades generously (see buildAssessmentSensingPrompt), but the
 * shared updateDimensionState.ts EMA (DIMENSION_SMOOTHING=0.3, tuned for
 * general chat sensing across a long relationship) capped even a
 * maximally-confident turn at moving the composite 30% of the way to the
 * observed value — so a genuinely strong, confidently-graded answer could
 * never surface in a 2-5 turn reteach-gate conversation. Confirmed live:
 * two real b1-12 sessions landed at 6.20 and 6.41 against a 7.0 threshold.
 *
 * senseAssessmentTurn now aggregates with the model's own reported
 * confidence AS the EMA weight (no separate 0.3 base), scoped to the
 * assessment path only — updateDimensionState.ts and general chat sensing
 * are untouched. These tests pin: a confident strong turn now surfaces close
 * to its true value, a low-confidence thin turn still barely moves the
 * composite (same protection against one weak answer settling the outcome),
 * and a consistently strong conversation can now actually clear a realistic
 * threshold within minTurns.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { runAssessmentTurn, checkPassCondition, type AssessmentConfig } from "../runAssessmentTurn";
import { senseAssessmentTurn, createInitialSessionState } from "../senseAssessmentTurn";
import type { TrackedDimension } from "@/lib/journey-package/journey-package.schema";

const mockInvoke = vi.fn();
vi.mock("@/lib/ai/openrouter", () => ({
  createOpenRouterChat: vi.fn(() => ({ invoke: mockInvoke })),
}));

const dimensions: TrackedDimension[] = [
  {
    key: "comprehension",
    label: "Comprehension",
    category: "comprehension",
    primary: true,
    scale: { min: 0, max: 10 },
    calibrationMode: "zero_start",
  },
];

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("senseAssessmentTurn: confidence-weighted aggregation", () => {
  it("lets a confidently-strong first turn surface close to its true value, not ~27% of it", async () => {
    // Exactly what buildAssessmentSensingPrompt's TIMING guidance asks for on
    // a clear early answer: "score it fully and report HIGH confidence (0.8+)".
    mockInvoke.mockResolvedValue({
      content: JSON.stringify([{ dimensionKey: "comprehension", level: 9, confidence: 0.85, evidence: "clear, complete answer" }]),
    });

    const priorState = createInitialSessionState(dimensions);
    const newState = await senseAssessmentTurn({
      studentText: "Here is my full explanation of the concept in my own words, covering every step.",
      priorState,
      dimensions,
      lessonContext: "Test lesson",
      keyConcepts: ["concept a"],
      turnCount: 1,
      minTurns: 2,
    });

    // 0 + 0.85 * (9 - 0) = 7.65 — versus the old shared EMA's 0.3*0.85*9 ≈ 2.3.
    expect(newState.comprehension.level).toBeCloseTo(7.65, 5);
  });

  it("still barely moves the composite for a genuinely thin, low-confidence turn", async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify([{ dimensionKey: "comprehension", level: 8, confidence: 0.2, evidence: "vague, uncertain" }]),
    });

    const priorState = createInitialSessionState(dimensions);
    const newState = await senseAssessmentTurn({
      studentText: "Here is a vague and uncertain attempt at explaining the concept.",
      priorState,
      dimensions,
      lessonContext: "Test lesson",
      keyConcepts: ["concept a"],
      turnCount: 1,
      minTurns: 2,
    });

    // 0 + 0.2 * (8 - 0) = 1.6 — one weak/uncertain turn still can't settle the outcome.
    expect(newState.comprehension.level).toBeCloseTo(1.6, 5);
    expect(newState.comprehension.level).toBeLessThan(7);
  });

  it("a real gap surfacing later still pulls the composite back down quickly, not just slowly up", async () => {
    const priorState = createInitialSessionState(dimensions);
    mockInvoke.mockResolvedValueOnce({
      content: JSON.stringify([{ dimensionKey: "comprehension", level: 9, confidence: 0.9, evidence: "strong turn 1" }]),
    });
    const afterTurn1 = await senseAssessmentTurn({
      studentText: "Here is my full explanation of the concept in my own words, covering every step.",
      priorState,
      dimensions,
      lessonContext: "Test lesson",
      keyConcepts: ["concept a"],
      turnCount: 1,
      minTurns: 2,
    });
    expect(afterTurn1.comprehension.level).toBeCloseTo(8.1, 5);

    mockInvoke.mockResolvedValueOnce({
      content: JSON.stringify([{ dimensionKey: "comprehension", level: 3, confidence: 0.7, evidence: "revealed a real misconception" }]),
    });
    const afterTurn2 = await senseAssessmentTurn({
      studentText: "Actually I think it works completely differently than that.",
      priorState: afterTurn1,
      dimensions,
      lessonContext: "Test lesson",
      keyConcepts: ["concept a"],
      turnCount: 2,
      minTurns: 2,
    });
    // 8.1 + 0.7 * (3 - 8.1) = 4.53 — a confidently-observed real gap drops the
    // composite fast, the same responsiveness working in both directions.
    expect(afterTurn2.comprehension.level).toBeCloseTo(4.53, 5);
  });
});

describe("runAssessmentTurn: a consistently strong conversation clears a realistic threshold within minTurns", () => {
  const baseConfig: AssessmentConfig = {
    teachBackPrompt: "Explain what you learned about this topic.",
    keyConcepts: ["concept a"],
    evaluatesConcepts: ["concept a"],
    lessonContext: "Test lesson",
    aiBehavior: {},
    passing: { dimensionKey: "comprehension", threshold: 7, confidenceFloor: 0.5, minTurns: 2, maxTurns: 5 },
    studentVisibleDimensionKeys: ["comprehension"],
    onMaxTurnsPolicy: "complete_with_scores",
    dimensions,
  };

  function systemContentOf(messages: Array<{ content?: unknown }>): string {
    const first = messages[0];
    return typeof first?.content === "string" ? first.content : "";
  }

  it("passes on turn 2 (= minTurns) when both turns are confidently strong", async () => {
    mockInvoke.mockImplementation(async (messages: Array<{ content?: unknown }>) => {
      const system = systemContentOf(messages);
      if (system.includes("OUTPUT FORMAT (JSON array only")) {
        return { content: JSON.stringify([{ dimensionKey: "comprehension", level: 9, confidence: 0.9, evidence: "consistently strong" }]) };
      }
      return { content: "Good, that covers the core idea well. One more thing to confirm: what happens next in the process?" };
    });

    const priorState = createInitialSessionState(dimensions);
    const turn1 = await runAssessmentTurn({
      studentText: "Here is my full explanation of the concept in my own words, covering every step.",
      conversationHistory: [],
      priorState,
      turnCount: 1,
      config: baseConfig,
    });
    expect(turn1.status).toBe("continue");

    const stateAfterTurn1 = turn1.status === "continue" ? turn1.updatedState : priorState;
    const turn2 = await runAssessmentTurn({
      studentText: "And here is the rest of my explanation, equally complete and correct.",
      conversationHistory: [
        { role: "assistant", content: "Good, that covers the core idea well. One more thing to confirm: what happens next in the process?" },
      ],
      priorState: stateAfterTurn1,
      turnCount: 2,
      config: baseConfig,
    });

    expect(turn2.status).toBe("passed");
    if (turn2.status === "passed") {
      expect(checkPassCondition(turn2.updatedState, baseConfig.passing, 2)).toBe(true);
    }
  });
});
