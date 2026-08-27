import { describe, expect, it } from "vitest";
import { lessonBlockSchema } from "@/lib/journey-package/journey-package.schema";
import { programVersionConfigSchema } from "@/lib/journey-package/program-version-config.schema";
import { aggregateDiagnosticDimensionScores, capstoneTutorGrounding, currentLessonKeyFor, diagnosticDto, gradePlayerBlock, matchesExpansionParent, mergeBlockAssessmentConfig, milestoneStates, passingDiagnosticDimensions, PlayerError, sanitizePlayerBlock, shuffleOptions, type PlayerAccess } from "../service";

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

describe("currentLessonKeyFor — the capstone page's 'back to lesson' target", () => {
  it("returns the first incomplete lesson", () => {
    const lessons = [
      { lessonKey: "lesson-1", complete: true },
      { lessonKey: "lesson-2", complete: false },
      { lessonKey: "lesson-3", complete: false },
    ];
    expect(currentLessonKeyFor(lessons)).toBe("lesson-2");
  });

  it("falls back to the last lesson once every lesson is complete", () => {
    const lessons = [
      { lessonKey: "lesson-1", complete: true },
      { lessonKey: "lesson-2", complete: true },
    ];
    expect(currentLessonKeyFor(lessons)).toBe("lesson-2");
  });

  it("returns null for a course with no lessons", () => {
    expect(currentLessonKeyFor([])).toBeNull();
  });

  it("returns the only lesson when nothing is complete yet", () => {
    expect(currentLessonKeyFor([{ lessonKey: "lesson-1", complete: false }])).toBe("lesson-1");
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
    webQuizMaxAttempts: 2,
  };

  it("returns the base values untouched when no override is given", () => {
    expect(mergeBlockAssessmentConfig(base)).toEqual({
      passing: base.passing,
      allowRetake: true,
      showScoreToLearner: false,
      webQuizPassingScore: 1,
      webQuizMaxAttempts: 2,
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

describe("shuffleOptions", () => {
  const options = ["A", "B", "C", "D", "E", "F", "G", "H"];

  it("returns every original element exactly once, in some order", () => {
    const shuffled = shuffleOptions(options);
    expect(shuffled).toHaveLength(options.length);
    expect([...shuffled].sort()).toEqual([...options].sort());
  });

  it("does not mutate the input array", () => {
    const copy = [...options];
    shuffleOptions(options);
    expect(options).toEqual(copy);
  });

  // Statistical, not flaky-deterministic: with 8 options there are 8! possible
  // orders, so 50 independent calls landing on the exact same order as the
  // input, or all being identical to each other, would require probability
  // effectively zero from a real shuffle. This can't assert "always
  // different" for any single pair of calls — a fair shuffle occasionally
  // reproduces its input — only that it isn't a no-op or a constant.
  it("produces a different order across repeated calls, not the same one every time", () => {
    const results = Array.from({ length: 50 }, () => shuffleOptions(options).join(","));
    const distinctOrders = new Set(results);
    expect(distinctOrders.size).toBeGreaterThan(1);
    expect(results.some((order) => order !== options.join(","))).toBe(true);
  });
});

describe("multiple_choice option shuffle in sanitizePlayerBlock and diagnosticDto", () => {
  it("shuffles multiple_choice options, grading stays correct regardless of the order shown", () => {
    const shuffled = sanitizePlayerBlock(quiz) as { questions: Array<{ options?: string[] }> };
    // Same two options either way (8 possible orderings from 2! here just
    // means "unchanged or swapped" — the real order-variety case is covered
    // by shuffleOptions itself above, which uses enough options for that).
    expect([...(shuffled.questions[0].options ?? [])].sort()).toEqual(["A", "B"]);
    // Grading is keyed by the answer's value, not its position in whatever
    // order the client was shown — this is what makes shuffling safe at all.
    expect(gradePlayerBlock(quiz, { q1: "B" })).toEqual(expect.objectContaining({ complete: true, score: 1 }));
    expect(gradePlayerBlock(quiz, { q1: "A" }, 1)).toEqual(expect.objectContaining({ complete: false, score: 0 }));
  });

  it("does not touch drag_to_order's own rotation, only multiple_choice", () => {
    const solvedFirst = lessonBlockSchema.parse({
      id: "solved", order: 1, blockType: "quiz_checkpoint", assessment: { mode: "web_quiz" },
      questions: [{ id: "order", prompt: "Order", format: "drag_to_order", options: ["A", "B", "C"], answerKey: ["A", "B", "C"], explanation: "ABC." }],
    });
    const safe = sanitizePlayerBlock(solvedFirst) as { questions: Array<{ options?: string[] }> };
    // Exactly the pre-existing one-position rotation, not a full shuffle —
    // pinning that the new multiple_choice branch doesn't also fire here.
    expect(safe.questions[0].options).toEqual(["B", "C", "A"]);
  });

  it("leaves matching's shared option pool untouched (no positional grading to protect, and no shuffle branch for it)", () => {
    const matching = lessonBlockSchema.parse({
      id: "match", order: 1, blockType: "quiz_checkpoint", assessment: { mode: "web_quiz" },
      questions: [{
        id: "m1", prompt: "Match", format: "matching",
        options: ["One", "Two"],
        matchingPrompts: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
        answerKey: { a: "One", b: "Two" },
      }],
    });
    const safe = sanitizePlayerBlock(matching) as { questions: Array<{ options?: string[] }> };
    expect(safe.questions[0].options).toEqual(["One", "Two"]);
  });

  it("also shuffles diagnosticDto's multiple_choice questions (block 0.3's bug)", () => {
    const config = programVersionConfigSchema.parse({
      onboarding: {
        mode: "baseline_quiz",
        steps: [],
        diagnostic: {
          id: "diag", title: "Baseline", threshold: 0.5,
          questions: [{
            id: "diag-q1", format: "multiple_choice", graded: true,
            prompt: "Pick", options: ["A", "B", "C", "D", "E", "F", "G", "H"],
            answerKey: "B",
          }],
        },
      },
    });
    const access = { config } as PlayerAccess;
    const orders = Array.from({ length: 50 }, () => diagnosticDto(access).questions[0].options?.join(","));
    expect(new Set(orders).size).toBeGreaterThan(1);
    // Every shuffled result is still the same 8 options, none dropped or duplicated.
    for (const order of orders) expect(order?.split(",").sort()).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
  });
});
