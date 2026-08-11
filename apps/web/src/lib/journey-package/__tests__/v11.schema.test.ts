import { describe, expect, it } from "vitest";
import { journeyPackageSchema } from "../journey-package.schema";
import { resolveDelivery } from "../delivery";

function base(schemaVersion: "1.0" | "1.1" | "1.2" = "1.1") {
  return {
    schemaVersion,
    metadata: { packageId: "test", title: "Test", languages: ["en"], version: "1" },
    config: { trackedDimensions: [{ key: "ai_impact", label: "AI impact", category: "comprehension", calibrationMode: "zero_start" }], alertRules: [] },
    curriculum: { collectionKey: "test", lessons: [{ key: "lesson", title: "Lesson", blocks: [{ id: "teach", order: 1, blockType: "teach", role: "explanation", content: "Hello" }] }] },
  };
}

describe("journey package v1.1", () => {
  it("keeps v1.0 valid and normalizes canonical block defaults", () => {
    const result = journeyPackageSchema.parse(base("1.0"));
    const block = result.curriculum.lessons[0].blocks[0];
    expect(block.concepts).toEqual([]);
    expect(block.contentVersion).toBe(1);
    expect(block.blockType === "teach" && block.presentation).toBe("narrated");
  });

  it("rejects normalized duplicate options and a non-raw answer key", () => {
    const pkg = base();
    pkg.curriculum.lessons[0].blocks.push({
      id: "quiz", order: 2, blockType: "quiz_checkpoint",
      questions: [{ id: "q", prompt: "Pick", format: "multiple_choice", options: ["ＡＩ tool", "AI   TOOL"], answerKey: "ai tool", explanation: "Why", dimensionKey: "ai_impact" }],
    } as never);
    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((item) => item.message).join(" ")).toMatch(/unique.*normalization|answerKey/);
  });

  it("requires drag order to be a full duplicate-free permutation", () => {
    const pkg = base();
    pkg.curriculum.lessons[0].blocks.push({ id: "drag", order: 2, blockType: "drag_order", prompt: "Order", items: ["a", "b", "c"], correctOrder: [0, 0, 2] } as never);
    expect(journeyPackageSchema.safeParse(pkg).success).toBe(false);
  });

  it("validates diagnostic dimension cross-references", () => {
    const pkg = base();
    Object.assign(pkg.config, { onboarding: { mode: "baseline_quiz", steps: [], diagnostic: { id: "baseline", title: "Baseline", threshold: 0.75, questions: [{ id: "q", prompt: "Pick", format: "multiple_choice", options: ["a", "b"], answerKey: "a", explanation: "Because", dimensionKey: "missing" }] } } });
    expect(journeyPackageSchema.safeParse(pkg).success).toBe(false);
  });

  it("resolves legacy and explicit player delivery through one resolver", () => {
    expect(resolveDelivery(undefined)).toEqual({ surface: "chat", supportedChannels: ["web", "whatsapp"] });
    expect(resolveDelivery({ delivery: { surface: "player", supportedChannels: ["web", "canvas"] } })).toEqual({ surface: "player", supportedChannels: ["web", "canvas"] });
  });
});

describe("journey package v1.2", () => {
  it("validates response limits and expanded ceilings", () => {
    const pkg = base("1.2");
    Object.assign(pkg.config, { responseStyle: { maxSentences: 3, maxOutputTokens: 240, markdown: "none", maxQuestions: 1, expanded: { maxSentences: 2, maxOutputTokens: 200 } } });
    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message).join(" ")).toContain("cannot be lower");
  });

  it("accepts legacy afterLessonKey in v1.1 and requires availability in v1.2", () => {
    const legacy = base("1.1");
    Object.assign(legacy, { outcome: { project: { title: "Project", deliverables: [] }, milestones: [{ key: "m1", name: "One", afterLessonKey: "lesson" }], mentorResources: [] } });
    expect(journeyPackageSchema.safeParse(legacy).success).toBe(true);
    const current = { ...legacy, schemaVersion: "1.2" };
    expect(journeyPackageSchema.safeParse(current).success).toBe(false);
  });

  it("accepts a sequential chain and rejects forward/self references", () => {
    const pkg = base("1.2");
    Object.assign(pkg, { outcome: { project: { title: "Project", deliverables: [] }, milestones: [
      { key: "m1", name: "One", availability: { type: "immediate" } },
      { key: "m2", name: "Two", availability: { type: "after_milestone", milestoneKey: "m1" } },
    ], mentorResources: [] } });
    expect(journeyPackageSchema.safeParse(pkg).success).toBe(true);
    ((pkg as unknown as { outcome: { milestones: Array<{ availability: { milestoneKey?: string } }> } }).outcome).milestones[1].availability.milestoneKey = "m2";
    expect(journeyPackageSchema.safeParse(pkg).success).toBe(false);
  });
});
