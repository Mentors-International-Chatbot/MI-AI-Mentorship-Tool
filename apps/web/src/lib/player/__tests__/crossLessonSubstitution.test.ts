/**
 * E.6.1: resolveCrossLessonAnswers/applyCrossLessonSubstitution — a single
 * choke point resolving `{step:<id>}` tokens in a later lesson's `project`
 * or `teach_back` content against an earlier lesson's `onboarding_survey`
 * block answers. Only queried when the current lesson actually authors a
 * token (see `needsCrossLessonAnswers` in getLessonDto) — most lessons pay
 * nothing extra.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectionRequired: vi.fn(),
  contentLessonFindMany: vi.fn(),
  blockProgressFindMany: vi.fn(),
  blockProgressFindFirst: vi.fn(),
  diagnosticAttemptCount: vi.fn(),
}));

vi.mock("@/lib/player/learnerProject", () => ({
  getCurrentLearnerProject: vi.fn(),
  learnerProjectSelectionRequired: mocks.selectionRequired,
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    contentLesson: { findMany: mocks.contentLessonFindMany },
    blockProgress: { findMany: mocks.blockProgressFindMany, findFirst: mocks.blockProgressFindFirst },
    milestoneProgress: { findMany: vi.fn().mockResolvedValue([]) },
    diagnosticAttempt: { count: mocks.diagnosticAttemptCount },
  },
}));

import { getLessonDto } from "@/lib/player/service";
import type { PlayerAccess } from "@/lib/player/service";

const SURVEY_STEPS = [
  { id: "q5", field: "tediousTask", prompt: "What's one tedious task?" },
  { id: "q6", field: "careerBelief", prompt: "What do you believe about AI and your career?" },
];

function lessonWithSurvey() {
  return {
    key: "lesson-1", title: "Lesson 1", keyConcepts: [], selfCheckQuestions: [],
    blocks: [
      { id: "b0-2", order: 1, blockType: "onboarding_survey", contentVersion: 1, concepts: [], steps: SURVEY_STEPS },
      { id: "teach1", order: 2, blockType: "teach", contentVersion: 1, concepts: [], role: "explanation", content: "Some content" },
      {
        id: "b1-11", order: 3, blockType: "project", contentVersion: 1, concepts: [],
        requiresSubmission: true, blocking: true,
        content: "Your project process should automate {step:q5}.",
      },
    ],
  };
}

function finalLessonWithGate() {
  return {
    key: "final-project", title: "Final Project", keyConcepts: [], selfCheckQuestions: [],
    blocks: [
      { id: "teach6", order: 1, blockType: "teach", contentVersion: 1, concepts: [], role: "explanation", content: "Build your tool." },
      {
        id: "b6-3", order: 2, blockType: "teach_back", contentVersion: 1, concepts: [],
        prompt: "You told us this about {step:q6}. What changed?",
        dimensionKey: "comprehension", evaluatesConcepts: [],
      },
    ],
  };
}

function lessonWithoutTokens() {
  return {
    key: "lesson-2", title: "Lesson 2", keyConcepts: [], selfCheckQuestions: [],
    blocks: [{ id: "teach2", order: 1, blockType: "teach", contentVersion: 1, concepts: [], role: "explanation", content: "No tokens here." }],
  };
}

function access(): PlayerAccess {
  return {
    socioId: "socio-a", collectionKey: "ai-essentials", organizationId: "org-a",
    programVersionId: "pv-a", programVersion: "1.1.2", enrollmentId: "enrollment-a",
    introMessage: null, language: "en",
    config: {},
  } as unknown as PlayerAccess;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectionRequired.mockResolvedValue(false);
  mocks.diagnosticAttemptCount.mockResolvedValue(1);
  mocks.blockProgressFindMany.mockResolvedValue([]);
  mocks.contentLessonFindMany.mockResolvedValue([
    { slug: "lesson-1", orderIndex: 0, versions: [{ body: lessonWithSurvey() }] },
    { slug: "lesson-2", orderIndex: 1, versions: [{ body: lessonWithoutTokens() }] },
    { slug: "final-project", orderIndex: 2, versions: [{ body: finalLessonWithGate() }] },
  ]);
});

describe("cross-lesson substitution — resolved answer", () => {
  it("substitutes {step:q5} in a project block with block 0.2's stored answer", async () => {
    mocks.blockProgressFindFirst.mockResolvedValue({ response: { tediousTask: "filing expense reports" } });

    const dto = await getLessonDto(access(), "lesson-1");
    const block = dto.lesson.blocks.find((b) => b.id === "b1-11") as { content: string };

    expect(block.content).toBe("Your project process should automate filing expense reports.");
    expect(mocks.blockProgressFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { enrollmentId: "enrollment-a", blockId: "b0-2" },
    }));
  });

  it("substitutes {step:q6} in a teach_back block's prompt (a different lesson than the survey)", async () => {
    mocks.blockProgressFindFirst.mockResolvedValue({ response: { careerBelief: "AI would replace most jobs" } });

    const dto = await getLessonDto(access(), "final-project");
    const block = dto.lesson.blocks.find((b) => b.id === "b6-3") as { prompt: string };

    expect(block.prompt).toBe("You told us this about AI would replace most jobs. What changed?");
  });

  it("does not query cross-lesson answers for a lesson with no tokens", async () => {
    await getLessonDto(access(), "lesson-2");
    expect(mocks.blockProgressFindFirst).not.toHaveBeenCalled();
  });
});

describe("cross-lesson substitution — missing-answer fallback", () => {
  it("falls back to natural phrasing, never a raw token or empty string, when the survey was never submitted", async () => {
    mocks.blockProgressFindFirst.mockResolvedValue(null);

    const dto = await getLessonDto(access(), "lesson-1");
    const block = dto.lesson.blocks.find((b) => b.id === "b1-11") as { content: string };

    expect(block.content).not.toContain("{step:");
    expect(block.content).toBe("Your project process should automate the repetitive task you had in mind.");
  });

  it("falls back correctly on the teach_back path too", async () => {
    mocks.blockProgressFindFirst.mockResolvedValue(null);

    const dto = await getLessonDto(access(), "final-project");
    const block = dto.lesson.blocks.find((b) => b.id === "b6-3") as { prompt: string };

    expect(block.prompt).not.toContain("{step:");
    expect(block.prompt).toBe("You told us this about what you believed about AI's effect on your career. What changed?");
  });

  it("falls back when the answer was stored as a blank/whitespace-only string", async () => {
    mocks.blockProgressFindFirst.mockResolvedValue({ response: { tediousTask: "   " } });

    const dto = await getLessonDto(access(), "lesson-1");
    const block = dto.lesson.blocks.find((b) => b.id === "b1-11") as { content: string };

    expect(block.content).not.toContain("{step:");
    expect(block.content).toBe("Your project process should automate the repetitive task you had in mind.");
  });
});
