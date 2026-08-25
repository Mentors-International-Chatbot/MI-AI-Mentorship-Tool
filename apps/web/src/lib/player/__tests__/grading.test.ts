import { describe, expect, it } from "vitest";
import { lessonBlockSchema } from "@/lib/journey-package/journey-package.schema";
import { aggregateDiagnosticDimensionScores, capstoneTutorGrounding, gradePlayerBlock, matchesExpansionParent, mergeBlockAssessmentConfig, milestoneStates, passingDiagnosticDimensions, PlayerError, sanitizePlayerBlock } from "../service";

const quiz = lessonBlockSchema.parse({
  id: "quiz", order: 1, blockType: "quiz_checkpoint", concepts: ["ai_impact"],
  questions: [{ id: "q1", prompt: "Pick", format: "multiple_choice", options: ["A", "B"], answerKey: "B", explanation: "B is correct", dimensionKey: "ai_impact" }],
});

describe("sequential milestone availability", () => {
  const milestones = [
    { key: "m1", name: "One", availability: { type: "immediate" as const } },
    { key: "m2", name: "Two", availability: { type: "after_milestone" as const, milestoneKey: "m1" } },
    { key: "m3", name: "Three", availability: { type: "after_milestone" as const, milestoneKey: "m2" } },
  ];

  it("shows every milestone but marks only the first as current", () => {
    expect(milestoneStates(milestones, new Set(), new Set()).map((item) => item.status)).toEqual(["current", "locked", "locked"]);
  });

  it("unlocks only the immediate successor on the next snapshot", () => {
    expect(milestoneStates(milestones, new Set(), new Set(["m1"])).map((item) => item.status)).toEqual(["reached", "current", "locked"]);
  });
});

describe("capstone mentor grounding", () => {
  const outcome = {
    project: { title: "Build a workflow", deliverables: [] },
    milestones: [
      { key: "m1", name: "One", availability: { type: "immediate" as const }, checkDescription: "Ask only about the first milestone." },
      { key: "m2", name: "Two", availability: { type: "after_milestone" as const, milestoneKey: "m1" }, checkDescription: "Do not expose the second check yet." },
    ],
    mentorResources: [],
  };

  it("includes checkDescription for the current milestone only", () => {
    const grounding = capstoneTutorGrounding(outcome, new Set(["m1"]));
    expect(grounding).toContain("Ask only about the first milestone.");
    expect(grounding).not.toContain("Do not expose the second check yet.");
  });

  it("preserves the prior project-only grounding when the current milestone has no check", () => {
    const withoutCheck = { ...outcome, milestones: [{ ...outcome.milestones[0], checkDescription: undefined }] };
    expect(capstoneTutorGrounding(withoutCheck, new Set(["m1"]))).toBe(`Capstone: ${JSON.stringify(outcome.project)}`);
  });
});

describe("diagnostic dimension aggregation", () => {
  const question = (id: string) => ({ id, dimensionKey: "how_ai_works" });

  it("scores every question in a repeated dimension instead of keeping the last answer", () => {
    expect(aggregateDiagnosticDimensionScores([
      { question: question("q1"), correct: true },
      { question: question("q2"), correct: false },
    ])).toEqual({ how_ai_works: 0.5 });
    expect(aggregateDiagnosticDimensionScores([
      { question: question("q1"), correct: false },
      { question: question("q2"), correct: true },
    ])).toEqual({ how_ai_works: 0.5 });
  });

  it("produces one score per dimension for threshold seeding", () => {
    const scores = aggregateDiagnosticDimensionScores([
      { question: question("q1"), correct: true },
      { question: question("q2"), correct: true },
      { question: { dimensionKey: "working_with_ai" }, correct: true },
      { question: { dimensionKey: "working_with_ai" }, correct: false },
    ]);
    expect(scores).toEqual({ how_ai_works: 1, working_with_ai: 0.5 });
    expect(passingDiagnosticDimensions(scores, 0.75)).toEqual([["how_ai_works", 1]]);
  });
});

