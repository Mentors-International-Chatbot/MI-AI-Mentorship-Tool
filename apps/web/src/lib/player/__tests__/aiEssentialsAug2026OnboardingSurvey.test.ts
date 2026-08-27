/**
 * E.6.1: block 0.2 (the onboarding survey), authored against the real
 * ai-essentials-aug2026-package.ts content, walked end to end through all
 * seven steps via completeBlock — mirroring completeBlockOnboardingSurvey.test.ts's
 * mocking pattern, but against the actual authored steps/closingMessage
 * rather than a synthetic fixture.
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
import { aiEssentialsAug2026Package } from "@/lib/journey-package/examples/ai-essentials-aug2026-package";
import { journeyPackageSchema } from "@/lib/journey-package/journey-package.schema";

const parsedPackage = journeyPackageSchema.parse(aiEssentialsAug2026Package);
const lesson1 = parsedPackage.curriculum.lessons.find((l) => l.key === "lesson-1")!;
const surveyBlockRaw = lesson1.blocks.find((b) => b.id === "b0-2")!;
if (surveyBlockRaw.blockType !== "onboarding_survey") throw new Error("fixture drift: b0-2 is no longer onboarding_survey");
const surveyBlock = surveyBlockRaw;

const ANSWERS = ["Ada", "Computer Science, junior", "ML engineer", "regularly", "filing expense reports", "it'll displace a lot of entry-level work", "3"];

function access(): PlayerAccess {
  return {
    socioId: "socio-a", collectionKey: "ai-essentials-aug2026", organizationId: "org-a",
    programVersionId: "pv-a", programVersion: "2026.8", enrollmentId: "enrollment-a",
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
    { slug: "lesson-1", orderIndex: 0, versions: [{ body: lesson1 }] },
  ]);
});

describe("block 0.2 (onboarding_survey), authored content, end to end", () => {
  it("has exactly 7 steps matching the source doc's questions", () => {
    expect(surveyBlock.steps).toHaveLength(7);
    expect(surveyBlock.steps.map((s) => s.id)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7"]);
  });

  it("walks all 7 steps, completing on the last with the closing message reflecting Q5 back", async () => {
    let priorResponse: Record<string, unknown> | null = null;
    let result;
    for (let i = 0; i < ANSWERS.length; i++) {
      mocks.blockProgressFindUnique.mockResolvedValue(
        priorResponse ? { contentVersion: 1, completedAt: null, response: priorResponse, state: null } : null,
      );
      result = await completeBlock(access(), "lesson-1", "b0-2", ANSWERS[i]);
      if (i < ANSWERS.length - 1) {
        expect(result.completed).toBe(false);
        priorResponse = { ...(priorResponse ?? {}), [surveyBlock.steps[i].field]: ANSWERS[i] };
      }
    }

    expect(result!.completed).toBe(true);
    expect(result!.feedback).toEqual({
      kind: "onboarding_survey",
      closingMessage: "Got it — so the process your final project will automate is: filing expense reports. Keep that in mind as you go.",
    });
  });
});
