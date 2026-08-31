import { describe, expect, it } from "vitest";
import { onboardingSurveyPromptBubbles } from "../LessonPlayer";

const steps = [
  { prompt: "What's your name?", field: "name" },
  { prompt: "What's your major?", field: "major" },
  { prompt: "What job are you aiming for?", field: "goal" },
];

describe("onboardingSurveyPromptBubbles", () => {
  it("mirrors only the steps behind the current one, never the live step itself", () => {
    // The live step now lives in the pinned card (see LessonPlayer's merged
    // input), so mirroring it into the thread too printed the same question
    // twice. stepIndex 0 has nothing behind it.
    expect(onboardingSurveyPromptBubbles("b0-2", steps, 0)).toEqual([]);
    expect(onboardingSurveyPromptBubbles("b0-2", steps, 1)).toEqual([
      { kind: "prompt", key: "b0-2-step-0-prompt", content: "**What's your name?**" },
    ]);
    expect(onboardingSurveyPromptBubbles("b0-2", steps, 2)).toEqual([
      { kind: "prompt", key: "b0-2-step-0-prompt", content: "**What's your name?**" },
      { kind: "prompt", key: "b0-2-step-1-prompt", content: "**What's your major?**" },
    ]);
  });

  it("renders each mirrored step with its answer underneath, keyed by field", () => {
    const answers = { name: "Alex", major: "Economics" };
    expect(onboardingSurveyPromptBubbles("b0-2", steps, 2, answers)).toEqual([
      { kind: "prompt", key: "b0-2-step-0-prompt", content: "**What's your name?**\n\nAlex" },
      { kind: "prompt", key: "b0-2-step-1-prompt", content: "**What's your major?**\n\nEconomics" },
    ]);
  });

  it("falls back to the bare question when a mirrored step has no recorded answer", () => {
    // Defensive: `answers` is sourced from `data.progress`, which is only as
    // fresh as the last fetch. A step answered this session but not yet
    // reflected there must not crash or show `undefined`.
    expect(onboardingSurveyPromptBubbles("b0-2", steps, 1, {})).toEqual([
      { kind: "prompt", key: "b0-2-step-0-prompt", content: "**What's your name?**" },
    ]);
  });

  it("never produces duplicate keys within one result", () => {
    for (let stepIndex = 0; stepIndex <= steps.length; stepIndex += 1) {
      const keys = onboardingSurveyPromptBubbles("b0-2", steps, stepIndex).map((item) => item.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("re-rendering the same step (no step change) yields an identical result, not a duplicate", () => {
    // A component re-render that does not change surveyStepIndex must call
    // this with the same arguments and get the same array back — pinning
    // that repeated calls at a fixed step never grow the result.
    const first = onboardingSurveyPromptBubbles("b0-2", steps, 2);
    const second = onboardingSurveyPromptBubbles("b0-2", steps, 2);
    const third = onboardingSurveyPromptBubbles("b0-2", steps, 2);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first).toHaveLength(2);
  });

  it("reloading straight into a mid-survey step reconstructs the same history as stepping through it turn by turn", () => {
    // Simulates a page reload that mounts directly at stepIndex 2 (the
    // persisted state after two prior submissions), with no prior calls to
    // this function in this process. The function has no memory of how it
    // got there — it is pure in (blockId, steps, stepIndex, answers) — so the
    // two paths must be indistinguishable given the same answers snapshot.
    const answers = { name: "Alex", major: "Economics" };
    const steppedThrough = [0, 1, 2].map((index) => onboardingSurveyPromptBubbles("b0-2", steps, index, answers));
    const reloadedDirectlyAtStep2 = onboardingSurveyPromptBubbles("b0-2", steps, 2, answers);
    expect(reloadedDirectlyAtStep2).toEqual(steppedThrough[2]);
    expect(reloadedDirectlyAtStep2).toHaveLength(2);
  });

  it("repeated calls at the same step never accumulate beyond what a single call produces", () => {
    // Guards against an accumulation bug (e.g. pushing into a shared array
    // across calls) that a single equality check on one call could miss.
    const results = Array.from({ length: 5 }, () => onboardingSurveyPromptBubbles("b0-2", steps, 2));
    for (const result of results) expect(result).toHaveLength(2);
  });

  it("mirrors every step once the index reaches or passes the end of the survey", () => {
    // Not the same set as one-before-the-last: on the final live question
    // (index steps.length - 1) only the earlier steps are behind it. Past the
    // end (survey fully answered) every step is behind it.
    const atLastLiveStep = onboardingSurveyPromptBubbles("b0-2", steps, steps.length - 1);
    const pastTheEnd = onboardingSurveyPromptBubbles("b0-2", steps, steps.length + 5);
    expect(atLastLiveStep).toHaveLength(steps.length - 1);
    expect(pastTheEnd).toHaveLength(steps.length);
    expect(pastTheEnd.map((item) => item.key)).toEqual(steps.map((_, index) => `b0-2-step-${index}-prompt`));
  });

  it("handles an empty steps array without throwing", () => {
    expect(onboardingSurveyPromptBubbles("b0-2", [], 0)).toEqual([]);
  });

  it("clamps a negative step index to having nothing behind it", () => {
    expect(onboardingSurveyPromptBubbles("b0-2", steps, -1)).toEqual([]);
  });
});
