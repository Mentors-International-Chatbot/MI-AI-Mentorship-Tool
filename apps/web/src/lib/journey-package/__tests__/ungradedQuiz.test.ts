import { describe, expect, it } from "vitest";
import { journeyPackageSchema, quizQuestionSchema } from "../journey-package.schema";
import { gradePlayerBlock, sanitizePlayerBlock } from "@/lib/player/service";

/**
 * Ungraded MCQ — a selectable question with no correct answer
 * ═══════════════════════════════════════════════════════════════════════════
 * `graded` lives on the question, not the block, because the `answerKey` rule
 * is enforced inside `quizQuestionSchema.superRefine`, which cannot see a
 * parent block. `baselineDiagnosticSchema.questions` shares that schema, so
 * relocating the rule to read a block-level flag would move the check that
 * currently protects the diagnostic.
 *
 * The load-bearing property is the default: every question authored before this
 * flag existed must keep requiring an answer key.
 */
const gradedQuestion = {
  id: "q1", prompt: "Which one repeats?", format: "multiple_choice" as const,
  options: ["A", "B"], answerKey: "A", explanation: "A repeats.",
};

describe("graded defaults to true", () => {
  it("still requires an answerKey when graded is not authored", () => {
    const result = quizQuestionSchema.safeParse({ ...gradedQuestion, answerKey: undefined });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("answerKey must equal exactly one raw option");
  });

  it("still requires the key to match exactly one option", () => {
    const result = quizQuestionSchema.safeParse({ ...gradedQuestion, answerKey: "C" });
    expect(result.success).toBe(false);
  });

  it("parses a pre-existing question unchanged and marks it graded", () => {
    const result = quizQuestionSchema.parse(gradedQuestion);
    expect(result.graded).toBe(true);
  });
});

describe("ungraded questions", () => {
  const ungraded = {
    id: "q2", prompt: "What do you know about AI skills?", format: "multiple_choice" as const,
    options: ["A lot", "Some", "You mean like basketball skills?"], graded: false,
  };

  it("validate with no answerKey and no explanation", () => {
    expect(quizQuestionSchema.safeParse(ungraded).success).toBe(true);
  });

  it("still require at least two distinct options", () => {
    expect(quizQuestionSchema.safeParse({ ...ungraded, options: ["Only one"] }).success).toBe(false);
    expect(quizQuestionSchema.safeParse({ ...ungraded, options: ["Same", "Same"] }).success).toBe(false);
  });

  it("refuse a stray answerKey, which would read as authoritative", () => {
    const result = quizQuestionSchema.safeParse({ ...ungraded, answerKey: "A lot" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("must not declare an answerKey");
  });
});

describe("grading an ungraded block", () => {
  const block = {
    id: "b1", order: 1, blockType: "quiz_checkpoint" as const, concepts: [], contentVersion: 1,
    questions: [quizQuestionSchema.parse({
      id: "q2", prompt: "What do you know?", format: "multiple_choice",
      options: ["A lot", "Some"], graded: false,
    })],
  };

  it("completes, records the choice, and scores null rather than zero", () => {
    const result = gradePlayerBlock(block, { q2: "Some" });
    expect(result.complete).toBe(true);
    expect(result.score).toBeNull();
    expect(result.response).toEqual({ q2: "Some" });
    // Null feedback is what lets the player advance instead of pausing on a
    // verdict panel with nothing in it.
    expect(result.feedback).toBeNull();
  });

  it("still rejects an answer that is not one of the options", () => {
    expect(() => gradePlayerBlock(block, { q2: "Something else" })).toThrow();
  });

  it("still rejects a missing answer", () => {
    expect(() => gradePlayerBlock(block, {})).toThrow();
  });

  it("keeps grading the graded questions in a mixed block", () => {
    const mixed = {
      ...block,
      questions: [
        block.questions[0],
        quizQuestionSchema.parse(gradedQuestion),
      ],
    };
    const result = gradePlayerBlock(mixed, { q2: "Some", q1: "A" });
    expect(result.score).toBe(1);
    expect(result.feedback).toEqual({ questions: [expect.objectContaining({ questionId: "q1", correct: true })] });
  });

  it("sends graded to the client but never the key", () => {
    const safe = sanitizePlayerBlock(block) as { questions: Array<Record<string, unknown>> };
    expect(safe.questions[0].graded).toBe(false);
    expect(safe.questions[0]).not.toHaveProperty("answerKey");
    expect(safe.questions[0]).not.toHaveProperty("explanation");
  });
});

describe("diagnostics cannot opt out of grading", () => {
  const pkg = (graded: boolean) => ({
    schemaVersion: "1.2" as const,
    metadata: { packageId: "p", title: "P", languages: ["en"], version: "1" },
    config: {
      trackedDimensions: [{
        key: "d1", label: "D", category: "comprehension" as const,
        primary: true, scale: { min: 0, max: 10 }, calibrationMode: "zero_start" as const,
      }],
      onboarding: {
        mode: "baseline_quiz" as const,
        diagnostic: {
          id: "diag", title: "Diagnostic", threshold: 0.5,
          questions: [{
            id: "dq1", prompt: "Which?", format: "multiple_choice" as const,
            options: ["A", "B"], answerKey: "A", explanation: "A.", dimensionKey: "d1", graded,
          }],
        },
      },
    },
    curriculum: {
      collectionKey: "c",
      lessons: [{
        key: "l1", title: "L", blocks: [{
          id: "b1", order: 1, blockType: "teach" as const, role: "explanation" as const, content: "Hi",
        }],
      }],
    },
  });

  it("accepts a graded diagnostic question", () => {
    expect(journeyPackageSchema.safeParse(pkg(true)).success).toBe(true);
  });

  it("rejects an ungraded one — a diagnostic scores dimensions against a threshold", () => {
    const result = journeyPackageSchema.safeParse(pkg(false));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("must be graded");
  });
});
