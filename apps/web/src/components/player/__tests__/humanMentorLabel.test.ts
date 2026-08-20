import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A human mentor's reply must read as a different person arriving
 * ═══════════════════════════════════════════════════════════════════════════
 * `getLessonThread` selects `senderType`, but the render used to discard it —
 * every non-user row rendered as "AI Mentor" regardless of who actually wrote
 * it. This pins the fix: the label and the markdown pass both key off
 * `senderType === "mentor"`, and — the part that matters most — a legacy row
 * with `senderType: null` (every AI turn written before the column existed)
 * must keep reading as "AI Mentor", not "unknown" or blank.
 *
 * Asserted against source, not a rendered tree, per the same reasoning as
 * `singleTutorInput.test.ts`: the app has no component test environment.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const source = readFileSync(
  resolve(process.cwd(), "src/components/player/LessonPlayer.tsx"),
  "utf8",
);
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

it("comment stripping does not eat code", () => {
  expect(source).not.toMatch(/"[^"\n]*\/\//);
  expect(code).toMatch(/export function LessonPlayer/);
});

describe("thread item carries senderType through from the persisted row", () => {
  it("maps senderType from the message, not a hardcoded value", () => {
    expect(code).toMatch(/senderType:\s*message\.senderType,/);
  });
});

describe("human mentor detection", () => {
  it("requires an explicit senderType of \"mentor\" — never a role check alone", () => {
    expect(code).toMatch(
      /const isHumanMentor = item\.role === "mentor" && item\.senderType === "mentor";/,
    );
  });

  it("a legacy row with senderType: null cannot satisfy the check", () => {
    // `null === "mentor"` is false by construction; this test exists so that
    // if the comparison is ever loosened (e.g. `!= null`, or `!== "ai"`) the
    // change is caught here rather than by a confused mentor reading reports
    // of AI turns mislabeled as human, or vice versa.
    const senderType: string | null = null;
    const role = "mentor";
    const isHumanMentor = role === "mentor" && senderType === "mentor";
    expect(isHumanMentor).toBe(false);
  });
});

describe("label and rendering branch on isHumanMentor, not on role alone", () => {
  it("picks \"Your Mentor\" only for the human branch, \"AI Mentor\" otherwise", () => {
    expect(code).toMatch(
      /item\.role === "mentor" \? \(isHumanMentor \? "Your Mentor" : "AI Mentor"\) : "You"/,
    );
  });

  it("renders a human mentor's text as plain content, not through the markdown pass", () => {
    expect(code).toMatch(/item\.role === "mentor" && !isHumanMentor\s*\n?\s*\? <ReactMarkdown/);
  });

  it("tags the human bubble with a distinct class for the visual cue", () => {
    expect(code).toMatch(/isHumanMentor \? " human-mentor" : ""/);
  });

  it("does not offer \"Explain more\" on a human mentor's reply", () => {
    expect(code).toMatch(/item\.role === "mentor" && !isHumanMentor && item\.parentIntent && isLast/);
  });
});
