/**
 * Journey Package Schema — assessment validation tests
 * ----------------------------------------------------------------------------
 * Tests for Phase A gated teach-back assessment schema additions.
 * Verifies cross-reference validation for assessment config and teach_back blocks.
 */
import { describe, it, expect } from "vitest";
import { journeyPackageSchema, SCHEMA_VERSION, type JourneyPackageInput } from "../journey-package.schema";

/** Minimal valid package base for testing */
function makeBasePackage(overrides?: Partial<JourneyPackageInput>): JourneyPackageInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      packageId: "test-pkg",
      title: "Test Package",
      languages: ["en"],
      version: "1.0.0",
    },
    config: {
      trackedDimensions: [
        {
          key: "comprehension",
          label: "Comprehension",
          category: "comprehension",
          primary: true,
          scale: { min: 0, max: 10 },
          calibrationMode: "zero_start",
        },
      ],
      alertRules: [],
    },
    curriculum: {
      collectionKey: "test-collection",
      lessons: [
        {
          key: "lesson-1",
          title: "Test Lesson",
          keyConcepts: ["concept 1"],
          selfCheckQuestions: [],
          blocks: [
            {
              id: "b1",
              order: 1,
              blockType: "teach",
              role: "explanation",
              content: "Test content",
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe("Journey Package Schema — Assessment Validation", () => {
  describe("gated_session requires config.assessment", () => {
    it("fails when teach_back has delivery=gated_session but config.assessment is missing", () => {
      const pkg = makeBasePackage();
      pkg.curriculum.lessons[0].blocks.push({
        id: "b2-gated",
        order: 2,
        blockType: "teach_back",
        prompt: "Explain this",
        evaluatesConcepts: [],
        dimensionKey: "comprehension",
        delivery: "gated_session",
      });

      const result = journeyPackageSchema.safeParse(pkg);

      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes("gated_session") && m.includes("config.assessment"))).toBe(true);
      }
    });

    it("passes when gated_session teach_back has config.assessment present", () => {
      const pkg = makeBasePackage({
        config: {
          trackedDimensions: [
            {
              key: "comprehension",
              label: "Comprehension",
              category: "comprehension",
              primary: true,
              scale: { min: 0, max: 10 },
              calibrationMode: "zero_start",
            },
          ],
          alertRules: [],
          assessment: {
            passing: { dimensionKey: "comprehension", threshold: 7 },
            blocking: true,
            allowRetake: true,
          },
        },
      });
      pkg.curriculum.lessons[0].blocks.push({
        id: "b2-gated",
        order: 2,
        blockType: "teach_back",
        prompt: "Explain this",
        evaluatesConcepts: [],
        dimensionKey: "comprehension",
        delivery: "gated_session",
      });

      const result = journeyPackageSchema.safeParse(pkg);
      expect(result.success).toBe(true);
    });
  });

  describe("assessment.passing.dimensionKey validation", () => {
    it("fails when passing.dimensionKey is not in trackedDimensions", () => {
      const pkg = makeBasePackage({
        config: {
          trackedDimensions: [
            {
              key: "comprehension",
              label: "Comprehension",
              category: "comprehension",
              primary: true,
              scale: { min: 0, max: 10 },
              calibrationMode: "zero_start",
            },
          ],
          alertRules: [],
          assessment: {
            passing: { dimensionKey: "nonexistent", threshold: 7 },
          },
        },
      });

      const result = journeyPackageSchema.safeParse(pkg);

      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes("nonexistent") && m.includes("trackedDimensions"))).toBe(true);
      }
    });
  });

  describe("studentVisibleDimensionKeys / recordedDimensionKeys validation", () => {
    it("fails when studentVisibleDimensionKeys contains unknown key", () => {
      const pkg = makeBasePackage({
        config: {
          trackedDimensions: [
            {
              key: "comprehension",
              label: "Comprehension",
              category: "comprehension",
              primary: true,
              scale: { min: 0, max: 10 },
              calibrationMode: "zero_start",
            },
          ],
          alertRules: [],
          assessment: {
            passing: { dimensionKey: "comprehension", threshold: 7 },
            studentVisibleDimensionKeys: ["comprehension", "unknown-dim"],
          },
        },
      });

      const result = journeyPackageSchema.safeParse(pkg);

      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes("unknown-dim"))).toBe(true);
      }
    });

    it("fails when recordedDimensionKeys contains unknown key", () => {
      const pkg = makeBasePackage({
        config: {
          trackedDimensions: [
            {
              key: "comprehension",
              label: "Comprehension",
              category: "comprehension",
              primary: true,
              scale: { min: 0, max: 10 },
              calibrationMode: "zero_start",
            },
          ],
          alertRules: [],
          assessment: {
            passing: { dimensionKey: "comprehension", threshold: 7 },
            recordedDimensionKeys: ["bad-key"],
          },
        },
      });

      const result = journeyPackageSchema.safeParse(pkg);

      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes("bad-key"))).toBe(true);
      }
    });
  });

  describe("passingOverride.dimensionKey validation", () => {
    it("fails when passingOverride.dimensionKey is not in trackedDimensions", () => {
      const pkg = makeBasePackage({
        config: {
          trackedDimensions: [
            {
              key: "comprehension",
              label: "Comprehension",
              category: "comprehension",
              primary: true,
              scale: { min: 0, max: 10 },
              calibrationMode: "zero_start",
            },
          ],
          alertRules: [],
          assessment: {
            passing: { dimensionKey: "comprehension", threshold: 7 },
          },
        },
      });
      pkg.curriculum.lessons[0].blocks.push({
        id: "b2-gated",
        order: 2,
        blockType: "teach_back",
        prompt: "Explain this",
        evaluatesConcepts: [],
        dimensionKey: "comprehension",
        delivery: "gated_session",
        passingOverride: { dimensionKey: "invalid-dim" },
      });

      const result = journeyPackageSchema.safeParse(pkg);

      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes("invalid-dim") && m.includes("passingOverride"))).toBe(true);
      }
    });
  });

  describe("valid gated package", () => {
    it("PB&J-shaped package with assessment passes and resolves defaults", () => {
      const pkg = makeBasePackage({
        config: {
          trackedDimensions: [
            {
              key: "sequencing",
              label: "Step Sequencing",
              category: "comprehension",
              primary: true,
              scale: { min: 0, max: 10 },
              calibrationMode: "zero_start",
            },
            {
              key: "confidence",
              label: "Task Confidence",
              category: "emotional",
              primary: true,
              scale: { min: 0, max: 10 },
              calibrationMode: "assumed_baseline",
              assumedBaseline: 5,
            },
          ],
          alertRules: [],
          assessment: {
            passing: { dimensionKey: "sequencing", threshold: 7, minTurns: 2, maxTurns: 10 },
            onMaxTurnsWithoutPass: "complete_with_scores",
            blocking: true,
            allowRetake: true,
          },
        },
      });
      pkg.curriculum.lessons[0].blocks.push({
        id: "b2-gated",
        order: 2,
        blockType: "teach_back",
        prompt: "Walk me through how to make a PB&J",
        evaluatesConcepts: ["Steps in order"],
        dimensionKey: "sequencing",
        delivery: "gated_session",
      });

      const result = journeyPackageSchema.safeParse(pkg);

      expect(result.success).toBe(true);
      if (result.success) {
        // Check defaults resolved
        const passing = result.data.config.assessment?.passing;
        expect(passing?.confidenceFloor).toBe(0.5); // default applied
        expect(passing?.minTurns).toBe(2);
        expect(passing?.maxTurns).toBe(10);

        // Check gated block has delivery resolved
        const gatedBlock = result.data.curriculum.lessons[0].blocks.find((b) => b.id === "b2-gated");
        expect(gatedBlock?.blockType).toBe("teach_back");
        if (gatedBlock?.blockType === "teach_back") {
          expect(gatedBlock.delivery).toBe("gated_session");
        }
      }
    });
  });

  describe("inline teach_back without assessment", () => {
    it("package with inline teach_back and no config.assessment validates (regression guard)", () => {
      const pkg = makeBasePackage();
      pkg.curriculum.lessons[0].blocks.push({
        id: "b2-inline",
        order: 2,
        blockType: "teach_back",
        prompt: "Explain this",
        evaluatesConcepts: [],
        dimensionKey: "comprehension",
        // delivery omitted (defaults to "inline")
      });

      const result = journeyPackageSchema.safeParse(pkg);

      expect(result.success).toBe(true);
      if (result.success) {
        const block = result.data.curriculum.lessons[0].blocks.find((b) => b.id === "b2-inline");
        if (block?.blockType === "teach_back") {
          // delivery should default to "inline"
          expect(block.delivery).toBe("inline");
        }
      }
    });

    it("package with delivery='inline' explicitly and no config.assessment validates", () => {
      const pkg = makeBasePackage();
      pkg.curriculum.lessons[0].blocks.push({
        id: "b2-inline",
        order: 2,
        blockType: "teach_back",
        prompt: "Explain this",
        evaluatesConcepts: [],
        dimensionKey: "comprehension",
        delivery: "inline",
      });

      const result = journeyPackageSchema.safeParse(pkg);
      expect(result.success).toBe(true);
    });
  });

  describe("blockBase.handoff", () => {
    it("is optional: a block with no handoff still validates", () => {
      const pkg = makeBasePackage();
      const result = journeyPackageSchema.safeParse(pkg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.curriculum.lessons[0].blocks[0].handoff).toBeUndefined();
      }
    });

    it("is available on every block type, not just quiz_checkpoint", () => {
      const pkg = makeBasePackage();
      pkg.curriculum.lessons[0].blocks.push({
        id: "b2-quiz",
        order: 2,
        blockType: "quiz_checkpoint",
        title: "Where you're starting from",
        handoff: "Now a couple of quick questions.",
        questions: [
          { id: "q1", prompt: "Pick one", format: "multiple_choice", options: ["A", "B"], answerKey: "A", explanation: "A is correct because...", graded: true },
        ],
      });

      const result = journeyPackageSchema.safeParse(pkg);
      expect(result.success).toBe(true);
      if (result.success) {
        const block = result.data.curriculum.lessons[0].blocks.find((b) => b.id === "b2-quiz");
        expect(block?.handoff).toBe("Now a couple of quick questions.");
      }
    });

    it("rejects an empty handoff rather than authoring a silent no-op line", () => {
      const pkg = makeBasePackage();
      pkg.curriculum.lessons[0].blocks[0] = { ...pkg.curriculum.lessons[0].blocks[0], handoff: "" };
      const result = journeyPackageSchema.safeParse(pkg);
      expect(result.success).toBe(false);
    });
  });
});
