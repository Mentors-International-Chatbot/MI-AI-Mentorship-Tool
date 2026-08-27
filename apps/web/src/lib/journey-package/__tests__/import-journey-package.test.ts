/**
 * Import Journey Package Tests
 * Tests for autoAppendTeachBack synthesis logic.
 */
import { describe, it, expect } from "vitest";
import { maybeAppendTeachBack } from "../import-journey-package";
import type { PackageLesson } from "../journey-package.schema";

/** Minimal lesson fixture */
function makeLesson(key: string, blocks: PackageLesson["blocks"] = []): PackageLesson {
  return {
    key,
    title: `Lesson: ${key}`,
    keyConcepts: ["concept-a", "concept-b"],
    selfCheckQuestions: [],
    blocks:
      blocks.length > 0
        ? blocks
        : [
            { id: "b1", order: 1, blockType: "teach", role: "scenario", content: "Content" },
            { id: "b2", order: 2, blockType: "teach", role: "explanation", content: "More content" },
          ],
  };
}

/** Assessment config with autoAppendTeachBack enabled */
const assessmentEnabled = {
  passing: {
    dimensionKey: "comprehension",
    threshold: 7,
    confidenceFloor: 0.5,
    minTurns: 1,
    maxTurns: 10,
  },
  onMaxTurnsWithoutPass: "complete_with_scores" as const,
  allowRetake: true,
  blocking: true,
  autoAppendTeachBack: true,
  showScoreToLearner: false,
  webQuizPassingScore: 1,
  webQuizMaxAttempts: 2,
};

/** Assessment config with autoAppendTeachBack disabled */
const assessmentDisabled = {
  passing: {
    dimensionKey: "comprehension",
    threshold: 7,
    confidenceFloor: 0.5,
    minTurns: 1,
    maxTurns: 10,
  },
  onMaxTurnsWithoutPass: "complete_with_scores" as const,
  allowRetake: true,
  blocking: true,
  autoAppendTeachBack: false,
  showScoreToLearner: false,
  webQuizPassingScore: 1,
  webQuizMaxAttempts: 2,
};

describe("maybeAppendTeachBack", () => {
  describe("autoAppendTeachBack: true", () => {
    it("synthesizes gated teach_back with deterministic id for lesson lacking teach_back", () => {
      const lessons = [makeLesson("lesson-01")];

      const { lessons: result, synthesizedCount } = maybeAppendTeachBack(
        lessons,
        assessmentEnabled
      );

      expect(synthesizedCount).toBe(1);
      expect(result[0].blocks).toHaveLength(3);

      const synthBlock = result[0].blocks.find((b) => b.id === "lesson-01-synth-teachback");
      expect(synthBlock).toBeDefined();
      expect(synthBlock?.blockType).toBe("teach_back");
      if (synthBlock?.blockType === "teach_back") {
        expect(synthBlock.delivery).toBe("gated_session");
        expect(synthBlock.dimensionKey).toBe("comprehension");
        expect(synthBlock.evaluatesConcepts).toEqual(["concept-a", "concept-b"]);
        expect(synthBlock.order).toBe(3); // max(1,2) + 1
      }
    });

    it("re-import produces same block id, no duplicate", () => {
      const lessons = [makeLesson("lesson-01")];

      // First import
      const { lessons: firstResult } = maybeAppendTeachBack(lessons, assessmentEnabled);
      expect(firstResult[0].blocks).toHaveLength(3);

      // Simulate re-import: pass the result through again
      // (In real import, this would be the lessons from DB, but the id is deterministic)
      const { lessons: secondResult, synthesizedCount } = maybeAppendTeachBack(
        firstResult,
        assessmentEnabled
      );

      // Should skip because lesson now has a teach_back
      expect(synthesizedCount).toBe(0);
      expect(secondResult[0].blocks).toHaveLength(3);

      // Verify same block id, not duplicated
      const teachBacks = secondResult[0].blocks.filter((b) => b.blockType === "teach_back");
      expect(teachBacks).toHaveLength(1);
      expect(teachBacks[0].id).toBe("lesson-01-synth-teachback");
    });

    it("skips lesson that already has inline teach_back", () => {
      const lessons = [
        makeLesson("lesson-with-inline", [
          { id: "b1", order: 1, blockType: "teach", role: "scenario", content: "Content" },
          {
            id: "b2-inline",
            order: 2,
            blockType: "teach_back",
            prompt: "Explain",
            evaluatesConcepts: [],
            dimensionKey: "comprehension",
            // No delivery = inline
          },
        ]),
      ];

      const { lessons: result, synthesizedCount } = maybeAppendTeachBack(
        lessons,
        assessmentEnabled
      );

      expect(synthesizedCount).toBe(0);
      expect(result[0].blocks).toHaveLength(2);
      // No new block added
      expect(result[0].blocks.find((b) => b.id === "lesson-with-inline-synth-teachback")).toBeUndefined();
    });

    it("skips lesson that already has gated teach_back", () => {
      const lessons = [
        makeLesson("lesson-with-gated", [
          { id: "b1", order: 1, blockType: "teach", role: "scenario", content: "Content" },
          {
            id: "b2-gated",
            order: 2,
            blockType: "teach_back",
            prompt: "Explain",
            evaluatesConcepts: [],
            dimensionKey: "comprehension",
            delivery: "gated_session",
          },
        ]),
      ];

      const { lessons: result, synthesizedCount } = maybeAppendTeachBack(
        lessons,
        assessmentEnabled
      );

      expect(synthesizedCount).toBe(0);
      expect(result[0].blocks).toHaveLength(2);
    });

    it("synthesizes for multiple lessons, skipping those with teach_back", () => {
      const lessons = [
        makeLesson("lesson-01"), // no teach_back → synthesize
        makeLesson("lesson-02", [
          { id: "b1", order: 1, blockType: "teach", role: "scenario", content: "C" },
          {
            id: "existing-tb",
            order: 2,
            blockType: "teach_back",
            prompt: "P",
            evaluatesConcepts: [],
            dimensionKey: "comprehension",
          },
        ]), // has teach_back → skip
        makeLesson("lesson-03"), // no teach_back → synthesize
      ];

      const { lessons: result, synthesizedCount } = maybeAppendTeachBack(
        lessons,
        assessmentEnabled
      );

      expect(synthesizedCount).toBe(2);
      expect(result[0].blocks.find((b) => b.id === "lesson-01-synth-teachback")).toBeDefined();
      expect(result[1].blocks.find((b) => b.id === "lesson-02-synth-teachback")).toBeUndefined();
      expect(result[2].blocks.find((b) => b.id === "lesson-03-synth-teachback")).toBeDefined();
    });
  });

  describe("autoAppendTeachBack: false", () => {
    it("does not synthesize any blocks", () => {
      const lessons = [makeLesson("lesson-01"), makeLesson("lesson-02")];

      const { lessons: result, synthesizedCount } = maybeAppendTeachBack(
        lessons,
        assessmentDisabled
      );

      expect(synthesizedCount).toBe(0);
      expect(result[0].blocks).toHaveLength(2);
      expect(result[1].blocks).toHaveLength(2);
    });
  });

  describe("no assessment config", () => {
    it("does not synthesize any blocks when assessment is undefined", () => {
      const lessons = [makeLesson("lesson-01")];

      const { lessons: result, synthesizedCount } = maybeAppendTeachBack(lessons, undefined);

      expect(synthesizedCount).toBe(0);
      expect(result[0].blocks).toHaveLength(2);
    });
  });
});
