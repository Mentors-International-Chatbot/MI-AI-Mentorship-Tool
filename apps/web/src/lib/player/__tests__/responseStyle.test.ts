import { describe, expect, it } from "vitest";
import { buildResponseStyleInstruction, resolvePlayerMaxTokens } from "../responseStyle";

const style = {
  maxSentences: 3,
  maxOutputTokens: 240,
  markdown: "none" as const,
  maxQuestions: 1,
  expanded: { maxSentences: 6, maxOutputTokens: 480 },
};

describe("player response style prompt", () => {
  it("adds no instruction when responseStyle is omitted", () => {
    expect(buildResponseStyleInstruction(undefined, false)).toBe("");
  });

  it("uses normal and expanded sentence limits without embedding a course code", () => {
    expect(buildResponseStyleInstruction(style, false)).toContain("at most 3 complete sentences");
    expect(buildResponseStyleInstruction(style, true)).toContain("at most 6 complete sentences");
    expect(buildResponseStyleInstruction(style, true)).not.toMatch(/AIESS|ai-essentials/i);
  });

  it("states the question and plain-text constraints", () => {
    const prompt = buildResponseStyleInstruction(style, false);
    expect(prompt).toContain("at most 1 question");
    expect(prompt).toContain("plain text only");
  });

  it("uses 240 tokens normally, 480 for expansion, and no cap when omitted", () => {
    expect(resolvePlayerMaxTokens(style, false)).toBe(240);
    expect(resolvePlayerMaxTokens(style, true)).toBe(480);
    expect(resolvePlayerMaxTokens(undefined, false)).toBeUndefined();
  });
});
