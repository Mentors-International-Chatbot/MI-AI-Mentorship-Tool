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

  it("mirrors survey prompts through the shared helper, not an inline duplicate of the logic, passing the same surveyAnswers the completed-history branch uses", () => {
    expect(source).toMatch(/isCurrent && block\.blockType === "onboarding_survey"/);
    expect(source).toMatch(/items\.push\(\.\.\.onboardingSurveyPromptBubbles\(block\.id, \(block as OnboardingSurvey\)\.steps, surveyStepIndex, surveyAnswers\)\)/);
  });

  it("looks up surveyAnswers once per block, ahead of both the completed-history and the live-mirror branches (Bug 2)", () => {
    expect(source).toMatch(/const surveyAnswers = block\.blockType === "onboarding_survey"\s*\n\s*\? data\.progress\.find\(\(item\) => item\.blockId === block\.id\)\?\.surveyAnswers\s*\n\s*: undefined;/);
    expect(source).toMatch(/const history = historyContent\(block, surveyAnswers\);/);
  });

  it("the live question moved into the pinned card: the card keeps its answer box and combined step counter, and stops mirroring the live step into the thread", () => {
    // The card still shows the live question, gated the same way as before.
    expect(source).toMatch(/current\.blockType === "onboarding_survey" && !submittedComplete\.has\(current\.id\) && <ReactMarkdown remarkPlugins=\{\[remarkGfm\]\}>\{\(current as OnboardingSurvey\)\.steps\[Math\.min\(surveyStepIndex, \(current as OnboardingSurvey\)\.steps\.length - 1\)\]\?\.prompt \?\? ""\}<\/ReactMarkdown>/);
    expect(source).toMatch(/isSurvey && !submittedComplete\.has\(current\.id\)\s*\n\s*\? <button disabled=\{busy \|\| !question\.trim\(\)\} onClick=\{submitSurveyStep\}>Send and continue<\/button>/);
    // The lesson-level and survey-level counters are now one line for this
    // block type (Part 2), not two stacked divs.
    expect(source).toMatch(/current\.blockType === "onboarding_survey"\s*\n\s*\? \(!submittedComplete\.has\(current\.id\) && <div className="player-step player-survey-step">Step \{done \+ 1\} of \{total\} · Question \{Math\.min\(surveyStepIndex, \(current as OnboardingSurvey\)\.steps\.length - 1\) \+ 1\} of \{\(current as OnboardingSurvey\)\.steps\.length\}<\/div>\)/);
  });
});
