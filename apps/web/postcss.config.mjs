/**
 * Tailwind is only ever the entry point for `src/app/globals.css`. Every other
 * stylesheet in the app is hand-written plain CSS.
 *
 * Turbopack runs this config against *every* CSS file it compiles. Left
 * unscoped, `@tailwindcss/postcss` replaced `src/components/player/player.css`
 * with Tailwind's generated output in dev — the emitted chunk kept the
 * player.css name but contained none of its rules, so every player surface
 * rendered unstyled while the production build (which did not hit the same
 * path) looked correct.
 *
 * Scoping by file keeps the plugin on the one stylesheet that actually opens
 * with `@import "tailwindcss"` and leaves the rest untouched.
 */
const TAILWIND_ENTRY = "src/app/globals.css";

const config = (ctx) => {
  const file = (ctx?.file ?? ctx?.from ?? "").replaceAll("\\", "/");
  const isTailwindEntry = file === "" || file.endsWith(TAILWIND_ENTRY);
  return { plugins: isTailwindEntry ? { "@tailwindcss/postcss": {} } : {} };
};

export default config;
