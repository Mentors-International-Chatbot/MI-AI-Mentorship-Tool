/**
 * E.3.5: onboarding_survey's step progression. Each call to `/complete`
 * submits exactly one step's answer; `gradePlayerBlock` derives the current
 * step index from `Object.keys(priorAnswers).length` (the accumulated
 * response IS the progress marker — no separate counter is persisted). The
 * final step resolves `closingMessage` via `resolveOnboardingClosingMessage`,
 * mirroring `buildWelcomeMessage`'s placeholder-substitution pattern.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contentLessonFindMany: vi.fn(),
  blockProgressFindUnique: vi.fn(),
  blockProgressFindMany: vi.fn(),
  blockProgressUpsert: vi.fn(),
  messageFindFirst: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    contentLesson: { findMany: mocks.contentLessonFindMany },
    blockProgress: {
      findUnique: mocks.blockProgressFindUnique,
      findMany: mocks.blockProgressFindMany,
      upsert: mocks.blockProgressUpsert,
    },
    message: { findFirst: mocks.messageFindFirst },
  },
}));

import { completeBlock } from "@/lib/player/service";
import type { PlayerAccess } from "@/lib/player/service";

const STEPS = [
  { id: "name", prompt: "What's your name?", field: "name" },
  { id: "major", prompt: "What's your major?", field: "major" },
  { id: "tedious", prompt: "What's one tedious task?", field: "tediousTask" },
];

function lessonBody(survey: Record<string, unknown> = {}) {
  return {
    key: "l1", title: "l1", keyConcepts: [], selfCheckQuestions: [],
    blocks: [
      { id: "teach1", order: 1, blockType: "teach", contentVersion: 1, concepts: [], role: "explanation", content: "Some content" },
      { id: "survey1", order: 2, blockType: "onboarding_survey", contentVersion: 1, concepts: [], steps: STEPS, ...survey },
    ],
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
  mocks.blockProgressFindMany.mockResolvedValue([]);
  mocks.blockProgressUpsert.mockResolvedValue({});
  mocks.messageFindFirst.mockResolvedValue(null);
  mocks.contentLessonFindMany.mockResolvedValue([
    { slug: "l1", orderIndex: 0, versions: [{ body: lessonBody() }] },
  ]);
});

describe("completeBlock — onboarding_survey", () => {
  it("leaves the block incomplete after the first step and persists the accumulated answer", async () => {
    mocks.blockProgressFindUnique.mockResolvedValue(null);

    const result = await completeBlock(access(), "l1", "survey1", "Ada");

    expect(result.completed).toBe(false);
    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ completedAt: null, response: { name: "Ada" } }),
    }));
  });

  it("advances to the next step on the second submission, accumulating both answers", async () => {
    mocks.blockProgressFindUnique.mockResolvedValue({
      contentVersion: 1, completedAt: null, response: { name: "Ada" }, state: null,
    });

    const result = await completeBlock(access(), "l1", "survey1", "Computer Science");

    expect(result.completed).toBe(false);
    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ completedAt: null, response: { name: "Ada", major: "Computer Science" } }),
    }));
  });

  it("completes on the final step, storing every answer keyed by field", async () => {
    mocks.blockProgressFindUnique.mockResolvedValue({
      contentVersion: 1, completedAt: null, response: { name: "Ada", major: "Computer Science" }, state: null,
    });

    const result = await completeBlock(access(), "l1", "survey1", "Filing expense reports");

    expect(result.completed).toBe(true);
    expect(result.score).toBeNull();
    expect(mocks.blockProgressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        completedAt: expect.any(Date),
        response: { name: "Ada", major: "Computer Science", tediousTask: "Filing expense reports" },
      }),
    }));
  });

  it("resolves closingMessage on the final step, substituting a prior step's stored answer via {step:<id>}", async () => {
    mocks.contentLessonFindMany.mockResolvedValue([
      { slug: "l1", orderIndex: 0, versions: [{ body: lessonBody({
        closingMessage: { en: "So {step:tedious} is the process your project will automate." },
      }) }] },
    ]);
    mocks.blockProgressFindUnique.mockResolvedValue({
      contentVersion: 1, completedAt: null, response: { name: "Ada", major: "Computer Science" }, state: null,
    });

    const result = await completeBlock(access(), "l1", "survey1", "Filing expense reports");

    expect(result.completed).toBe(true);
    expect(result.feedback).toEqual({
      kind: "onboarding_survey",
      closingMessage: "So Filing expense reports is the process your project will automate.",
    });
    // The closing message is a review moment, same convention as a graded
    // verdict — the learner sees it and explicitly continues.
    expect(result.reviewPending).toBe(true);
  });

  it("rejects an empty answer — every step requires text, no skip", async () => {
    mocks.blockProgressFindUnique.mockResolvedValue(null);

    await expect(completeBlock(access(), "l1", "survey1", "   ")).rejects.toThrow();
  });
});
