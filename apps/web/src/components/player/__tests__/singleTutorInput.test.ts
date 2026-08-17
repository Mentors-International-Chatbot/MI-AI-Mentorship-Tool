import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One text input on the lesson player
 * ═══════════════════════════════════════════════════════════════════════════
 * The player used to show two: the `teach_back` block's own textarea with a
 * "Share with AI Mentor" button, and the docked "Ask AI Mentor" box below it.
 * Both posted to `/api/chat` and differed only by `intent`. Two chat boxes on
 * one screen is the complaint the redesign exists to remove, so this pins the
 * shape rather than the styling.
 *
 * Asserted against source, not a rendered tree: the app has no component test
 * environment (vitest runs in `node`, and there are no .tsx tests), and adding
 * one to guard a structural rule would cost more than it pins. The same
 * source-reading approach the anchoring-coverage test uses.
 */
const source = readFileSync(
  resolve(process.cwd(), "src/components/player/LessonPlayer.tsx"),
  "utf8",
);

describe("lesson player has a single tutor input", () => {
  it("renders exactly one textarea", () => {
    expect(source.match(/<textarea/g) ?? []).toHaveLength(1);
  });

  it("has no separate teach-back sender", () => {
    expect(source).not.toMatch(/sendTeachBack/);
  });

  it("derives the tutor intent from the current block instead of the widget", () => {
    expect(source).toMatch(/const teachingBack = current\?\.blockType === "teach_back"/);
    expect(source).toMatch(/teachingBack \? "teach_back" as const : "question" as const/);
  });

  it("sends the block id on every tutor turn, so the server can count teach-back turns", () => {
    // preparePlayerContext validates the intent/block pairing and computes
    // teachBackTurn itself; the client must not be the source of either.
    expect(source).toMatch(/body: JSON\.stringify\(\{ message: content, context: \{ surface: "player", courseCode: course, lessonKey, blockId, intent \} \}\)/);
  });

  it("derives the teach-back prompt into the thread verbatim, never through a model turn", () => {
    // The prompt is authored block text. Routing it through /api/chat would
    // return a paraphrase of it. Phase 3 replaced the client-side push with
    // derivation from the block body, which is verbatim by construction and
    // survives a refresh; the guarantee under test is unchanged.
    expect(source).toMatch(/content: \(block as TeachBack\)\.prompt/);
    const derivation = source.slice(source.indexOf("const threadItems"), source.indexOf("function onDragEnd"));
    expect(derivation).not.toMatch(/api\/chat/);
  });

  it("renders finished block content from the lesson body, not from stored messages", () => {
    // historyContent returns authored strings only — no generated summary of a
    // block the learner already read.
    expect(source).toMatch(/function historyContent\(block: Block\): string \| null/);
    const helper = source.slice(source.indexOf("function historyContent"), source.indexOf("export function LessonPlayer"));
    expect(helper).not.toMatch(/api\/chat/);
  });
});
