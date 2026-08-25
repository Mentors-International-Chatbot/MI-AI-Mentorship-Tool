import { describe, expect, it } from "vitest";
import { journeyPackageSchema } from "../journey-package.schema";
import { aiEssentialsAug2026Package } from "../examples/ai-essentials-aug2026-package";
import { gradePlayerBlock } from "@/lib/player/service";

/**
 * Stage E.5 — the AI Essentials Aug 2026 course package is both real content
 * and the acceptance test for the E.1-E.4 palette. This file checks the
 * package parses cleanly, and that the new E.2 question formats it uses
 * actually grade correctly against the package's own authored content (not
 * synthetic fixtures) — see reports/e5-authoring-findings.md for the full
 * findings, including the deferred 0.2 survey and the 1.4/1.11/6.3 gaps.
 */
describe("AI Essentials Aug 2026 package", () => {
  const parsed = journeyPackageSchema.safeParse(aiEssentialsAug2026Package);

  it("validates against the full journey-package schema with zero errors", () => {
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((i) => `[${i.path.join(".")}] ${i.message}`).join("\n"));
    }
    expect(parsed.success).toBe(true);
  });

  it("declares the player surface", () => {
    expect(aiEssentialsAug2026Package.metadata.delivery).toEqual({ surface: "player", supportedChannels: ["web"] });
  });

  it("carries the authored-verbatim course intro", () => {
    expect(aiEssentialsAug2026Package.metadata.introMessage?.en).toMatch(/Welcome to AI Essentials/);
  });

  it("runs the diagnostic (0.3) via config.onboarding.mode: baseline_quiz, with 0.2's survey deferred", () => {
    expect(aiEssentialsAug2026Package.config.onboarding?.mode).toBe("baseline_quiz");
    expect(aiEssentialsAug2026Package.config.onboarding?.steps).toEqual([]);
    expect(aiEssentialsAug2026Package.config.onboarding?.diagnostic?.questions).toHaveLength(6);
  });

  it("has six lessons (five content lessons plus the final project) totaling the expected block count", () => {
    const lessons = aiEssentialsAug2026Package.curriculum.lessons;
    expect(lessons.map((l) => l.key)).toEqual(["lesson-1", "lesson-2", "lesson-3", "lesson-4", "lesson-5", "final-project"]);
    const totalBlocks = lessons.reduce((sum, l) => sum + l.blocks.length, 0);
    expect(totalBlocks).toBeGreaterThan(60);
  });

  it("has unique block ids package-wide", () => {
    const ids = aiEssentialsAug2026Package.curriculum.lessons.flatMap((l) => l.blocks.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sets a 70% web_quiz passing score and a threshold-7 (of 10) reteach_gate passing dimension at the package level", () => {
    expect(aiEssentialsAug2026Package.config.assessment?.webQuizPassingScore).toBe(0.7);
    expect(aiEssentialsAug2026Package.config.assessment?.passing).toEqual(
      expect.objectContaining({ dimensionKey: "comprehension", threshold: 7 }),
    );
  });

  it("leaves allowRetake at the package default (true) everywhere — unlimited retries, per the doc's open question #3", () => {
    expect(aiEssentialsAug2026Package.config.assessment?.allowRetake).not.toBe(false);
    const teachBacks = aiEssentialsAug2026Package.curriculum.lessons.flatMap((l) => l.blocks)
      .filter((b) => b.blockType === "teach_back");
    for (const block of teachBacks) {
      expect("passingOverride" in block ? block.passingOverride?.dimensionKey : undefined).not.toBe(false);
    }
  });

  it("sets threshold: 0 on 6.3, the ungraded closing reflection, per the doc's explicit instruction", () => {
    const closing = aiEssentialsAug2026Package.curriculum.lessons
      .find((l) => l.key === "final-project")!.blocks.find((b) => b.id === "b6-3")!;
    expect(closing.blockType).toBe("teach_back");
    expect("passingOverride" in closing ? closing.passingOverride?.threshold : undefined).toBe(0);
  });

  it("marks every motivating activity / milestone project block as requiresSubmission + blocking, per the doc's open question #4", () => {
    const projectBlocks = aiEssentialsAug2026Package.curriculum.lessons.flatMap((l) => l.blocks)
      .filter((b) => b.blockType === "project");
    expect(projectBlocks.length).toBeGreaterThan(0);
    for (const block of projectBlocks) {
      expect("requiresSubmission" in block ? block.requiresSubmission : undefined).toBe(true);
      expect("blocking" in block ? block.blocking : undefined).toBe(true);
    }
  });

  it("leaves the 2.6 and 5.4 placeholder links clearly marked as TBD, not invented URLs", () => {
    const placeholders = aiEssentialsAug2026Package.curriculum.lessons.flatMap((l) => l.blocks)
      .filter((b): b is Extract<typeof b, { blockType: "resource" }> => b.blockType === "resource")
      .filter((b) => b.resource.type === "weblink" && b.resource.url.includes("TODO-see-e5-findings-report"));
    expect(placeholders).toHaveLength(2);
  });
});

