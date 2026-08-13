import { describe, expect, it } from "vitest";
import {
  buildResponseStyleInstruction,
  buildResponseStyleRepairInstruction,
  hasTutorSelfIntroduction,
  repeatsParentOpening,
  responseStyleViolations,
  resolvePlayerMaxTokens,
} from "../responseStyle";

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

  it("calibrates each player intent without leaking examples across intents", () => {
    const question = buildResponseStyleInstruction(style, false, "question");
    const teachBack = buildResponseStyleInstruction(style, false, "teach_back");
    const expansion = buildResponseStyleInstruction(style, true, "expand", "question");
    expect(question).toContain("Answer the learner's actual question in the first sentence");
    expect(question).not.toContain("complete shape");
    expect(teachBack).toContain("Avoid stock praise");
    expect(teachBack).not.toContain("Job concern");
    expect(expansion).toContain("genuinely new material");
    expect(expansion).toContain("expands a question reply");
    expect(expansion).not.toContain("supplier");
  });

  it("states the question and plain-text constraints", () => {
    const prompt = buildResponseStyleInstruction(style, false);
    expect(prompt).toContain("at most 1 question");
    expect(prompt).toContain("plain text only");
    expect(prompt).toContain("Do not join two complete thoughts with only a comma");
    expect(prompt).toContain("focused on one thing");
  });

  it("uses 240 tokens normally, 480 for expansion, and no cap when omitted", () => {
    expect(resolvePlayerMaxTokens(style, false)).toBe(240);
    expect(resolvePlayerMaxTokens(style, true)).toBe(480);
    expect(resolvePlayerMaxTokens(undefined, false)).toBeUndefined();
  });

  it("detects complete delivered-text violations", () => {
    const validNormal = "Fluency and accuracy are different skills. A model predicts plausible text without checking a source, so polished wording cannot prove the claim is true. What evidence would help you verify the answer before using it in a decision?";
    expect(responseStyleViolations(validNormal, style, false)).toEqual([]);
    expect(responseStyleViolations("One? Two? Three. Four", style, false).sort()).toEqual([
      "character_range", "sentence_limit", "question_limit", "question_position", "incomplete_ending",
    ].sort());
    expect(responseStyleViolations("A complete answer. [END]", style, false)).toEqual(expect.arrayContaining([
      "control_marker",
      "incomplete_ending",
      "character_range",
    ]));
  });

  it("enforces question position, sentence words, punctuation, paragraph, length, and self-reference", () => {
    const longSentence = `${Array.from({ length: 36 }, () => "word").join(" ")}. ${"x".repeat(200)}.`;
    expect(responseStyleViolations(longSentence, style, false)).toContain("sentence_word_limit");
    expect(responseStyleViolations(`${"x".repeat(210)}? Answered here.`, style, false)).toContain("question_position");
    expect(responseStyleViolations(`${"x".repeat(210)} — done.`, style, false)).toContain("ascii_punctuation");
    expect(responseStyleViolations(`${"x".repeat(210)}.\nNext.`, style, false)).toContain("single_paragraph");
    expect(responseStyleViolations("I'm here to help you learn. ".repeat(10), style, false, "Tutor")).toContain("self_reference");
    expect(responseStyleViolations(`${"x".repeat(205)}. Is it cost or speed?`, style, false)).toContain("question_focus");
    expect(responseStyleViolations(`${"x".repeat(205)}. Does that make sense?`, style, false)).toContain("question_not_open");
    expect(hasTutorSelfIntroduction("I'm Tutor, and I'm glad you're here.", "Tutor")).toBe(true);
    expect(hasTutorSelfIntroduction("I can draft the first version.", "Tutor")).toBe(false);
  });

  it("detects an expansion that repeats its parent's opening", () => {
    const parent = "Fluency and accuracy are two different things. Models predict likely text.";
    const repeated = "Fluency and accuracy are two different things. A model can still invent a source while sounding polished enough to earn trust. That gap is why dates, names, and citations deserve a separate verification step before you rely on them.";
    const extended = "The tell is specificity without a source. A model can invent dates, names, and citations because those details make the text look complete. Verify those details before relying on the answer in a real decision.";
    expect(repeatsParentOpening(parent, repeated)).toBe(true);
    expect(repeatsParentOpening(parent, extended)).toBe(false);
    expect(responseStyleViolations(repeated, style, true, "Tutor", parent)).toContain("repeated_parent_opening");
    expect(responseStyleViolations(`The tell is specificity. ${"x".repeat(420)}. What should you check?`, style, true, "Tutor", "A model predicts text. What should you check?"))
      .toContain("repeated_parent_question");
    expect(responseStyleViolations(`${"You've nailed the framework. ".repeat(9)}`, style, false, "Tutor", undefined, "teach_back"))
      .toContain("stock_praise");
  });

  it("builds a model rewrite request instead of truncating the draft", () => {
    const repair = buildResponseStyleRepairInstruction(style, true, ["sentence_limit"]);
    expect(repair).toContain("at most 6 complete sentences total");
    expect(repair).toContain("no sentence over 35 words");
    expect(repair).toContain("no more than 1 question-mark character");
    expect(repair).toContain("Remove lower-priority detail");
    expect(repair).toContain("Return only the rewritten final reply");
    expect(buildResponseStyleRepairInstruction(style, true, ["question_limit"], true)).toContain(
      "Use zero question-mark characters",
    );
    expect(buildResponseStyleRepairInstruction(style, false, ["question_focus"]))
      .toContain("either-or, and multi-part questions");
    expect(buildResponseStyleRepairInstruction(style, true, ["control_marker"])).toContain(
      "Remove all other bracketed drafting markers such as [END]",
    );
    expect(buildResponseStyleRepairInstruction(style, true, ["character_range"], false, 300)).toContain(
      "current draft is only 300 characters",
    );
    expect(buildResponseStyleRepairInstruction(style, true, ["repeated_parent_opening"], false, 550, "Parent opening. More."))
      .toContain("PARENT REPLY WHOSE OPENING MUST NOT BE REUSED:\nParent opening. More.");
  });
});
