import { describe, expect, it } from "vitest";
import { historyContent } from "../LessonPlayer";

const surveyBlock = {
  id: "b0-2",
  order: 1,
  blockType: "onboarding_survey" as const,
  contentVersion: 1,
  concepts: [],
  steps: [
    { id: "q1", field: "preferredName", prompt: "What's your name?" },
    { id: "q2", field: "majorAndYear", prompt: "What's your major?" },
    { id: "q3", field: "targetRole", prompt: "What job are you aiming for?" },
  ],
};

describe("historyContent for onboarding_survey (Bug 2)", () => {
  it("interleaves each step's prompt with its stored answer once complete", () => {
    const history = historyContent(surveyBlock, {
      preferredName: "Michael",
      majorAndYear: "Finance, senior",
      targetRole: "Quant finance",
    });
    expect(history).toBe(
      "**What's your name?**\n\nMichael\n\n" +
      "**What's your major?**\n\nFinance, senior\n\n" +
      "**What job are you aiming for?**\n\nQuant finance",
    );
  });

  it("falls back to prompt-only for a step with no stored answer, instead of dropping it", () => {
    // Partial data (e.g. a stale contentVersion) should degrade to the old
    // prompts-only rendering for the affected step, not throw or omit it.
    const history = historyContent(surveyBlock, { preferredName: "Michael" });
    expect(history).toBe(
      "**What's your name?**\n\nMichael\n\n" +
      "**What's your major?**\n\n" +
      "**What job are you aiming for?**",
    );
  });

  it("renders prompts only when no answers are supplied at all, matching the pre-fix shape", () => {
    expect(historyContent(surveyBlock)).toBe(
      "**What's your name?**\n\n**What's your major?**\n\n**What job are you aiming for?**",
    );
  });
});
