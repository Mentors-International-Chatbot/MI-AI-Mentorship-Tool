import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lessonBlockSchema } from "@/lib/journey-package/journey-package.schema";
import { gradePlayerBlock, QUIZ_ATTEMPT_LIMIT } from "@/lib/player/service";

/**
 * The learner never sees a raw object
 * ═══════════════════════════════════════════════════════════════════════════
 * The lesson player shipped with the grading payload stringified into a `<pre>`
 * where the graded verdict belonged. It was a placeholder that survived, and because
 * the grading response carried `correctAnswer` and `explanation` for every
 * graded question, a learner who got block 8 wrong was shown the answer key —
 * as JSON, in a code block, in both courses.
 *
 * Two rules come out of that, and this file pins both:
 *
 *  1. No player component interpolates a stringified value into its tree. A
 *     missing renderer must show *nothing*, which is a bug report; JSON on the
 *     page is a leak.
 *  2. Every verdict `gradePlayerBlock` can emit is tagged with a `kind` that
 *     `BlockFeedback` names. A new block type that returns feedback without
 *     teaching this component about it fails here rather than in front of a
 *     learner.
 *
 * Asserted against source, the way `singleTutorInput.test.ts` is: vitest runs
 * in `node` and there is no component-render environment to assert a tree in.
 */
const dir = resolve(process.cwd(), "src/components/player");
const read = (file: string) => readFileSync(resolve(dir, file), "utf8");
const feedbackSource = read("BlockFeedback.tsx");

/** JSX interpolation only — `body: JSON.stringify(...)` in a fetch is not this. */
const RENDERED_STRINGIFY = /\{JSON\.stringify/;

describe("no player surface renders a stringified value", () => {
  const components = ["LessonPlayer.tsx", "BlockFeedback.tsx", "CapstonePlayer.tsx", "DiagnosticPlayer.tsx", "ProjectSetupPlayer.tsx", "PlayerDashboard.tsx", "HelpRequestPanel.tsx"];

  it.each(components)("%s interpolates no JSON into its tree", (file) => {
    expect(read(file)).not.toMatch(RENDERED_STRINGIFY);
  });

  it("falls through to null rather than to a dump", () => {
    // The last return in the component is the unrecognized-shape branch.
    expect(feedbackSource.trimEnd().endsWith("return null;\n}")).toBe(true);
  });
});

describe("every emitted verdict has a renderer", () => {
  const quiz = lessonBlockSchema.parse({
    id: "quiz", order: 1, blockType: "quiz_checkpoint", concepts: [],
    questions: [{ id: "q1", prompt: "Pick", format: "multiple_choice", options: ["A", "B"], answerKey: "B", explanation: "B is correct" }],
  });
  const drag = lessonBlockSchema.parse({
    id: "drag", order: 2, blockType: "drag_order", prompt: "Order", items: ["A", "B", "C"], correctOrder: [2, 0, 1],
  });

  const emitted = [
    gradePlayerBlock(quiz, { q1: "A" }, 1),
    gradePlayerBlock(quiz, { q1: "A" }, QUIZ_ATTEMPT_LIMIT),
    gradePlayerBlock(quiz, { q1: "B" }, 1),
    gradePlayerBlock(drag, [0, 1, 2]),
    gradePlayerBlock(drag, [2, 0, 1]),
  ].map((grade) => grade.feedback).filter((feedback) => feedback !== null);

  it("tags every verdict with a kind", () => {
    expect(emitted).toHaveLength(5);
    expect(emitted.every((feedback) => typeof feedback.kind === "string")).toBe(true);
  });

  it("names each kind in the renderer's guards", () => {
    for (const kind of new Set(emitted.map((feedback) => feedback.kind))) {
      expect(feedbackSource).toContain(`value.kind === "${kind}"`);
    }
  });
});

describe("the retry is spent before the key is shown", () => {
  const quiz = lessonBlockSchema.parse({
    id: "quiz", order: 1, blockType: "quiz_checkpoint", concepts: [],
    questions: [{ id: "q1", prompt: "Pick", format: "multiple_choice", options: ["A", "B"], answerKey: "B", explanation: "B is correct" }],
  });

  it("hands the renderer nothing to leak on the attempts before the last", () => {
    for (let attempt = 1; attempt < QUIZ_ATTEMPT_LIMIT; attempt += 1) {
      const serialized = JSON.stringify(gradePlayerBlock(quiz, { q1: "A" }, attempt).feedback);
      expect(serialized).not.toContain("answerKey");
      expect(serialized).not.toContain("correctAnswer");
      expect(serialized).not.toContain("B is correct");
    }
  });

  it("keeps the block open for exactly that many attempts", () => {
    expect(gradePlayerBlock(quiz, { q1: "A" }, QUIZ_ATTEMPT_LIMIT - 1).complete).toBe(false);
    expect(gradePlayerBlock(quiz, { q1: "A" }, QUIZ_ATTEMPT_LIMIT).complete).toBe(true);
  });
});
