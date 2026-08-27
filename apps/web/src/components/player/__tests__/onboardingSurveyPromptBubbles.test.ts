import { describe, expect, it } from "vitest";
import { onboardingSurveyPromptBubbles } from "../LessonPlayer";

const steps = [
  { prompt: "What's your name?" },
  { prompt: "What's your major?" },
  { prompt: "What job are you aiming for?" },
];

describe("onboardingSurveyPromptBubbles", () => {
  it("produces exactly one bubble per step as the survey advances", () => {
    expect(onboardingSurveyPromptBubbles("b0-2", steps, 0)).toEqual([
      { kind: "prompt", key: "b0-2-step-0-prompt", content: "What's your name?" },
    ]);
    expect(onboardingSurveyPromptBubbles("b0-2", steps, 1)).toEqual([
      { kind: "prompt", key: "b0-2-step-0-prompt", content: "What's your name?" },
      { kind: "prompt", key: "b0-2-step-1-prompt", content: "What's your major?" },
    ]);
    expect(onboardingSurveyPromptBubbles("b0-2", steps, 2)).toEqual([
      { kind: "prompt", key: "b0-2-step-0-prompt", content: "What's your name?" },
      { kind: "prompt", key: "b0-2-step-1-prompt", content: "What's your major?" },
      { kind: "prompt", key: "b0-2-step-2-prompt", content: "What job are you aiming for?" },
    ]);
  });

  it("never produces duplicate keys within one result", () => {
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const keys = onboardingSurveyPromptBubbles("b0-2", steps, stepIndex).map((item) => item.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("re-rendering the same step (no step change) yields an identical result, not a duplicate", () => {
    // A component re-render that does not change surveyStepIndex must call
    // this with the same arguments and get the same array back — pinning
    // that repeated calls at a fixed step never grow the result.
    const first = onboardingSurveyPromptBubbles("b0-2", steps, 1);
    const second = onboardingSurveyPromptBubbles("b0-2", steps, 1);
    const third = onboardingSurveyPromptBubbles("b0-2", steps, 1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first).toHaveLength(2);
  });

  it("reloading straight into a mid-survey step reconstructs the same history as stepping through it turn by turn", () => {
    // Simulates a page reload that mounts directly at stepIndex 2 (the
    // persisted state after two prior submissions), with no prior calls to
    // this function in this process. The function has no memory of how it
    // got there — it is pure in (blockId, steps, stepIndex) — so the two
    // paths must be indistinguishable.
    const steppedThrough = [0, 1, 2].map((index) => onboardingSurveyPromptBubbles("b0-2", steps, index));
    const reloadedDirectlyAtStep2 = onboardingSurveyPromptBubbles("b0-2", steps, 2);
    expect(reloadedDirectlyAtStep2).toEqual(steppedThrough[2]);
    expect(reloadedDirectlyAtStep2).toHaveLength(3);
  });

  it("repeated calls at the same step never accumulate beyond what a single call produces", () => {
    // Guards against an accumulation bug (e.g. pushing into a shared array
    // across calls) that a single equality check on one call could miss.
    const results = Array.from({ length: 5 }, () => onboardingSurveyPromptBubbles("b0-2", steps, 1));
    for (const result of results) expect(result).toHaveLength(2);
  });

  it("clamps to the last step once the survey is fully answered, matching the card's own clamping", () => {
    const atLastIndex = onboardingSurveyPromptBubbles("b0-2", steps, steps.length - 1);
    const pastTheEnd = onboardingSurveyPromptBubbles("b0-2", steps, steps.length + 5);
    expect(pastTheEnd).toEqual(atLastIndex);
    expect(pastTheEnd).toHaveLength(steps.length);
  });

  it("handles an empty steps array without throwing", () => {
    expect(onboardingSurveyPromptBubbles("b0-2", [], 0)).toEqual([]);
  });

  it("clamps a negative step index to the first step", () => {
    expect(onboardingSurveyPromptBubbles("b0-2", steps, -1)).toEqual([
      { kind: "prompt", key: "b0-2-step-0-prompt", content: "What's your name?" },
    ]);
  });
});
