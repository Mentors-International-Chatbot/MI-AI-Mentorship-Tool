/**
 * The `helpRequest` config key: schema, defaults, and who has it enabled.
 *
 * The manifest assertion is the one that matters operationally — the button
 * only reaches AI Essentials learners if this key survives into
 * `ProgramVersion.config` at import, and the manifest is where it starts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { helpRequestSchema, configSchema } from "../journey-package.schema";
import { programVersionConfigSchema } from "../program-version-config.schema";

describe("helpRequestSchema", () => {
  it("defaults the message cap so an author only has to write `enabled`", () => {
    expect(helpRequestSchema.parse({ enabled: true })).toEqual({
      enabled: true,
      maxMessageLength: 1_000,
    });
  });

  it("requires `enabled` to be stated explicitly", () => {
    expect(() => helpRequestSchema.parse({})).toThrow();
  });

  it("rejects an unbounded message cap", () => {
    expect(() => helpRequestSchema.parse({ enabled: true, maxMessageLength: 100_000 })).toThrow();
    expect(() => helpRequestSchema.parse({ enabled: true, maxMessageLength: 0 })).toThrow();
  });
});

describe("config schemas treat it as opt-in", () => {
  it("leaves helpRequest undefined when a package omits it", () => {
    const parsed = configSchema.parse({});
    expect(parsed.helpRequest).toBeUndefined();
  });

  it("leaves it undefined on a ProgramVersion config that omits it", () => {
    const parsed = programVersionConfigSchema.parse({});
    expect(parsed.helpRequest).toBeUndefined();
  });

  it("carries it through the ProgramVersion config when present", () => {
    const parsed = programVersionConfigSchema.parse({ helpRequest: { enabled: true } });
    expect(parsed.helpRequest).toEqual({ enabled: true, maxMessageLength: 1_000 });
  });
});

describe("who has it enabled", () => {
  const read = (name: string) =>
    JSON.parse(readFileSync(resolve(process.cwd(), "../../content", name), "utf8"));

  it("AI Essentials enables it in its v2 manifest", () => {
    const manifest = read("ai-essentials-v2-manifest.json");
    expect(manifest.helpRequest).toEqual({ enabled: true, maxMessageLength: 1000 });
  });

  it("the PB&J example package leaves it off", async () => {
    const { pbjPackage } = await import("../examples/pbj-journey-package");
    expect(pbjPackage.config).not.toHaveProperty("helpRequest");
    expect(configSchema.parse(pbjPackage.config).helpRequest).toBeUndefined();
  });
});
