/**
 * E.5.1: submitDiagnostic gates its learner-facing return value on
 * diagnostic.showScoreToLearner — full suppression (overallScore,
 * dimensionScores, and the per-question correct/correctAnswer/explanation
 * breakdown together), mirroring resolveReteachGateSignal and
 * gradePlayerBlock's web_quiz branch. DiagnosticAttempt/SocioDimensionState/
 * MetricObservation always get the real values regardless — internal
 * consumers, unaffected by learner-facing visibility.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  diagnosticAttemptCreate: vi.fn(),
  socioDimensionStateUpsert: vi.fn(),
  metricDefinitionFindUnique: vi.fn(),
  metricObservationCreate: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    diagnosticAttempt: { create: mocks.diagnosticAttemptCreate },
    socioDimensionState: { upsert: mocks.socioDimensionStateUpsert },
    metricDefinition: { findUnique: mocks.metricDefinitionFindUnique },
    metricObservation: { create: mocks.metricObservationCreate },
  },
}));

import { submitDiagnostic } from "@/lib/player/service";
import type { PlayerAccess } from "@/lib/player/service";

const QUESTIONS = [
  {
    id: "q1", format: "multiple_choice" as const, graded: true,
    prompt: "What is an LLM?", options: ["A rules engine", "A model trained to predict text"],
    answerKey: "A model trained to predict text", explanation: "It predicts likely next tokens from training data.",
    dimensionKey: "prior_knowledge",
  },
  {
    id: "q2", format: "multiple_choice" as const, graded: true,
    prompt: "What is a hallucination?", options: ["A crash", "A confident but false output"],
    answerKey: "A confident but false output", explanation: "Fluency and accuracy are separate properties.",
    dimensionKey: "prior_knowledge",
  },
];

function access(showScoreToLearner: boolean): PlayerAccess {
  return {
    socioId: "socio-a", collectionKey: "ai-essentials", organizationId: "org-a",
    programVersionId: "pv-a", programVersion: "2026.8", enrollmentId: "enrollment-a",
    introMessage: null,
    config: {
      onboarding: {
        mode: "baseline_quiz", steps: [],
        diagnostic: {
          id: "diag", title: "Baseline", threshold: 0.5, showScoreToLearner,
          questions: QUESTIONS,
        },
      },
    },
  } as unknown as PlayerAccess;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.diagnosticAttemptCreate.mockResolvedValue({ id: "attempt-1", completedAt: new Date("2026-08-25T00:00:00Z") });
  mocks.socioDimensionStateUpsert.mockResolvedValue({});
  mocks.metricDefinitionFindUnique.mockResolvedValue(null);
  mocks.metricObservationCreate.mockResolvedValue({});
});

describe("submitDiagnostic — score suppression (E.5.1)", () => {
  it("showScoreToLearner: false suppresses overallScore, dimensionScores, and per-question detail", async () => {
    const result = await submitDiagnostic(access(false), { q1: "A model trained to predict text", q2: "A crash" });

    expect(result.overallScore).toBeNull();
    expect(result.dimensionScores).toBeNull();
    expect(result.questions).toEqual([{ questionId: "q1" }, { questionId: "q2" }]);
  });

  it("showScoreToLearner: true returns the real overallScore, dimensionScores, and per-question detail", async () => {
    const result = await submitDiagnostic(access(true), { q1: "A model trained to predict text", q2: "A crash" });

    expect(result.overallScore).toBe(0.5);
    expect(result.dimensionScores).toEqual({ prior_knowledge: 0.5 });
    expect(result.questions).toEqual([
      { questionId: "q1", correct: true, correctAnswer: "A model trained to predict text", explanation: "It predicts likely next tokens from training data." },
      { questionId: "q2", correct: false, correctAnswer: "A confident but false output", explanation: "Fluency and accuracy are separate properties." },
    ]);
  });

  it("internal dimension tuning (DiagnosticAttempt, SocioDimensionState, MetricObservation) is unaffected by showScoreToLearner: false", async () => {
    await submitDiagnostic(access(false), { q1: "A model trained to predict text", q2: "A confident but false output" });

    expect(mocks.diagnosticAttemptCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ overallScore: 1, dimensionScores: { prior_knowledge: 1 } }),
    }));
    expect(mocks.socioDimensionStateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ dimensionKey: "prior_knowledge", level: 0.5 }),
    }));
  });

  it("internal dimension tuning writes identically regardless of showScoreToLearner", async () => {
    await submitDiagnostic(access(true), { q1: "A model trained to predict text", q2: "A confident but false output" });

    expect(mocks.diagnosticAttemptCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ overallScore: 1, dimensionScores: { prior_knowledge: 1 } }),
    }));
    expect(mocks.socioDimensionStateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ dimensionKey: "prior_knowledge", level: 0.5 }),
    }));
  });

  it("showScoreToLearner defaults true when omitted, via schema parse (not just a hand-built fixture)", async () => {
    const { journeyPackageSchema } = await import("@/lib/journey-package/journey-package.schema");
    const pkg = {
      schemaVersion: "1.2" as const,
      metadata: { packageId: "test-pkg", title: "Test", languages: ["en"], version: "1.0.0" },
      config: {
        onboarding: {
          mode: "baseline_quiz" as const,
          diagnostic: { id: "diag", title: "Baseline", threshold: 0.5, questions: QUESTIONS },
        },
        trackedDimensions: [{ key: "prior_knowledge", label: "Prior knowledge", category: "comprehension" as const, calibrationMode: "zero_start" as const }],
      },
      curriculum: {
        collectionKey: "test-collection",
        lessons: [{ key: "l1", title: "L1", blocks: [{ id: "b1", order: 1, blockType: "teach" as const, role: "explanation" as const, content: "content" }] }],
      },
    };
    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config.onboarding?.diagnostic?.showScoreToLearner).toBe(true);
    }
  });
});
