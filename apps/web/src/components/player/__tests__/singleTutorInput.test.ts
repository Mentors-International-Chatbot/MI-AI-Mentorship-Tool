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

/**
 * Pending state on tutor turns
 * ═══════════════════════════════════════════════════════════════════════════
 * Tutor turns run 3.5-5.2s. Before this, `busy` only greyed buttons, which is
 * invisible if the learner's eye is in the thread — the page read as frozen.
 */
describe("tutor turns show a pending indicator", () => {
  it("tracks tutor pending separately from block-completion busy", () => {
    // `busy` also covers completeBlock, which returns in well under a second
    // and needs no indicator.
    expect(source).toMatch(/const \[pending, setPending\] = useState<\{ learnerText\?: string \} \| null>\(null\)/);
  });

  it("sets and clears pending on both functions that reach the tutor", () => {
    // askTutor covers the input, both chips and teach-back submit; explainMore
    // is the second entry point.
    expect(source.match(/setPending\(\{/g) ?? []).toHaveLength(2);
    // Cleared in `finally`, so an error cannot leave it spinning forever.
    expect(source.match(/finally \{ setBusy\(false\); setPending\(null\); \}/g) ?? []).toHaveLength(2);
  });

  it("renders the indicator inside the thread, not at the top of the page", () => {
    const thread = source.slice(source.indexOf('className="player-thread"'), source.indexOf("player-current"));
    expect(thread).toMatch(/player-thinking/);
    expect(thread).toMatch(/aria-live="polite"/);
  });

  it("says something on failure instead of hanging", () => {
    expect(source).toMatch(/tutorError && <div className="player-message is-error" role="alert">/);
    // The learner's text goes back in the box so a failed turn costs nothing.
    expect(source).toMatch(/setQuestion\(content\);/);
  });

  it("disables the input while a turn is in flight", () => {
    expect(source).toMatch(/rows=\{3\} disabled=\{busy\}/);
  });
});

/**
 * Advancing never discards typed text
 * ═══════════════════════════════════════════════════════════════════════════
 * "Advance the lesson" and "send to the mentor" were separate controls in
 * separate places. Block 1's copy invites the learner to introduce themselves;
 * pressing Next on the card above sent nothing and threw the text away.
 */
describe("block advance sends before completing", () => {
  it("routes every primary control through advance(), not complete()", () => {
    expect(source).toMatch(/onClick=\{\(\) => advance\(\{ acknowledged: true \}\)\}/);
    expect(source).toMatch(/onClick=\{\(\) => advance\(answers\)\}/);
    expect(source).toMatch(/onClick=\{\(\) => advance\(order\)\}/);
  });

  it("sends first, awaits, then completes", () => {
    const fn = source.slice(source.indexOf("async function advance("), source.indexOf("function advanceReviewedBlock"));
    expect(fn).toMatch(/const sent = await askTutor\(\);/);
    expect(fn).toMatch(/await complete\(response\);/);
    expect(fn.indexOf("askTutor")).toBeLessThan(fn.indexOf("await complete"));
  });

  it("aborts the advance when the send fails, rather than discarding by another door", () => {
    const fn = source.slice(source.indexOf("async function advance("), source.indexOf("function advanceReviewedBlock"));
    expect(fn).toMatch(/if \(!sent\) return;/);
  });

  it("only sends when something was actually typed", () => {
    const fn = source.slice(source.indexOf("async function advance("), source.indexOf("function advanceReviewedBlock"));
    expect(fn).toMatch(/if \(question\.trim\(\)\)/);
  });

  it("labels the control so the invitation is not contradicted", () => {
    expect(source).toMatch(/function primaryLabel\(block: Teach, typed: string\): string/);
    expect(source).toMatch(/return "Send and continue";/);
    expect(source).toMatch(/block\.expectsResponse \? "Skip for now" : "Next"/);
  });
});

/**
 * Teach-back waits for the learner
 * ═══════════════════════════════════════════════════════════════════════════
 * Turn 2 used to complete the block the instant it returned, burying the
 * mentor's closing feedback under the next block — and when that feedback ended
 * in a question, it read as the mentor abandoning its own question.
 *
 * The server still records turn 2 as complete; this is presentation only.
 */
describe("teach-back turn 2 does not auto-advance", () => {
  it("routes turn 2 into the review state, not straight to completed", () => {
    // `submittedComplete` is the same "recorded, still on screen, waiting for
    // Continue" state quiz blocks use.
    expect(source).toMatch(/if \(teachBackTurn === 2\) setSubmittedComplete\(\(value\) => new Set\(value\)\.add\(current\.id\)\);/);
    expect(source).not.toMatch(/if \(teachBackTurn === 2\) setCompleted\(/);
  });

  it("shows the same Continue control every reviewed block uses", () => {
    expect(source).toMatch(/\{submittedComplete\.has\(current\.id\) && <button onClick=\{advanceReviewedBlock\}>Continue<\/button>\}/);
  });

  it("tells the learner they may keep talking once the exchange is done", () => {
    expect(source).toMatch(/Keep talking with AI Mentor if you want to, or continue when you are ready\./);
  });
});
