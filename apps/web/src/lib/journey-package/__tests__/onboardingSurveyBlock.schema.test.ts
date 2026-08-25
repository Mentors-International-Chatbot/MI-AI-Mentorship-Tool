import { describe, expect, it } from "vitest";
import { journeyPackageSchema, lessonBlockSchema, SCHEMA_VERSION, type JourneyPackageInput } from "../journey-package.schema";

const STEPS_FIXTURE = [
  { id: "name", prompt: "What's your name?", field: "name" },
  { id: "major", prompt: "What's your major?", field: "major" },
  { id: "tedious", prompt: "What's one tedious task?", field: "tediousTask" },
];

function block(overrides: Record<string, unknown> = {}) {
  return {
    id: "onboarding", order: 1, blockType: "onboarding_survey",
    steps: STEPS_FIXTURE,
    ...overrides,
  };
}

function makeBasePackage(overrides?: Partial<JourneyPackageInput>): JourneyPackageInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: { packageId: "test-pkg", title: "Test Package", languages: ["en"], version: "1.0.0" },
    config: { trackedDimensions: [], alertRules: [] },
    curriculum: {
      collectionKey: "test-collection",
      lessons: [{
        key: "l1", title: "Lesson 1", keyConcepts: [], selfCheckQuestions: [],
        blocks: [{ id: "teach1", order: 1, blockType: "teach", role: "explanation", content: "Some content" }],
      }],
    },
    ...overrides,
  };
}

describe("onboarding_survey block schema", () => {
  it("accepts a block with 3 steps", () => {
    const result = lessonBlockSchema.safeParse(block());
    expect(result.success).toBe(true);
    if (result.success && result.data.blockType === "onboarding_survey") {
      expect(result.data.steps).toHaveLength(3);
    }
  });

  it("accepts a closingMessage with a {step:<id>} token — token resolution isn't a schema concern, just a normal localized string", () => {
    const result = lessonBlockSchema.safeParse(block({ closingMessage: { en: "You said: {step:tedious}. That's the process your project will automate." } }));
    expect(result.success).toBe(true);
    if (result.success && result.data.blockType === "onboarding_survey") {
      expect(result.data.closingMessage?.en).toContain("{step:tedious}");
    }
  });

  it("inherits handoff and assessment slots from blockBase", () => {
    const result = lessonBlockSchema.safeParse(block({ handoff: "Now let's get started." }));
    expect(result.success).toBe(true);
    if (result.success && result.data.blockType === "onboarding_survey") {
      expect(result.data.handoff).toBe("Now let's get started.");
    }
  });

  it("rejects duplicate step ids at the package level", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "onboarding", order: 2, blockType: "onboarding_survey" as const,
      steps: [
        { id: "name", prompt: "What's your name?", field: "name" },
        { id: "name", prompt: "What's your major?", field: "major" },
      ],
    });
    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("duplicate step ids"))).toBe(true);
    }
  });

  it("rejects duplicate step fields at the package level — a collision would silently overwrite one step's stored answer", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({
      id: "onboarding", order: 2, blockType: "onboarding_survey" as const,
      steps: [
        { id: "name", prompt: "What's your name?", field: "sameField" },
        { id: "major", prompt: "What's your major?", field: "sameField" },
      ],
    });
    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("duplicate step fields"))).toBe(true);
    }
  });

  it("a package with unique step ids and fields parses cleanly (regression guard)", () => {
    const pkg = makeBasePackage();
    pkg.curriculum.lessons[0].blocks.push({ id: "onboarding", order: 2, blockType: "onboarding_survey" as const, steps: STEPS_FIXTURE });
    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
  });
});
