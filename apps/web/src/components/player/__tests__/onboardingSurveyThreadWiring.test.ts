import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `threadItems` is a useMemo derived from `[data, completed, current,
 * threadMessages]`. `current` does not change when a survey step advances
 * (it's memoized on `[data, completed]`, and a mid-survey step never adds
 * the block to `completed`), so without `surveyStepIndex` in this memo's own
 * dependency array, a step advance would silently fail to mirror the new
 * step's prompt into the thread until something else forced a recompute.
 * This pins that `surveyStepIndex` is present.
 */
const source = readFileSync(
  resolve(process.cwd(), "src/components/player/LessonPlayer.tsx"),
  "utf8",
);

describe("onboarding_survey prompts are wired into the thread correctly", () => {
  it("threadItems recomputes when surveyStepIndex changes", () => {
    expect(source).toMatch(/\}, \[data, completed, current, threadMessages, surveyStepIndex\]\);/);
  });

  it("mirrors survey prompts through the shared helper, not an inline duplicate of the logic", () => {
    expect(source).toMatch(/isCurrent && block\.blockType === "onboarding_survey"/);
    expect(source).toMatch(/items\.push\(\.\.\.onboardingSurveyPromptBubbles\(block\.id, \(block as OnboardingSurvey\)\.steps, surveyStepIndex\)\)/);
  });

  it("looks up surveyAnswers from data.progress for the completed history branch (Bug 2)", () => {
    expect(source).toMatch(/const surveyAnswers = block\.blockType === "onboarding_survey"\s*\n\s*\? data\.progress\.find\(\(item\) => item\.blockId === block\.id\)\?\.surveyAnswers\s*\n\s*: undefined;/);
    expect(source).toMatch(/const history = historyContent\(block, surveyAnswers\);/);
  });

  it("does not touch the pinned card's survey question, answer box, or step counter", () => {
    // These three lines are the ones Fix 1 was told to leave completely
    // alone. Pinning their exact prior shape catches an accidental edit.
    expect(source).toMatch(/player-survey-step">Question \{Math\.min\(surveyStepIndex, \(current as OnboardingSurvey\)\.steps\.length - 1\) \+ 1\} of \{\(current as OnboardingSurvey\)\.steps\.length\}/);
    expect(source).toMatch(/current\.blockType === "onboarding_survey" && !submittedComplete\.has\(current\.id\) && <ReactMarkdown remarkPlugins=\{\[remarkGfm\]\}>\{\(current as OnboardingSurvey\)\.steps\[Math\.min\(surveyStepIndex, \(current as OnboardingSurvey\)\.steps\.length - 1\)\]\?\.prompt \?\? ""\}<\/ReactMarkdown>/);
    expect(source).toMatch(/isSurvey && !submittedComplete\.has\(current\.id\)\s*\n\s*\? <button disabled=\{busy \|\| !question\.trim\(\)\} onClick=\{submitSurveyStep\}>Send and continue<\/button>/);
  });
});