describe("AI Essentials — new E.2 question formats grade correctly against authored content", () => {
  const parsedResult = journeyPackageSchema.safeParse(aiEssentialsAug2026Package);
  if (!parsedResult.success) throw new Error("package must parse before grading its own questions");
  const parsedPackage = parsedResult.data;
  const lesson3 = parsedPackage.curriculum.lessons.find((l) => l.key === "lesson-3")!;
  const quiz = lesson3.blocks.find((b) => b.id === "b3-10")!;
  if (quiz.blockType !== "quiz_checkpoint") throw new Error("b3-10 must be a quiz_checkpoint");

  const packageAssessment = parsedPackage.config.assessment!;

  // gradePlayerBlock's quiz_checkpoint branch requires an answer for every
  // question in the block, not just the one under test — this is the full,
  // all-correct answer set for b3-10 (9 questions), reused across cases.
  const allCorrectAnswers: Record<string, unknown> = {
    l3q1: "Turns a generic assistant into a useful one, by giving it the specifics it can't otherwise know",
    l3q2: "On hard problems, where the extra time/cost buys a better answer",
    l3q3: "A model can call a calculator (or other tool) that's actually good at the task instead of doing it itself",
    l3q4: "What the model is allowed to do, what it's given, how its output is checked, and what happens on failure",
    l3q5: "a specific audience", l3q6: "draft",
    l3q7: ["What you want done", "Who it's for", "What form the output should take", "What constraints apply"],
    l3q8: ["Request arrives with permitted context", "Model produces output (possibly calling a tool)", "Output is checked against rules", "Approved output is returned; failures are escalated or blocked"],
    l3q9: { wrong_math: "Tool calls (e.g. a calculator)", outdated_fact: "Tool calls (e.g. a search API)", generic_output: "Context", unsafe_action: "The harness" },
  };

  it("grades fill_in_blank (l3q6) correctly on a matching normalized answer", () => {
    const result = gradePlayerBlock(quiz, { ...allCorrectAnswers, l3q6: "DRAFT" }, 1, undefined, packageAssessment);
    const feedback = result.feedback as { questions: Array<{ questionId: string; correct: boolean }> } | null;
    expect(feedback?.questions.find((q) => q.questionId === "l3q6")?.correct).toBe(true);
  });

  it("grades drag_to_order (l3q7, l3q8) correctly on an exact permutation match", () => {
    const result = gradePlayerBlock(quiz, {
      ...allCorrectAnswers,
      l3q8: ["Output is checked against rules", "Request arrives with permitted context", "Model produces output (possibly calling a tool)", "Approved output is returned; failures are escalated or blocked"],
    }, 1, undefined, packageAssessment);
    const feedback = result.feedback as { questions: Array<{ questionId: string; correct: boolean }> } | null;
    expect(feedback?.questions.find((q) => q.questionId === "l3q7")?.correct).toBe(true);
    expect(feedback?.questions.find((q) => q.questionId === "l3q8")?.correct).toBe(false); // deliberately out of order
  });

  it("grades matching (l3q9) correctly per prompt-id -> option mapping", () => {
    const result = gradePlayerBlock(quiz, allCorrectAnswers, 1, undefined, packageAssessment);
    const feedback = result.feedback as { questions: Array<{ questionId: string; correct: boolean }> } | null;
    expect(feedback?.questions.find((q) => q.questionId === "l3q9")?.correct).toBe(true);
  });

  it("passes the block at the package's 0.7 threshold once enough graded questions are correct", () => {
    const allCorrect = {
      ...allCorrectAnswers,
    };
    const result = gradePlayerBlock(quiz, allCorrect, 1, undefined, packageAssessment);
    expect(result.complete).toBe(true);
  });
});
