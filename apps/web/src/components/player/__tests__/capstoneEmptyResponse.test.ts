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
 * reply no longer produces an "AI Mentor" bubble. The persisted capstone
 * thread is reloaded instead, while a clearly labeled handoff note covers the
 * interval before the human's message arrives through polling.
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
  it("uses the persisted capstone thread, which hydrates on mount", () => {
    expect(code).toMatch(/usePlayerThread\(course, "capstone"\)/);
  });

  it("does not label an empty reply as coming from the AI", () => {
    expect(code).toMatch(/setHandoffNotice\(!result\.response\.trim\(\)\)/);
    expect(code).not.toMatch(/setMessages/);
  });

  it("reloads the authoritative transcript after the turn", () => {
    expect(code).toMatch(/await loadThread\(\)/);
  });

  it("gives a distinct, non-AI handoff note when the AI did not reply", () => {
    expect(code).toMatch(/handoffNotice && <p[^>]*>Your mentor has this and will follow up\.<\/p>/);
  });
});

describe("explainMore()", () => {
  it("reloads rather than pushing a locally fabricated bubble", () => {
    const fn = code.slice(code.indexOf("async function explainMore"), code.indexOf("if (!data) return"));
    expect(fn).toMatch(/await loadThread\(\)/);
    expect(fn).not.toMatch(/setMessages/);
  });
});