describe("expansion parent validation", () => {
  const params = { courseCode: "AIESS", collectionKey: "ai-essentials", programVersionId: "pv-1", lessonKey: "lesson-1", blockId: "block-1", parentIntent: "teach_back" as const };
  const metadata = { surface: "player", ...params, intent: "teach_back" };

  it("requires the same released course, lesson, block, and parent intent", () => {
    expect(matchesExpansionParent(metadata, params)).toBe(true);
    expect(matchesExpansionParent({ ...metadata, programVersionId: "pv-2" }, params)).toBe(false);
    expect(matchesExpansionParent({ ...metadata, blockId: "other" }, params)).toBe(false);
    expect(matchesExpansionParent({ ...metadata, intent: "question" }, params)).toBe(false);
    // courseCode is compared against the caller's course now, not a literal.
    expect(matchesExpansionParent({ ...metadata, courseCode: "SKILLS" }, params)).toBe(false);
  });
});
const drag = lessonBlockSchema.parse({
  id: "drag", order: 2, blockType: "drag_order", prompt: "Order", items: ["A", "B", "C"], correctOrder: [2, 0, 1],
});

describe("player server grading", () => {
  it("removes answer material from lesson DTO blocks", () => {
    expect(JSON.stringify(sanitizePlayerBlock(quiz))).not.toContain("answerKey");
    expect(JSON.stringify(sanitizePlayerBlock(quiz))).not.toContain("B is correct");
    expect(JSON.stringify(sanitizePlayerBlock(drag))).not.toContain("correctOrder");
  });

  it("completes a correct quiz on the first attempt and explains why it was right", () => {
    const result = gradePlayerBlock(quiz, { q1: "B" });
    expect(result).toEqual(expect.objectContaining({ complete: true, score: 1 }));
    expect(result.feedback).toEqual({
      kind: "quiz", correct: true, retryAvailable: false,
      questions: [{ questionId: "q1", correct: true, correctAnswer: "B", explanation: "B is correct" }],
    });
  });

  /**
   * The leak this whole shape exists to close: the first wrong answer used to
   * come back with `correctAnswer` and `explanation` attached, which the player
   * then printed verbatim. `sanitizePlayerBlock` strips both from the lesson
   * DTO, so grading was the only door left open — and it was open.
   */
  it("withholds the key on a missed first attempt and leaves the block open", () => {
    const result = gradePlayerBlock(quiz, { q1: "A" }, 1);
    expect(result).toEqual(expect.objectContaining({ complete: false, score: 0 }));
    expect(result.feedback).toEqual({
      kind: "quiz", correct: false, retryAvailable: true,
      questions: [{ questionId: "q1", correct: false }],
    });
    expect(JSON.stringify(result.feedback)).not.toContain("B is correct");
  });

  it("reveals the key once the retry is spent, and completes regardless of score", () => {
    const result = gradePlayerBlock(quiz, { q1: "A" }, 2);
    expect(result).toEqual(expect.objectContaining({ complete: true, score: 0 }));
    expect(result.feedback).toEqual({
      kind: "quiz", correct: false, retryAvailable: false,
      questions: [{ questionId: "q1", correct: false, correctAnswer: "B", explanation: "B is correct" }],
    });
  });

  it("reveals only the questions already answered right in a part-correct block", () => {
    const twoQuestions = lessonBlockSchema.parse({
      id: "quiz2", order: 1, blockType: "quiz_checkpoint", concepts: [],
      questions: [
        { id: "q1", prompt: "One", format: "multiple_choice", options: ["A", "B"], answerKey: "A", explanation: "A one." },
        { id: "q2", prompt: "Two", format: "multiple_choice", options: ["A", "B"], answerKey: "B", explanation: "B two." },
      ],
    });
    const feedback = gradePlayerBlock(twoQuestions, { q1: "A", q2: "A" }, 1).feedback;
    expect(feedback).toEqual({
      kind: "quiz", correct: false, retryAvailable: true,
      questions: [
        { questionId: "q1", correct: true, correctAnswer: "A", explanation: "A one." },
        { questionId: "q2", correct: false },
      ],
    });
    expect(JSON.stringify(feedback)).not.toContain("B two.");
  });

  it("rejects incomplete quiz submissions", () => {
    expect(() => gradePlayerBlock(quiz, {})).toThrow(PlayerError);
  });

  it("keeps drag order incomplete and identifies misplaced positions", () => {
    expect(gradePlayerBlock(drag, [0, 1, 2])).toEqual(expect.objectContaining({ complete: false, feedback: { kind: "drag_order", correct: false, misplacedPositions: [0, 1, 2], correctOrder: undefined } }));
  });

  it("completes drag order only for the exact permutation", () => {
    expect(gradePlayerBlock(drag, [2, 0, 1])).toEqual(expect.objectContaining({ complete: true, score: 1 }));
  });
});

