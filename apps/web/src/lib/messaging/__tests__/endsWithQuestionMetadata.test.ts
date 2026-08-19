import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `endsWithQuestion` on the persisted assistant message
 * ═══════════════════════════════════════════════════════════════════════════
 * The player's completion service reads this field off message metadata to
 * decide whether a completed block should pause for review. `endsWithQuestion` itself — the
 * heuristic — is unit-tested directly in `player/__tests__/responseStyle.test.ts`.
 * What this file pins is the wiring: that handler.ts actually computes and
 * persists it, against the final delivered text, only for player turns.
 *
 * Asserted against source, not a rendered call: `handleIncomingMessage` pulls
 * in the full player write path — playerRuntimeRepo, alerts, LTI grade
 * queueing, milestone snapshots — and building a faithful mock of all of it to
 * exercise one boolean field would cost far more than it pins. Same tradeoff
 * `singleTutorInput.test.ts` makes for LessonPlayer.tsx, for the same reason.
 */
const source = readFileSync(resolve(process.cwd(), "src/lib/messaging/handler.ts"), "utf8");

describe("assistant message metadata carries endsWithQuestion", () => {
  it("imports the shared heuristic rather than re-deriving one", () => {
    expect(source).toMatch(/import \{ endsWithQuestion \} from '@\/lib\/player\/responseStyle';/);
  });

  it("computes it against the final responseText, inside the player-only metadata branch", () => {
    expect(source).toMatch(
      /\{ metadata: \{ \.\.\.playerContext, generationStatus: aiResponse\.isError \? 'fallback' : 'success', endsWithQuestion: !aiResponse\.isError && endsWithQuestion\(responseText\) \} \}/,
    );
  });

  it("is false on a failed generation rather than judging fallback text", () => {
    // `!aiResponse.isError &&` short-circuits before the heuristic runs, so a
    // fallback reply can never gate a block on its own wording.
    const line = source.split("\n").find((l) => l.includes("endsWithQuestion: !aiResponse.isError"));
    expect(line).toBeDefined();
    expect(line!.indexOf("!aiResponse.isError")).toBeLessThan(line!.indexOf("endsWithQuestion(responseText)"));
  });

  it("never reaches MI or PB&J messages: the metadata branch is player-scoped", () => {
    const metadataBlock = source.slice(source.indexOf("const assistantMessage = await repo.addMessage("), source.indexOf("Sentiment + context extraction"));
    // Same three-way branch as before this change: player, then
    // systemInitiated, then plain. endsWithQuestion lives only in the first arm.
    expect(metadataBlock).toMatch(/\.\.\.\(playerContext\s*\n\s*\? \{ metadata: \{ [\s\S]*endsWithQuestion[\s\S]*?\}\s*\n\s*: systemInitiated/);
  });
});
