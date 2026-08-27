import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Bug 3: a uniform, content-free signal that a new block became current —
 * independent of block type, so `teach`/`project`/`quiz_checkpoint`/
 * `drag_order`/`media`/`resource` (which have no prompt-mirror of their own)
 * get a visible seam too, not just teach_back/onboarding_survey. Suppressed
 * for exactly those two, whose own mirror already reads as "something new
 * arrived" — this pins that the two signals never stack.
 *
 * Asserted against source, not a rendered tree — same approach as the other
 * LessonPlayer.tsx structural tests (no component test environment here).
 */
const source = readFileSync(
  resolve(process.cwd(), "src/components/player/LessonPlayer.tsx"),
  "utf8",
);

describe("block transition marker", () => {
  it("renders for a current block regardless of type, except teach_back and onboarding_survey", () => {
    expect(source).toMatch(
      /if \(isCurrent && block\.blockType !== "teach_back" && block\.blockType !== "onboarding_survey"\) \{\s*\n\s*items\.push\(\{ kind: "divider", key: `\$\{block\.id\}-transition` \}\);/,
    );
  });

  it("is content-free: the divider variant carries no content field, only a key", () => {
    expect(source).toMatch(/\| \{ kind: "divider"; key: string \}/);
  });

  it("renders the divider as an empty, unlabeled element distinct from prompt/block bubbles", () => {
    expect(source).toMatch(/if \(item\.kind === "divider"\) return <div key=\{item\.key\} className="player-thread-divider" role="separator" \/>;/);
  });

  it("the divider check precedes the handoff/prompt-mirror pushes, so it always marks the seam before any block-specific content", () => {
    const dividerIndex = source.indexOf('items.push({ kind: "divider"');
    const handoffIndex = source.indexOf('items.push({ kind: "prompt", key: `${block.id}-handoff`');
    const teachBackMirrorIndex = source.indexOf('items.push({ kind: "prompt", key: `${block.id}-prompt`');
    expect(dividerIndex).toBeGreaterThan(-1);
    expect(dividerIndex).toBeLessThan(handoffIndex);
    expect(dividerIndex).toBeLessThan(teachBackMirrorIndex);
  });
});