describe("teach_back grading — B.2 Stage 2 reteach_gate branch", () => {
  const plainTeachBack = lessonBlockSchema.parse({
    id: "tb1", order: 1, blockType: "teach_back",
    prompt: "Explain it back", evaluatesConcepts: [], dimensionKey: "comprehension",
  });
  const reteachGateTeachBack = lessonBlockSchema.parse({
    id: "tb2", order: 2, blockType: "teach_back",
    prompt: "Explain it back", evaluatesConcepts: [], dimensionKey: "comprehension",
    assessment: { mode: "reteach_gate" },
  });

  it("a plain teach_back (no assessment.mode) still refuses gradePlayerBlock — unchanged", () => {
    expect(() => gradePlayerBlock(plainTeachBack, {})).toThrow(PlayerError);
    try {
      gradePlayerBlock(plainTeachBack, {});
      expect.unreachable();
    } catch (error) {
      expect((error as InstanceType<typeof PlayerError>).code).toBe("tutor_required");
    }
  });

  it("reteach_gate: incomplete when no reteachGate signal is supplied (no session yet)", () => {
    expect(gradePlayerBlock(reteachGateTeachBack, {})).toEqual({ complete: false, score: null, response: {}, feedback: null });
  });

  it("reteach_gate: incomplete when the caller-resolved signal says not passed", () => {
    expect(gradePlayerBlock(reteachGateTeachBack, {}, 1, { passed: false, score: null })).toEqual({
      complete: false, score: null, response: {}, feedback: null,
    });
  });

  it("reteach_gate: complete once the caller-resolved signal says passed", () => {
    expect(gradePlayerBlock(reteachGateTeachBack, {}, 1, { passed: true, score: null })).toEqual({
      complete: true, score: null, response: {}, feedback: null,
    });
  });

  it("reteach_gate: carries through whatever score the caller already gated on showScoreToLearner", () => {
    // gradePlayerBlock trusts the caller's score as-is — it never re-derives
    // or re-gates showScoreToLearner itself. A caller that decided to expose
    // 0.85 sees 0.85; a caller that decided not to show a score passes null.
    expect(gradePlayerBlock(reteachGateTeachBack, {}, 1, { passed: true, score: 0.85 }).score).toBe(0.85);
    expect(gradePlayerBlock(reteachGateTeachBack, {}, 1, { passed: true, score: null }).score).toBeNull();
  });
});

describe("mergeBlockAssessmentConfig — mirrors mergePassingConfig's per-field shape", () => {
  const base = {
    passing: { dimensionKey: "comprehension", threshold: 7, confidenceFloor: 0.5, minTurns: 2, maxTurns: 12 },
    allowRetake: true,
    blocking: true,
    onMaxTurnsWithoutPass: "complete_with_scores" as const,
    autoAppendTeachBack: false,
    showScoreToLearner: false,
    webQuizPassingScore: 1,
  };

  it("returns the base values untouched when no override is given", () => {
    expect(mergeBlockAssessmentConfig(base)).toEqual({
      passing: base.passing,
      allowRetake: true,
      showScoreToLearner: false,
      webQuizPassingScore: 1,
    });
  });

  it("overrides only the fields present on the block, per field — not wholesale replacement", () => {
    const merged = mergeBlockAssessmentConfig(base, { mode: "reteach_gate", showScoreToLearner: true });
    expect(merged.showScoreToLearner).toBe(true);
    // Untouched fields still come from the base, proving this isn't "override present -> replace everything".
    expect(merged.passing).toEqual(base.passing);
    expect(merged.allowRetake).toBe(true);
  });

  it("overrides individual passing fields independently, not the whole passing object at once", () => {
    const merged = mergeBlockAssessmentConfig(base, {
      mode: "reteach_gate",
      passingOverride: { threshold: 9 },
    });
    expect(merged.passing.threshold).toBe(9);
    // Every other passing field still falls back to base.
    expect(merged.passing.dimensionKey).toBe("comprehension");
    expect(merged.passing.confidenceFloor).toBe(0.5);
    expect(merged.passing.minTurns).toBe(2);
    expect(merged.passing.maxTurns).toBe(12);
  });

  it("allowRetake override wins over the base value", () => {
    expect(mergeBlockAssessmentConfig(base, { mode: "reteach_gate", allowRetake: false }).allowRetake).toBe(false);
  });
});
