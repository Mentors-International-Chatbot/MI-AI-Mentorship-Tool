import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * onboarding_survey step label
 * ═══════════════════════════════════════════════════════════════════════════
 * The lesson-level "Step {done+1} of {total}" counts completed *blocks* in
 * the lesson (14 in lesson-1), not the survey's own internal steps. b0-2 is
 * one block with 7 canned questions, so that counter reads "Step 1 of 14"
 * for the whole survey regardless of which question is showing — a real
 * walkthrough surfaced this as "the label doesn't match reality" even though
 * it was never wired to the survey at all. This pins a second, dedicated
 * counter for the survey's own progress, separate from (and not replacing)
 * the lesson-level one.
 *
 * Asserted against source, not a rendered tree — same approach as
 * singleTutorInput.test.ts.
 */
const source = readFileSync(
  resolve(process.cwd(), "src/components/player/LessonPlayer.tsx"),
  "utf8",
);

describe("onboarding_survey has its own step counter", () => {
  it("still has the untouched lesson-level counter", () => {
    expect(source).toMatch(/<div className="player-step">Step \{done \+ 1\} of \{total\}<\/div>/);
  });

  it("renders a separate survey-specific counter driven by surveyStepIndex", () => {
    expect(source).toMatch(/player-survey-step">Question \{Math\.min\(surveyStepIndex, \(current as OnboardingSurvey\)\.steps\.length - 1\) \+ 1\} of \{\(current as OnboardingSurvey\)\.steps\.length\}/);
  });
});
