import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchIdentityCandidates, validateGenerationManifest, type CandidateBlock, type GenerationManifest, type IdentityEntry, type IdentityMap } from "./convert-learnmachine-package";

function entry(overrides: Partial<IdentityEntry> = {}): IdentityEntry {
  return {
    stableId: "aiess-l01-b001", lessonKey: "lesson", blockType: "prose",
    discriminator: "lesson:prose:concept", contentHash: "old-hash",
    fingerprint: "alpha beta gamma delta", sourceOrdinal: "1", retired: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateBlock> = {}): CandidateBlock {
  return {
    lessonKey: "lesson", lessonIndex: 0, sourceOrdinal: "2", blockType: "prose",
    discriminator: "lesson:prose:concept", hash: "new-hash",
    fingerprint: "alpha beta gamma changed", source: { type: "prose", concepts: ["concept"], md: "changed" },
    ...overrides,
  };
}

describe("converter stable block identity", () => {
  it("reactivates retired exact matches and excludes source order from identity", () => {
    const map: IdentityMap = { version: 1, nextSequence: 2, entries: [entry({ contentHash: "same", retired: true, sourceOrdinal: "99" })] };
    const result = matchIdentityCandidates([candidate({ hash: "same", sourceOrdinal: "3" })], map, { reuse: new Map(), mint: new Set() });
    expect(result.matches[0].stableId).toBe("aiess-l01-b001");
    expect(map.entries[0]).toEqual(expect.objectContaining({ retired: false, sourceOrdinal: "3" }));
  });

  it("reuses one qualifying drift candidate and retires missing identities", () => {
    const map: IdentityMap = { version: 1, nextSequence: 3, entries: [entry(), entry({ stableId: "aiess-l01-b002", discriminator: "other", contentHash: "other" })] };
    const result = matchIdentityCandidates([candidate()], map, { reuse: new Map(), mint: new Set() });
    expect(result.drift).toHaveLength(1);
    expect(result.matches[0].stableId).toBe("aiess-l01-b001");
    expect(map.entries.find((item) => item.stableId === "aiess-l01-b002")?.retired).toBe(true);
  });

  it("stops without mutating the map when similarity is ambiguous", () => {
    const entries = [entry(), entry({ stableId: "aiess-l01-b002", contentHash: "second", fingerprint: "alpha beta gamma another" })];
    const map: IdentityMap = { version: 1, nextSequence: 3, entries };
    const before = JSON.stringify(map);
    const result = matchIdentityCandidates([candidate()], map, { reuse: new Map(), mint: new Set() });
    expect(result.review).toEqual([expect.objectContaining({ reason: "ambiguous_similarity" })]);
    expect(JSON.stringify(map)).toBe(before);
  });

  it("honors explicit mint decisions and assigns a monotonic package-wide id", () => {
    const map: IdentityMap = { version: 1, nextSequence: 8, entries: [entry()] };
    const result = matchIdentityCandidates([candidate()], map, { reuse: new Map(), mint: new Set(["lesson:2"]) });
    expect(result.matches[0].stableId).toBe("aiess-l01-b008");
    expect(map.nextSequence).toBe(9);
  });

  it("retains the same stable id when a lesson moves to a new manifest position", () => {
    const map: IdentityMap = { version: 1, nextSequence: 2, entries: [entry({ contentHash: "same" })] };
    const result = matchIdentityCandidates([candidate({ lessonIndex: 9, hash: "same" })], map, { reuse: new Map(), mint: new Set() });
    expect(result.matches[0].stableId).toBe("aiess-l01-b001");
  });
});

describe("generation manifest gates", () => {
  const manifest: GenerationManifest = {
    schemaVersion: "1.2", contentVersion: "2.0.0", lessonKeys: ["a"], expectedLessonCount: 1,
    milestones: [], authoredInputsApproved: true,
  };

  it("rejects duplicates and count drift", () => {
    expect(() => validateGenerationManifest({ ...manifest, lessonKeys: ["a", "a"], expectedLessonCount: 2 })).toThrow(/duplicate/);
    expect(() => validateGenerationManifest({ ...manifest, expectedLessonCount: 2 })).toThrow(/expected 2/);
  });

  it("refuses phase 2 generation before authored inputs are approved", () => {
    expect(() => validateGenerationManifest({ ...manifest, authoredInputsApproved: false, requiredAuthoredInputs: ["milestones", "diagnostic"] })).toThrow(/milestones, diagnostic/);
  });

  it("validates declared dimension reachability and diagnostic mappings", () => {
    const dimensionManifest: GenerationManifest = {
      ...manifest,
      dimensions: [{ key: "working_with_ai", label: "Working with AI", concepts: ["prompting"], topics: ["iteration"], lessonKeys: ["a"] }],
      diagnosticDimensionMap: { prompting: "working_with_ai" },
    };
    expect(() => validateGenerationManifest(dimensionManifest)).not.toThrow();
    expect(() => validateGenerationManifest({ ...dimensionManifest, dimensions: [{ ...dimensionManifest.dimensions![0], lessonKeys: [] }] })).toThrow(/no teach-back lesson source/);
    expect(() => validateGenerationManifest({ ...dimensionManifest, dimensions: [{ ...dimensionManifest.dimensions![0], lessonKeys: ["missing"] }] })).toThrow(/outside the manifest/);
    expect(() => validateGenerationManifest({ ...dimensionManifest, diagnosticDimensionMap: { prompting: "unknown" } })).toThrow(/undeclared dimensions/);
  });

  it("accepts one lesson as a source for more than one dimension", () => {
    const sharedLesson: GenerationManifest = {
      ...manifest,
      dimensions: [
        { key: "model_choice", label: "Model choice", concepts: ["model_selection"], topics: ["tool shapes"], lessonKeys: ["a"] },
        { key: "tools_and_safety", label: "Tools and safety", concepts: ["ai_systems"], topics: ["tool shapes"], lessonKeys: ["a"] },
      ],
      diagnosticDimensionMap: { model_selection: "model_choice", ai_systems: "tools_and_safety" },
    };
    expect(() => validateGenerationManifest(sharedLesson)).not.toThrow();
  });

  it("accepts the authored v2 bank with two items for every declared dimension", () => {
    const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const v2 = JSON.parse(readFileSync(resolve(root, "content/ai-essentials-v2-manifest.json"), "utf8")) as GenerationManifest;
    expect(v2.diagnostic?.items).toHaveLength(10);
    expect(v2.milestones).toHaveLength(5);
    expect(() => validateGenerationManifest({ ...v2, authoredInputsApproved: true })).not.toThrow();
  });

  it("rejects authored diagnostic items outside declared dimensions", () => {
    const dimensionManifest: GenerationManifest = {
      ...manifest,
      dimensions: [{ key: "working_with_ai", label: "Working with AI", concepts: ["prompting"], topics: ["iteration"], lessonKeys: ["a"] }],
      diagnostic: {
        id: "diagnostic", title: "Diagnostic", threshold: 0.75,
        items: [
          { dimensionKey: "working_with_ai", prompt: "One", options: ["A", "B"], correct: 0 },
          { dimensionKey: "unknown", prompt: "Two", options: ["A", "B"], correct: 1 },
        ],
      },
    };
    expect(() => validateGenerationManifest(dimensionManifest)).toThrow(/undeclared dimensions: unknown/);
  });

  it("requires two authored diagnostic items per declared dimension", () => {
    const dimensionManifest: GenerationManifest = {
      ...manifest,
      dimensions: [{ key: "working_with_ai", label: "Working with AI", concepts: ["prompting"], topics: ["iteration"], lessonKeys: ["a"] }],
      diagnostic: {
        id: "diagnostic", title: "Diagnostic", threshold: 0.75,
        items: [{ dimensionKey: "working_with_ai", prompt: "One", options: ["A", "B"], correct: 0 }],
      },
    };
    expect(() => validateGenerationManifest(dimensionManifest)).toThrow(/at least two diagnostic items: working_with_ai \(1\)/);
  });
});
