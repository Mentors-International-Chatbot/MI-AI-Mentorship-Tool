/**
 * The "make it concise system-wide" fix: runAssessmentTurn.ts's probe
 * generation (the reteach_gate conversation) now runs through the same
 * repair-then-accept-or-fallback loop teach/teach_back/project turns already
 * use (invokeStyledPlayerResponse, service.ts), instead of having no output
 * contract at all. These tests pin the wiring itself — that the hard contract
 * instruction reaches the probe's system prompt, that an over-long draft gets
 * repaired down, and that an unrepairable draft degrades to the existing
 * gentle fallback string rather than throwing a hard error to the caller.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { runAssessmentTurn, type AssessmentConfig } from "../runAssessmentTurn";
import type { DimensionStateMap } from "@/lib/ai/sensing/types";
import type { TrackedDimension } from "@/lib/journey-package/journey-package.schema";
import { DEFAULT_RESPONSE_STYLE } from "@/lib/player/responseStyle";

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

// Verified against responseStyleViolations(COMPLIANT_REPLY, DEFAULT_RESPONSE_STYLE, false) === []: 3 sentences, 230 characters, one open question in the final sentence.
const COMPLIANT_REPLY = "That's a solid start and you're clearly thinking about the sequence correctly. I want to hear a little more about why the order matters before moving on. What would happen if you swapped the second and third steps in your process?";

const passingState: DimensionStateMap = {
  comprehension: { dimensionKey: "comprehension", level: 3, trend: "flat", confidence: 0.8, evidence: "prior", updatedAt: new Date() },
};

function baseConfig(responseStyle?: AssessmentConfig["responseStyle"]): AssessmentConfig {
  return {
    teachBackPrompt: "Explain what you learned about this topic.",
    keyConcepts: ["concept a"],
    evaluatesConcepts: ["concept a"],
    lessonContext: "Test lesson",
    aiBehavior: {},
    passing: { dimensionKey: "comprehension", threshold: 9, confidenceFloor: 0.9, minTurns: 10, maxTurns: 10 },
    studentVisibleDimensionKeys: ["comprehension"],
    onMaxTurnsPolicy: "complete_with_scores",
    dimensions,
    responseStyle,
  };
}

function systemContentOf(messages: Array<{ content?: unknown }>): string {
  const first = messages[0];
  return typeof first?.content === "string" ? first.content : "";
}

/** Sensing always reports a low, stable state so every call in these tests lands on the `continue` branch. */
function mockRoutedInvoke(handlers: { probe: () => string; repair?: () => string }) {
  mockInvoke.mockImplementation(async (messages: Array<{ content?: unknown }>) => {
    const system = systemContentOf(messages);
    if (system.includes("OUTPUT FORMAT (JSON array only")) {
      return { content: JSON.stringify([{ dimensionKey: "comprehension", level: 2, confidence: 0.9, evidence: "test" }]) };
    }
    if (system.includes("You are a precise copy editor")) {
      return { content: (handlers.repair ?? handlers.probe)() };
    }
    return { content: handlers.probe() };
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("runAssessmentTurn: probe generation carries the response-style contract", () => {
  it("bakes the hard learner-visible output contract into the probe system prompt when a style is configured", async () => {
    mockRoutedInvoke({ probe: () => COMPLIANT_REPLY });

    await runAssessmentTurn({
      studentText: "Here is my explanation of the concept in my own words, with real detail.",
      conversationHistory: [],
      priorState: passingState,
      turnCount: 1,
      config: baseConfig(DEFAULT_RESPONSE_STYLE),
    });

    const probeCall = mockInvoke.mock.calls.find(([messages]) =>
      systemContentOf(messages).includes("assessment evaluator") && !systemContentOf(messages).includes("JSON array")
    );
    expect(probeCall).toBeDefined();
    expect(systemContentOf(probeCall![0])).toContain("HARD LEARNER-VISIBLE OUTPUT CONTRACT");
  });

  it("does NOT add the output contract when no style is configured (legacy session snapshot)", async () => {
    mockRoutedInvoke({ probe: () => COMPLIANT_REPLY });

    await runAssessmentTurn({
      studentText: "Here is my explanation of the concept in my own words, with real detail.",
      conversationHistory: [],
      priorState: passingState,
      turnCount: 1,
      config: baseConfig(undefined),
    });

    const probeCall = mockInvoke.mock.calls.find(([messages]) =>
      systemContentOf(messages).includes("assessment evaluator") && !systemContentOf(messages).includes("JSON array")
    );
    expect(probeCall).toBeDefined();
    expect(systemContentOf(probeCall![0])).not.toContain("HARD LEARNER-VISIBLE OUTPUT CONTRACT");
  });

  it("repairs an over-long draft down to the delivered reply instead of returning it verbatim", async () => {
    const tooLong = Array.from({ length: 10 }, (_, i) => `This is sentence number ${i + 1} of a much too long reply.`).join(" ");
    mockRoutedInvoke({ probe: () => tooLong, repair: () => COMPLIANT_REPLY });

    const outcome = await runAssessmentTurn({
      studentText: "Here is my explanation of the concept in my own words, with real detail.",
      conversationHistory: [],
      priorState: passingState,
      turnCount: 1,
      config: baseConfig(DEFAULT_RESPONSE_STYLE),
    });

    expect(outcome.status).toBe("continue");
    if (outcome.status === "continue") {
      expect(outcome.evaluatorResponse).toBe(COMPLIANT_REPLY);
      expect(outcome.evaluatorResponse).not.toBe(tooLong);
    }
  });

  it("falls back to the gentle canned probe instead of throwing when the draft is unrepairable", async () => {
    const tooLong = Array.from({ length: 10 }, (_, i) => `This is sentence number ${i + 1} of a much too long reply.`).join(" ");
    // Both the initial draft and the repair attempt stay over the sentence
    // limit, so invokeStyledPlayerResponse exhausts its repair budget and
    // throws — generateEvaluatorResponse's own catch must absorb that.
    mockRoutedInvoke({ probe: () => tooLong, repair: () => tooLong });

    const outcome = await runAssessmentTurn({
      studentText: "Here is my explanation of the concept in my own words, with real detail.",
      conversationHistory: [],
      priorState: passingState,
      turnCount: 1,
      config: baseConfig(DEFAULT_RESPONSE_STYLE),
    });

    expect(outcome.status).toBe("continue");
    if (outcome.status === "continue") {
      expect(outcome.evaluatorResponse).toContain("I'd love to hear more about your understanding");
    }
  });
});
