import { describe, expect, it } from "vitest";
import {
  buildResponseStyleInstruction,
  buildResponseStyleRepairInstruction,
  endsWithQuestion,
  finalQuestionHasOneFocus,
  hasPromptStartingPoint,
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
    expect(buildResponseStyleInstruction(style, false)).toContain("Never exceed 3 complete sentences");
    expect(buildResponseStyleInstruction(style, true)).toContain("Never exceed 6 complete sentences");
    expect(buildResponseStyleInstruction(style, true)).not.toMatch(/AIESS|ai-essentials/i);
  });

  it("calibrates each player intent without leaking examples across intents", () => {
    const question = buildResponseStyleInstruction(style, false, "question");
    const teachBack = buildResponseStyleInstruction(style, false, "teach_back");
    const expansion = buildResponseStyleInstruction(style, true, "expand", "question");
    expect(question).toContain("Answer in the first sentence");
    expect(question).not.toContain("complete shape");
    expect(teachBack).toContain("praise the learner");
    expect(teachBack).not.toContain("Job concern");
    expect(expansion).toContain("first new detail");
    expect(expansion).toContain("expands a question reply");
    expect(expansion).not.toContain("supplier");
  });

  it("states the question and plain-text constraints", () => {
    const prompt = buildResponseStyleInstruction(style, false);
    expect(prompt).toContain("at most 1 question");
    expect(prompt).toContain("plain text only");
    expect(prompt).toContain("comma chains");
    expect(prompt).toContain("name its overall shape instead of enumerating it");
    expect(prompt).toContain("one open focus");
    expect(prompt).not.toContain("ASCII punctuation only");
    expect(buildResponseStyleInstruction(style, false, "lesson_entry")).toContain("learner situation specific to this lesson");
  });

  it("does not ask lesson_entry to end with a question", () => {
    // A lesson-entry message announces the block the player is about to show;
    // it is not a conversation turn the learner is expected to answer. A
    // trailing question here holds the next block open (see the open-question
    // gate in LessonPlayer.tsx) for an answer nobody was asked to give.
    const entry = buildResponseStyleInstruction(style, false, "lesson_entry");
    expect(entry).toContain("Do not end with a question");
    expect(entry).not.toMatch(/final question may ask/i);
    // The conversational intents keep their own question guidance untouched.
    expect(buildResponseStyleInstruction(style, false, "capstone")).toContain("Ask about only one decision");
    expect(buildResponseStyleInstruction(style, true, "expand", "question")).toContain("no question when the parent already asked one");
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
    expect(responseStyleViolations(`${"x".repeat(205)}. Is it cost or speed?`, style, false)).toContain("question_not_open");
    expect(responseStyleViolations(`${"x".repeat(205)}. Does that make sense?`, style, false)).toContain("question_not_open");
    expect(finalQuestionHasOneFocus(`${"x".repeat(205)}. What did you give it, and what did you get back?`)).toBe(true);
    expect(finalQuestionHasOneFocus(`${"x".repeat(205)}. What failed, and how will you fix it?`)).toBe(false);
    expect(responseStyleViolations(`Use a role, task, context, constraints, and output format. ${"x".repeat(210)}.`, style, false)).toContain("comma_chained_enumeration");
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
    expect(responseStyleViolations(`${"x".repeat(210)}.`, style, false, "Tutor", undefined, "question", undefined, "Can you write the prompt for me?"))
      .toContain("prompt_starting_point");
    expect(responseStyleViolations("Act as [role] and use [context] to create [output] that meets [criteria] while avoiding [constraint]. Tell me the audience so I can replace the placeholders. What audience should this address?", style, false, "Tutor", undefined, "question", undefined, "Can you write the prompt for me?"))
      .not.toContain("prompt_starting_point");
    expect(hasPromptStartingPoint("Act as a subject expert and use your knowledge to create output that meets success criteria.")).toBe(true);
  });

  it("builds a model rewrite request instead of truncating the draft", () => {
    const repair = buildResponseStyleRepairInstruction(style, true, ["sentence_limit"]);
    expect(repair).toContain("at most 6 complete sentences total");
    expect(repair).toContain("no sentence over 35 words");
    expect(repair).toContain("no more than 1 question-mark character");
    expect(repair).toContain("Use five complete sentences");
    expect(repair).toContain("Remove lower-priority detail");
    expect(repair).toContain("Return only the rewritten final reply");
    expect(buildResponseStyleRepairInstruction(style, true, ["question_limit"], true)).toContain(
      "Use zero question-mark characters",
    );
    expect(buildResponseStyleRepairInstruction(style, false, ["question_focus"]))
      .toContain("never use yes-no or coordinate a second question");
    expect(buildResponseStyleRepairInstruction(style, false, ["comma_chained_enumeration"]))
      .toContain("Remove every four-or-more-item enumeration");
    expect(buildResponseStyleRepairInstruction(style, false, ["comma_chained_enumeration"], true))
      .toContain("Use no comma characters");
    expect(buildResponseStyleRepairInstruction(style, true, ["repeated_parent_question"], true))
      .toContain("Use zero question-mark characters");
    expect(buildResponseStyleRepairInstruction(style, false, ["stock_praise"], true))
      .toContain("Use no second-person words");
    expect(buildResponseStyleRepairInstruction(style, false, ["prompt_starting_point"]))
      .toContain("usable prompt starting point");
    expect(buildResponseStyleRepairInstruction(style, false, ["prompt_starting_point"]))
      .not.toContain("Sentence 1 must be");
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

/**
 * `endsWithQuestion` backs the player's open-question gate: it decides
 * whether a completed block should pause for review instead of revealing the
 * next one. Deliberately crude — a trailing "?" only, no attempt at "is it
 * actually open." See the doc comment in responseStyle.ts for why: missing a
 * real question lets the lesson move on out from under it, while a false
 * positive on a rhetorical question just costs one extra Continue click.
 */
describe("endsWithQuestion", () => {
  it("is true for ordinary trailing questions", () => {
    expect(endsWithQuestion("What would you like to explore first?")).toBe(true);
    expect(endsWithQuestion("  Trailing whitespace after the mark?   ")).toBe(true);
  });

  it("tolerates a trailing quote or parenthesis after the mark", () => {
    expect(endsWithQuestion('She asked, "what next?"')).toBe(true);
    expect(endsWithQuestion("(what next?)")).toBe(true);
  });

  it("is false when the reply does not end in a question", () => {
    expect(endsWithQuestion("That closes out the lesson.")).toBe(false);
    expect(endsWithQuestion("")).toBe(false);
  });

  it("only looks at the very end, not whether a question appears anywhere", () => {
    // A mid-reply question followed by a statement is not an open question the
    // block should pause on — the mentor already moved past it.
    expect(endsWithQuestion("Why does this matter? Because it saves time every week.")).toBe(false);
  });
});
