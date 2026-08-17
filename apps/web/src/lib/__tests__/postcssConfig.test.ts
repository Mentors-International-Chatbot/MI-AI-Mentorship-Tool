import { describe, expect, it } from "vitest";
import postcssConfig from "../../../postcss.config.mjs";

/**
 * Turbopack runs the PostCSS config against every CSS file it compiles. When
 * `@tailwindcss/postcss` was listed unconditionally it replaced
 * `src/components/player/player.css` with Tailwind's generated output in dev:
 * the emitted chunk kept the player.css name, contained none of its rules, and
 * every player surface rendered unstyled while production looked fine.
 *
 * These pin the scoping, not the plugin's behaviour.
 */
describe("postcss config scoping", () => {
  const pluginsFor = (file: string) => Object.keys(postcssConfig({ file }).plugins);

  it("runs Tailwind on the globals entry", () => {
    expect(pluginsFor("/repo/apps/web/src/app/globals.css")).toEqual(["@tailwindcss/postcss"]);
  });

  it("leaves hand-written stylesheets alone", () => {
    expect(pluginsFor("/repo/apps/web/src/components/player/player.css")).toEqual([]);
  });

  it("handles Windows-style separators", () => {
    expect(pluginsFor("C:\\repo\\apps\\web\\src\\app\\globals.css")).toEqual(["@tailwindcss/postcss"]);
  });

  it("falls back to running Tailwind when the caller gives no file", () => {
    // Better to over-apply than to silently ship a build with no Tailwind at
    // all if some caller omits the context.
    expect(pluginsFor("")).toEqual(["@tailwindcss/postcss"]);
    expect(Object.keys(postcssConfig({}).plugins)).toEqual(["@tailwindcss/postcss"]);
  });
});
