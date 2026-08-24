/**
 * Block-level `assessment` override — B.2 (design shape (c))
 * ----------------------------------------------------------------------------
 * `mode` (reteach_gate/web_quiz) is per-block authoring, not a package-wide
 * switch: a course can mix a reteach-style gate in one lesson with a plain
 * graded checkpoint in another. `config.assessment` stays package-level
 * defaults only (threshold, allowRetake, showScoreToLearner, turn limits);
 * any block may carry its own `assessment: { mode, ...overrides }`, merged
 * over those defaults at read time (not yet — this is schema only).
 *
 * No 7th `lessonBlockSchema` union member: `web_quiz`'s content is
 * `questions[]`, which `quiz_checkpoint` already has. `assessment.mode` is
 * kept honest against the wrong block type by a package-level superRefine,
 * not by the type system, since `blockBase` cannot see its own `blockType`.
 */
import { describe, it, expect } from "vitest";
import { journeyPackageSchema, SCHEMA_VERSION, type JourneyPackageInput } from "../journey-package.schema";

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
      assessment: {
        passing: { dimensionKey: "comprehension", threshold: 7 },
      },
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
            { id: "b1", order: 1, blockType: "teach", role: "explanation", content: "Test content" },
          ],
        },
      ],
    },
    ...overrides,
  };
}

const quizQuestions = [
  { id: "q1", prompt: "Pick one", format: "multiple_choice" as const, options: ["A", "B"], answerKey: "A", explanation: "A is correct.", graded: true },
];

describe("block-level assessment override — mode must match blockType", () => {
  it("accepts assessment.mode='web_quiz' on a quiz_checkpoint block", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-quiz", order: 2, blockType: "quiz_checkpoint",
      questions: quizQuestions,
      assessment: { mode: "web_quiz" },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.curriculum.lessons[0].blocks.find((b) => b.id === "b2-quiz");
      expect(block?.assessment?.mode).toBe("web_quiz");
    }
  });

  it("accepts assessment.mode='reteach_gate' on a teach_back block", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-tb", order: 2, blockType: "teach_back",
      prompt: "Explain this", evaluatesConcepts: [], dimensionKey: "comprehension",
      assessment: { mode: "reteach_gate" },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
  });

  it("rejects assessment.mode='web_quiz' on a teach_back block", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-tb", order: 2, blockType: "teach_back",
      prompt: "Explain this", evaluatesConcepts: [], dimensionKey: "comprehension",
      assessment: { mode: "web_quiz" },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("web_quiz only applies to quiz_checkpoint"))).toBe(true);
    }
  });

  it("rejects assessment.mode='reteach_gate' on a quiz_checkpoint block", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-quiz", order: 2, blockType: "quiz_checkpoint",
      questions: quizQuestions,
      assessment: { mode: "reteach_gate" },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("reteach_gate only applies to teach_back"))).toBe(true);
    }
  });

  it("rejects assessment.mode='web_quiz' on a plain teach block (not eligible for either mode)", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks[0] = {
      id: "b1", order: 1, blockType: "teach", role: "explanation", content: "Test content",
      assessment: { mode: "web_quiz" },
    };

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
  });
});

describe("block-level assessment override — requires config.assessment to merge over", () => {
  it("rejects a block assessment.mode when config.assessment is missing", () => {
    const pkg = makeBasePackage({
      config: { trackedDimensions: [], alertRules: [] }, // no assessment defaults
    });
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-quiz", order: 2, blockType: "quiz_checkpoint",
      questions: quizQuestions,
      assessment: { mode: "web_quiz" },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("config.assessment is missing"))).toBe(true);
    }
  });
});

describe("block-level assessment override — passingOverride", () => {
  it("accepts a valid passingOverride.dimensionKey", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-quiz", order: 2, blockType: "quiz_checkpoint",
      questions: quizQuestions,
      assessment: { mode: "web_quiz", passingOverride: { dimensionKey: "comprehension", threshold: 9 } },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown passingOverride.dimensionKey", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-quiz", order: 2, blockType: "quiz_checkpoint",
      questions: quizQuestions,
      assessment: { mode: "web_quiz", passingOverride: { dimensionKey: "not-a-real-dimension" } },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("not found in trackedDimensions"))).toBe(true);
    }
  });

  it("accepts allowRetake and showScoreToLearner overrides", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-quiz", order: 2, blockType: "quiz_checkpoint",
      questions: quizQuestions,
      assessment: { mode: "web_quiz", allowRetake: false, showScoreToLearner: true },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.curriculum.lessons[0].blocks.find((b) => b.id === "b2-quiz");
      expect(block?.assessment?.allowRetake).toBe(false);
      expect(block?.assessment?.showScoreToLearner).toBe(true);
    }
  });
});

describe("block-level assessment override — reteach_gate requires a player-surface write path (B.2 Stage 2 gap)", () => {
  it("rejects assessment.mode='reteach_gate' on an explicit player-surface course", () => {
    const pkg = makeBasePackage({
      metadata: {
        packageId: "test-pkg", title: "Test Package", languages: ["en"], version: "1.0.0",
        delivery: { surface: "player", supportedChannels: ["web"] },
      },
    });
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-tb", order: 2, blockType: "teach_back",
      prompt: "Explain this", evaluatesConcepts: [], dimensionKey: "comprehension",
      assessment: { mode: "reteach_gate" },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("no write path for reteach-gate sessions yet"))).toBe(true);
    }
  });

  it("still accepts assessment.mode='reteach_gate' on an explicit chat-surface course (PBJ's own mechanism)", () => {
    const pkg = makeBasePackage({
      metadata: {
        packageId: "test-pkg", title: "Test Package", languages: ["en"], version: "1.0.0",
        delivery: { surface: "chat", supportedChannels: ["web", "whatsapp"] },
      },
    });
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-tb", order: 2, blockType: "teach_back",
      prompt: "Explain this", evaluatesConcepts: [], dimensionKey: "comprehension",
      assessment: { mode: "reteach_gate" },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
  });

  it("still accepts assessment.mode='reteach_gate' when metadata.delivery is absent (defaults to chat, matching resolveDelivery's runtime fallback)", () => {
    const pkg = makeBasePackage(); // no metadata.delivery at all
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-tb", order: 2, blockType: "teach_back",
      prompt: "Explain this", evaluatesConcepts: [], dimensionKey: "comprehension",
      assessment: { mode: "reteach_gate" },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
  });

  it("does not gate web_quiz on a player-surface course — only reteach_gate has the write-path gap", () => {
    const pkg = makeBasePackage({
      metadata: {
        packageId: "test-pkg", title: "Test Package", languages: ["en"], version: "1.0.0",
        delivery: { surface: "player", supportedChannels: ["web"] },
      },
    });
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-quiz", order: 2, blockType: "quiz_checkpoint",
      questions: quizQuestions,
      assessment: { mode: "web_quiz" },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
  });
});

describe("block-level assessment override — additive, append-only-safe", () => {
  it("a block with no assessment key parses exactly as before (regression guard)", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2-quiz", order: 2, blockType: "quiz_checkpoint",
      questions: quizQuestions,
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.curriculum.lessons[0].blocks.find((b) => b.id === "b2-quiz");
      expect(block?.assessment).toBeUndefined();
    }
  });

  it("a package with no config.assessment and no block-level assessment still parses (MI/PBJ shape)", () => {
    const pkg = makeBasePackage({
      config: { trackedDimensions: [], alertRules: [] },
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
  });
});
