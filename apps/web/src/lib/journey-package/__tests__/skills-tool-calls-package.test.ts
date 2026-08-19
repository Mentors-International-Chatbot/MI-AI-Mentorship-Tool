import { describe, expect, it } from "vitest";
import { journeyPackageSchema } from "../journey-package.schema";
import { skillsToolCallsPackage } from "../examples/skills-tool-calls-package";
import { COURSE_CODES, resolveCourseCode } from "@/lib/courses/resolver";

/**
 * Skills & Tool Calls exists to land a learner on block 1 with nothing in the
 * way. Every assertion here is a routing gate that an added config key would
 * silently close — the failure mode is a participant bounced to project setup
 * or a diagnostic at the start of a focus group.
 */
type QuizBlock = Extract<
  (typeof skillsToolCallsPackage)["curriculum"]["lessons"][number]["blocks"][number],
  { blockType: "quiz_checkpoint" }
>;
const quizBlocks = (): QuizBlock[] => skillsToolCallsPackage.curriculum.lessons[0].blocks
  .filter((block): block is QuizBlock => block.blockType === "quiz_checkpoint");

describe("Skills & Tool Calls package", () => {
  const parsed = journeyPackageSchema.safeParse(skillsToolCallsPackage);

  it("validates", () => {
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((i) => `[${i.path.join(".")}] ${i.message}`).join("\n"));
    }
    expect(parsed.success).toBe(true);
  });

  it("declares the player surface, or the runtime falls back to chat", () => {
    expect(skillsToolCallsPackage.metadata.delivery).toEqual({
      surface: "player",
      supportedChannels: ["web"],
    });
  });

  it("omits every config key that gates the way to block 1", () => {
    const config = skillsToolCallsPackage.config;
    // learnerHome.ts + getLessonDto → /learn/SKILLS/project-setup
    expect(config.projectSelection).toBeUndefined();
    // learnerHome.ts → /learn/SKILLS/diagnostic
    expect(config.onboarding).toBeUndefined();
    // `outcome` is a package-level key, not a config one. Its absence is what
    // leaves the capstone unbuilt; the resulting 404 dead end is guarded
    // separately in learnerHome and the lesson-complete card.
    expect(skillsToolCallsPackage.outcome).toBeUndefined();
    expect(config.helpRequest).toBeUndefined();
  });

  it("is one lesson of thirteen blocks, in order, with unique ids", () => {
    const lessons = skillsToolCallsPackage.curriculum.lessons;
    expect(lessons).toHaveLength(1);
    const blocks = lessons[0].blocks;
    expect(blocks).toHaveLength(13);
    expect(blocks.map((b) => b.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(13);
  });

  it("uses only block types the player can render", () => {
    // `media` and `resource` validate but have no renderer branch, so a learner
    // reaching one sees an empty card with no way to continue.
    const renderable = new Set(["teach", "teach_back", "quiz_checkpoint", "drag_order"]);
    for (const block of skillsToolCallsPackage.curriculum.lessons[0].blocks) {
      expect(renderable.has(block.blockType)).toBe(true);
    }
  });

  it("delivers the two opinion polls as ungraded, selectable MCQs", () => {
    const polls = quizBlocks().filter((b) => b.questions.every((q) => !q.graded));
    expect(polls.map((b) => b.id)).toEqual(["stc-02-skills-poll", "stc-03-tool-calls-poll"]);
    for (const poll of polls) {
      for (const question of poll.questions) {
        // No answer key is invented for a question that has none — a V2 grader
        // would otherwise act on it.
        expect(question.graded).toBe(false);
        expect(question.answerKey).toBeUndefined();
        expect(question.options?.length).toBeGreaterThanOrEqual(2);
      }
    }
  });


  it("checks understanding with graded MCQs that carry a key and an explanation", () => {
    const graded = quizBlocks().filter((b) => b.questions.some((q) => q.graded));
    expect(graded.map((b) => b.id)).toEqual(["stc-08-questions-skill", "stc-10-questions-tool-calls"]);
    for (const block of graded) {
      for (const question of block.questions) {
        expect(question.options).toHaveLength(4);
        // The key must be one of the rendered options, or the learner can never
        // pick it.
        expect(question.options).toContain(question.answerKey);
        expect(question.explanation).toBeTruthy();
      }
    }
  });

  it("asks for the merged re-explanation after the connection is drawn, before the exercise", () => {
    const blocks = skillsToolCallsPackage.curriculum.lessons[0].blocks;
    const teachBacks = blocks.filter((b) => b.blockType === "teach_back");
    // Two, not three: six typed responses is too long for a demo.
    expect(teachBacks.map((b) => b.id)).toEqual(["stc-06-how-would-you", "stc-12-explain-both"]);
    const merged = blocks.find((b) => b.id === "stc-12-explain-both")!;
    const exercise = blocks.find((b) => b.id === "stc-12-your-turn")!;
    expect(merged.order).toBeLessThan(exercise.order);
    expect(exercise.order).toBe(blocks.length);
  });

  it("sets a category, or the player labels the course AI Essentials", () => {
    expect(skillsToolCallsPackage.curriculum.lessons[0].category).toBe("Skills & Tool Calls");
  });

  it("is reachable by course code", () => {
    expect(resolveCourseCode("SKILLS")).toBe(skillsToolCallsPackage.curriculum.collectionKey);
    expect(resolveCourseCode("skills")).toBe(skillsToolCallsPackage.curriculum.collectionKey);
    expect(COURSE_CODES.SKILLS).toBe("skills-tool-calls");
  });
});

describe("teach blocks that invite a typed response", () => {
  it("marks block 1, whose copy asks the learner to introduce themselves", () => {
    const blocks = skillsToolCallsPackage.curriculum.lessons[0].blocks;
    const welcome = blocks.find((b) => b.id === "stc-01-welcome")!;
    expect(welcome.blockType).toBe("teach");
    expect("expectsResponse" in welcome && welcome.expectsResponse).toBe(true);
    // The prose and the flag have to agree, or the control contradicts the copy.
    expect("content" in welcome && welcome.content).toMatch(/introduce yourself/i);
  });

  it("leaves every other teach block alone", () => {
    const others = skillsToolCallsPackage.curriculum.lessons[0].blocks
      .filter((b) => b.blockType === "teach" && b.id !== "stc-01-welcome");
    for (const block of others) {
      expect("expectsResponse" in block ? block.expectsResponse : undefined).toBeFalsy();
    }
  });
});
