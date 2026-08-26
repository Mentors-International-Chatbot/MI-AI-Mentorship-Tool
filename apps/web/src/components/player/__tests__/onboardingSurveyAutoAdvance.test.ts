import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * onboarding_survey auto-advance
 * ═══════════════════════════════════════════════════════════════════════════
 * `submitSurveyStep()` used to call `complete()` and stop. Every other block
 * type advances because completing it changes `current` (its id leaves
 * `completed`), which re-renders on its own. onboarding_survey's steps all
 * share one block id, so nothing else moved `current` between them: the card
 * kept showing the just-answered question until a full page reload
 * re-derived `surveyStepIndex` from the server. A learner who doesn't know
 * to reload sees a frozen screen and re-answers the same visible question,
 * which the server then silently files under the next unanswered field
 * (found via a live walkthrough, not a unit test — see
 * BlockProgress.response corruption this produced).
 *
 * Asserted against source, not a rendered tree: the app has no component
 * test environment (vitest runs in `node`, no .tsx tests) — same approach
 * as singleTutorInput.test.ts.
 */
const source = readFileSync(
  resolve(process.cwd(), "src/components/player/LessonPlayer.tsx"),
  "utf8",
);

describe("submitSurveyStep advances the visible step without a reload", () => {
  it("bumps surveyStepIndex locally after a non-final step completes", () => {
    const fn = source.slice(
      source.indexOf("async function submitSurveyStep"),
      source.indexOf("async function advanceReviewedBlock"),
    );
    expect(fn).toMatch(/const result = await complete\(answer\)/);
    expect(fn).toMatch(/if \(result && !result\.completed\) setSurveyStepIndex\(\(value\) => value \+ 1\)/);
  });
});
