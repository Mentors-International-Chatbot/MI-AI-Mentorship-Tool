import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { journeyPackageSchema } from "../journey-package.schema";

const expectedOrder = [
  "ai-day-in-the-life", "ai-magic-examples", "ai-revolution-vs-past", "ai-prospering-gameplan",
  "ai-ceo-explain-models", "ai-expert-vs-ml", "ai-pattern-vs-truth", "ai-train-infer-failures",
  "ai-prompting-iteration", "ai-reasoning-context-tools", "ai-harness-control", "ai-model-landscape",
  "ai-cost-context-windows", "ai-specialize-and-route", "ai-tool-shapes", "ai-build-vs-buy", "ai-safety-deploy",
];

describe("generated AI Essentials cartridge", () => {
  const packagePath = resolve(process.cwd(), "../../content/ai-essentials.package.json");
  const mapPath = resolve(process.cwd(), "../../content/block-ids.json");
  const pkg = journeyPackageSchema.parse(JSON.parse(readFileSync(packagePath, "utf8")));

  it("has the fixed 17-lesson order and exact source/generated counts", () => {
    expect(pkg.schemaVersion).toBe("1.2");
    expect(pkg.metadata.version).toBe("1.1.1");
    expect(pkg.curriculum.lessons.map((lesson) => lesson.key)).toEqual(expectedOrder);
    const counts = pkg.curriculum.lessons.flatMap((lesson) => lesson.blocks).reduce<Record<string, number>>((acc, block) => ({ ...acc, [block.blockType]: (acc[block.blockType] ?? 0) + 1 }), {});
    expect(counts).toEqual({ teach: 40, teach_back: 17, drag_order: 17, quiz_checkpoint: 38 });
  });

  it("places each generated teach-back after opening prose and before interaction", () => {
    for (const lesson of pkg.curriculum.lessons) {
      const teachBack = lesson.blocks.findIndex((block) => block.blockType === "teach_back");
      const firstInteractive = lesson.blocks.findIndex((block) => block.blockType === "quiz_checkpoint" || block.blockType === "drag_order");
      expect(teachBack).toBeGreaterThan(0);
      expect(teachBack).toBeLessThan(firstInteractive);
      expect(lesson.blocks.slice(0, teachBack).every((block) => block.blockType === "teach")).toBe(true);
    }
  });

  it("contains seven diagnostic questions, eleven dimensions, and player delivery", () => {
    expect(pkg.config.onboarding?.diagnostic?.questions).toHaveLength(7);
    expect(pkg.config.trackedDimensions).toHaveLength(11);
    expect(pkg.metadata.delivery).toEqual({ surface: "player", supportedChannels: ["web", "canvas"] });
    expect(pkg.config.responseStyle).toEqual({ maxSentences: 3, maxOutputTokens: 240, markdown: "none", maxQuestions: 1, expanded: { maxSentences: 6, maxOutputTokens: 480 } });
  });

  it("keeps stable identity fingerprints and retirement state in the separate map", () => {
    const map = JSON.parse(readFileSync(mapPath, "utf8")) as { entries: Array<Record<string, unknown>> };
    expect(map.entries).toHaveLength(112);
    for (const entry of map.entries) expect(entry).toEqual(expect.objectContaining({ stableId: expect.any(String), contentHash: expect.any(String), fingerprint: expect.any(String), sourceOrdinal: expect.any(String), discriminator: expect.any(String), retired: false }));
  });
});
