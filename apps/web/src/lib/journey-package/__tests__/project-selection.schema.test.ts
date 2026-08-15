import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pbjPackage } from "../examples/pbj-journey-package";
import { journeyPackageSchema, projectSelectionSchema } from "../journey-package.schema";
import { programVersionConfigSchema } from "../program-version-config.schema";

const v2Manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "../../content/ai-essentials-v2-manifest.json"), "utf8"),
) as { projectSelection: unknown };

describe("projectSelection package config", () => {
  it("validates all authored v2 presets and interests, including social-posts coverage", () => {
    const selection = projectSelectionSchema.parse(v2Manifest.projectSelection);
    expect(selection.presets).toHaveLength(12);
    expect(selection.interestTopics).toHaveLength(12);
    const socialAffinities = selection.interestTopics
      .filter((interest) => interest.presetAffinity.includes("social-posts"))
      .map((interest) => interest.key);
    expect(socialAffinities).toEqual(["stop-repeating-myself", "build-for-others"]);
  });

  it("rejects affinities to unknown presets and presets with less than two affinities", () => {
    const selection = projectSelectionSchema.parse(v2Manifest.projectSelection);
    const invalid = structuredClone(selection);
    invalid.interestTopics[0].presetAffinity = ["unknown-preset"];
    expect(projectSelectionSchema.safeParse(invalid).success).toBe(false);
  });

  it("keeps PB&J and stored configs without projectSelection valid", () => {
    const pbj = journeyPackageSchema.parse(pbjPackage);
    expect(pbj.config.projectSelection).toBeUndefined();
    expect(programVersionConfigSchema.safeParse({
      ...pbj.config,
      curriculumCollectionKey: pbj.curriculum.collectionKey,
      outcome: pbj.outcome,
    }).success).toBe(true);
  });
});
