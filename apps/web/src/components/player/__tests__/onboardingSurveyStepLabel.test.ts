import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * onboarding_survey step label
 * ═══════════════════════════════════════════════════════════════════════════
 * The lesson-level "Step {done+1} of {total}" counts completed *blocks* in
 * the lesson (14 in lesson-1), not the survey's own internal steps. b0-2 is
 * one block with 7 canned questions, so that counter used to read "Step 1 of
 * 14" for the whole survey regardless of which question is showing, stacked
 * directly above a second "Question X of 7" div — two counters for one
 * question. This block type now collapses them into a single line, "Step 1
 * of 14 · Question 1 of 7"; every other block type keeps the plain
 * lesson-level counter untouched, which is what the first test here pins.
 *
 * Asserted against source, not a rendered tree — same approach as
 * singleTutorInput.test.ts.
 */
const source = readFileSync(
  resolve(process.cwd(), "src/components/player/LessonPlayer.tsx"),
  "utf8",
);

describe("onboarding_survey collapses the lesson-level and survey-level counters into one line", () => {
  it("keeps the untouched lesson-level counter for every other block type", () => {
    expect(source).toMatch(/<div className="player-step">Step \{done \+ 1\} of \{total\}<\/div>/);
  });

  it("renders a single combined counter for onboarding_survey, driven by both done/total and surveyStepIndex", () => {
    expect(source).toMatch(
      /current\.blockType === "onboarding_survey"\s*\n\s*\? \(!submittedComplete\.has\(current\.id\) && <div className="player-step player-survey-step">Step \{done \+ 1\} of \{total\} · Question \{Math\.min\(surveyStepIndex, \(current as OnboardingSurvey\)\.steps\.length - 1\) \+ 1\} of \{\(current as OnboardingSurvey\)\.steps\.length\}<\/div>\)\s*\n\s*: <div className="player-step">Step \{done \+ 1\} of \{total\}<\/div>/,
    );
  });

  it("hides the combined counter once the block is submittedComplete, same as the question it used to sit next to", () => {
    const counter = source.slice(source.indexOf('current.blockType === "onboarding_survey"\n          ?'), source.indexOf(': <div className="player-step">'));
    expect(counter).toMatch(/!submittedComplete\.has\(current\.id\)/);
  });
});
