import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A paused turn is not an AI reply of nothing
 * ═══════════════════════════════════════════════════════════════════════════
 * When a mentor takes over, `handleIncomingMessage` returns `responseText: ""`
 * and writes no assistant row — the AI is meant to go silent. `CapstonePlayer`
 * used to push that empty string straight into an "AI Mentor" bubble, which
 * reads as the tutor answering with nothing at the exact moment a learner is
 * waiting to hear that a person is now handling it. This pins that an empty
 * reply no longer produces an "AI Mentor" bubble, and instead produces a
 * clearly-labeled note that does not claim the human's reply will land here
 * (it can't — this pane holds no persisted thread, so it must not promise a
 * delivery it cannot keep).
 *
 * Source-read, matching the rest of this test directory: no component test
 * environment exists for these .tsx files.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const source = readFileSync(
  resolve(process.cwd(), "src/components/player/CapstonePlayer.tsx"),
  "utf8",
);
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

it("comment stripping does not eat code", () => {
  expect(source).not.toMatch(/"[^"\n]*\/\//);
  expect(code).toMatch(/export function CapstonePlayer/);
});

describe("send()", () => {
  it("trims the response before deciding whether it is empty", () => {
    expect(code).toMatch(/const reply = result\.response\.trim\(\);/);
  });

  it("does not label an empty reply as coming from the AI", () => {
    // The only place "AI Mentor" may appear for this turn is inside the
    // truthy branch of the `reply ? ... : ...` conditional.
    expect(code).toMatch(/reply\s*\n?\s*\? \[\{ role: "AI Mentor", content: reply, expandable: !result\.isError \}\]/);
  });

  it("gives a distinct, non-AI label when the AI did not reply", () => {
    expect(code).toMatch(/: \[\{ role: "Your Mentor", content:.*\}\]/);
  });

  it("does not promise the human reply will appear in this pane", () => {
    const noteMatch = code.match(/role: "Your Mentor", content: "([^"]*)"/);
    expect(noteMatch).not.toBeNull();
    expect(noteMatch![1].toLowerCase()).not.toContain("here");
  });
});

describe("explainMore()", () => {
  it("does not push an empty AI Mentor bubble on an empty expand reply", () => {
    const fn = code.slice(code.indexOf("async function explainMore"), code.indexOf("if (!data) return"));
    expect(fn).toMatch(/const reply = result\.response\.trim\(\);/);
    expect(fn).toMatch(/if \(reply\) setMessages/);
  });
});
