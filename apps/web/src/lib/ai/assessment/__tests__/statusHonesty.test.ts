/**
 * Regression coverage for the b1-12 live-conversation finding (session
 * 44d09c3f...): the evaluator told a student "You are [done]" and used
 * closure language ("well done", "I've heard what I need to hear") on a turn
 * where the sensed comprehension level (6.2) had NOT cleared the passing
 * threshold (7). BlockProgress never wrote a row; the session stayed
 * `in_progress` with `passedAt: null`.
 *
 * That was not a UI-wiring bug: `runAssessmentTurn` only ever surfaces the
 * PROBE's text (the `continue` branch) when `checkPassCondition` has already
 * been checked against the freshly sensed state for THIS turn and found
 * false — any terminal outcome (`passed` or `max_turns`) discards the probe
 * draft entirely and generates a fresh closing message instead (see the
 * "Terminal outcome discards the probe" comment in runAssessmentTurn.ts).
 * So the client-visible STATUS was always correct; only the probe's WORDING
 * was wrong. These tests pin that architectural invariant directly: whatever
 * text the model drafts for the probe, the surfaced `status` (and therefore
 * whether the client transitions out of the bounded container) tracks only
 * the real sensed state, never the probe's own language.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { runAssessmentTurn, type AssessmentConfig } from "../runAssessmentTurn";
import type { DimensionStateMap } from "@/lib/ai/sensing/types";
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

const baseConfig: AssessmentConfig = {
  teachBackPrompt: "Explain what you learned about this topic.",
  keyConcepts: ["concept a"],
  evaluatesConcepts: ["concept a"],
  lessonContext: "Test lesson",
  aiBehavior: {},
  passing: { dimensionKey: "comprehension", threshold: 7, confidenceFloor: 0.5, minTurns: 2, maxTurns: 12 },
  studentVisibleDimensionKeys: ["comprehension"],
  onMaxTurnsPolicy: "complete_with_scores",
  dimensions,
};

function systemContentOf(messages: Array<{ content?: unknown }>): string {
  const first = messages[0];
  return typeof first?.content === "string" ? first.content : "";
}

/**
 * Routes the shared `chat.invoke` mock to the right canned response by
 * inspecting the system prompt: the sensing prompt, the probe prompt, and
 * the closing-message prompt are each textually distinct (see
 * senseAssessmentTurn.ts / buildAssessmentPrompt.ts).
 */
function mockRoutedInvoke(params: { sensedLevel: number; sensedConfidence: number; probeText: string; closingText: string }) {
  mockInvoke.mockImplementation(async (messages: Array<{ content?: unknown }>) => {
    const system = systemContentOf(messages);
    if (system.includes("OUTPUT FORMAT (JSON array only")) {
      return {
        content: JSON.stringify([
          { dimensionKey: "comprehension", level: params.sensedLevel, confidence: params.sensedConfidence, evidence: "test evidence" },
        ]),
      };
    }
    if (system.includes("completing an assessment session")) {
      return { content: params.closingText };
    }
    return { content: params.probeText };
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("runAssessmentTurn: surfaced status always matches the real gate", () => {
  it('stays "continue" when the sensed gate has not cleared, even when the probe text sounds like a pass', async () => {
    // Reproduces the exact language from the live b1-12 transcript.
    mockRoutedInvoke({
      sensedLevel: 6,
      sensedConfidence: 0.9,
      probeText: "You've got it. I've heard what I need to hear. Well done.",
      closingText: "SHOULD NOT BE USED — terminal branch did not fire",
    });

    const priorState: DimensionStateMap = {
      comprehension: { dimensionKey: "comprehension", level: 5, trend: "flat", confidence: 0.8, evidence: "prior", updatedAt: new Date() },
    };

    const outcome = await runAssessmentTurn({
      studentText: "Here is my explanation of the concept in my own words, with real detail.",
      conversationHistory: [],
      priorState,
      turnCount: 3,
      config: baseConfig,
    });

    // Below threshold (7) even after this turn's update — the gate has not cleared.
    expect(outcome.status).toBe("continue");
    if (outcome.status === "continue") {
      expect(outcome.updatedState.comprehension.level).toBeLessThan(7);
      // The probe's own (bad) language is exactly what reached the transcript
      // live — proving the surfaced STATUS is independent of it.
      expect(outcome.evaluatorResponse).toContain("I've heard what I need to hear");
    }
  });

  it("also stays \"continue\" when asked directly about completion status, regardless of conversational tone", async () => {
    mockRoutedInvoke({
      sensedLevel: 6.2,
      sensedConfidence: 0.92,
      probeText: "You are. Thanks for being straight with me about what you actually think.",
      closingText: "SHOULD NOT BE USED — terminal branch did not fire",
    });

    const priorState: DimensionStateMap = {
      comprehension: { dimensionKey: "comprehension", level: 6.1970029404, trend: "improving", confidence: 0.92, evidence: "prior", updatedAt: new Date() },
    };

    const outcome = await runAssessmentTurn({
      studentText: "thank you! Am I done?",
      conversationHistory: [
        { role: "assistant", content: "You've got it. I've heard what I need to hear. Well done." },
      ],
      priorState,
      turnCount: 4,
      config: { ...baseConfig, passing: { ...baseConfig.passing, maxTurns: 5 } },
    });

    expect(outcome.status).toBe("continue");
  });

  it("discards the parallel probe draft and returns a fresh closing message once the gate genuinely clears", async () => {
    mockRoutedInvoke({
      sensedLevel: 9,
      sensedConfidence: 0.9,
      probeText: "One more question about the topic — please continue.",
      closingText: "You passed! Great work today.",
    });

    const priorState: DimensionStateMap = {
      comprehension: { dimensionKey: "comprehension", level: 8, trend: "improving", confidence: 0.9, evidence: "prior", updatedAt: new Date() },
    };

    const outcome = await runAssessmentTurn({
      studentText: "Here is my explanation of the concept in my own words, with real detail.",
      conversationHistory: [],
      priorState,
      turnCount: 3,
      config: baseConfig,
    });

    expect(outcome.status).toBe("passed");
    if (outcome.status === "passed") {
      // The probe draft (generated in parallel with sensing) is discarded —
      // the client only ever sees the closing message written after the
      // real pass determination.
      expect(outcome.closingMessage).toBe("You passed! Great work today.");
      expect(outcome.closingMessage).not.toContain("One more question");
    }
  });
});
