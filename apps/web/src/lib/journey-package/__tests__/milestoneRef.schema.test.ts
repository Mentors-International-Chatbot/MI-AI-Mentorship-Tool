/**
 * C.1 — block-level `milestoneRef` on `teach` blocks.
 * ----------------------------------------------------------------------------
 * The investigation (reports/phase-c-investigation.md) found the write path
 * for player-surface milestones didn't exist at all. This schema is the
 * authoring half of the fix: an author links a `teach` block to a milestone,
 * with a required, verbatim `interleavePrompt` — never a generated string.
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

describe("teach block milestoneRef", () => {
  it("accepts milestoneRef paired with interleavePrompt, referencing a real milestone", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2", order: 2, blockType: "teach", role: "explanation", content: "More content",
      milestoneRef: "milestone-1", interleavePrompt: "Go work on your project now.",
    });
    pkg.outcome = {
      project: { title: "Final project", deliverables: [] },
      milestones: [{ key: "milestone-1", name: "First milestone", availability: { type: "immediate" } }],
      mentorResources: [],
    };

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
  });

  it("rejects milestoneRef without interleavePrompt", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2", order: 2, blockType: "teach", role: "explanation", content: "More content",
      milestoneRef: "milestone-1",
    });
    pkg.outcome = {
      project: { title: "Final project", deliverables: [] },
      milestones: [{ key: "milestone-1", name: "First milestone", availability: { type: "immediate" } }],
      mentorResources: [],
    };

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
  });

  it("rejects interleavePrompt without milestoneRef", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2", order: 2, blockType: "teach", role: "explanation", content: "More content",
      interleavePrompt: "Go work on your project now.",
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
  });

  it("rejects a milestoneRef that names no declared milestone", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2", order: 2, blockType: "teach", role: "explanation", content: "More content",
      milestoneRef: "milestone-ghost", interleavePrompt: "Go work on your project now.",
    });
    pkg.outcome = {
      project: { title: "Final project", deliverables: [] },
      milestones: [{ key: "milestone-1", name: "First milestone", availability: { type: "immediate" } }],
      mentorResources: [],
    };

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('milestoneRef "milestone-ghost" not found'))).toBe(true);
    }
  });

  it("rejects a milestoneRef when the package declares no outcome at all", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "b2", order: 2, blockType: "teach", role: "explanation", content: "More content",
      milestoneRef: "milestone-1", interleavePrompt: "Go work on your project now.",
    });

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("declares no outcome.milestones at all"))).toBe(true);
    }
  });
});
