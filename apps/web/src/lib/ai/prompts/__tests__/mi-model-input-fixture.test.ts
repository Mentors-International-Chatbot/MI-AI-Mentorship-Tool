import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseMeta } from "@/lib/courses/course-meta";
import type { Socio, SocioContext, SocioFlag, SystemPrompt } from "@/lib/repo/types";
import type { DimensionStateMap } from "@/lib/ai/sensing/types";
import { assembleOrderedModelMessages } from "@/lib/ai/modelMessages";
import { buildSystemPrompt } from "../builder";
import { InteractionMode, type RouterResult, type SocioProgress } from "../types";

const mocks = vi.hoisted(() => ({
  getCourseMeta: vi.fn(),
  getSocioContext: vi.fn(),
  getLessonTitle: vi.fn(),
  getLessonCount: vi.fn(),
  hasLessonData: vi.fn(),
  getLessonData: vi.fn(),
  getActivePromptCached: vi.fn(),
  resolvePromptScope: vi.fn(),
  resolveCourseAiBehavior: vi.fn(),
}));

vi.mock("@/lib/courses/course-meta", () => ({
  getCourseMeta: mocks.getCourseMeta,
  resolveLocalized: (value: Record<string, string>, language = "en") =>
    value[language] ?? value.en,
}));

vi.mock("@/lib/repo", () => ({
  repo: { getSocioContext: mocks.getSocioContext },
}));

vi.mock("@/lib/lessons/db-lesson-service", () => ({
  getLessonTitle: mocks.getLessonTitle,
  getLessonCount: mocks.getLessonCount,
  hasLessonData: mocks.hasLessonData,
  getLessonData: mocks.getLessonData,
}));

vi.mock("../activePromptCache", () => ({
  getActivePromptCached: mocks.getActivePromptCached,
}));

vi.mock("../resolveScope", () => ({
  resolvePromptScope: mocks.resolvePromptScope,
}));

vi.mock("../courseBehavior", async () => {
  const actual = await vi.importActual<typeof import("../courseBehavior")>("../courseBehavior");
  return { ...actual, resolveCourseAiBehavior: mocks.resolveCourseAiBehavior };
});

type FrozenPrompt = Omit<SystemPrompt, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

type Fixture = {
  collectionKey: string;
  scope: { organizationId: string; collectionKey: string };
  courseMeta: CourseMeta;
  courseBehavior: {
    tone: string;
    teachingStyle: string;
    languageInstruction: string;
    primaryLang: string;
  };
  lessonTitles: Record<string, string>;
  lessonCount: number;
  activePrompts: Record<string, FrozenPrompt>;
  socio: Omit<Socio, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
  socioContext: SocioContext;
  progress: SocioProgress;
  routerResult: RouterResult;
  dimensionState: DimensionStateMap;
  activeFlags: SocioFlag[];
  gateRecency: {
    lessonNumber: number;
    outcome: "passed" | "not_passed";
    justResolved: boolean;
  };
  history: Array<{ role: string; content: string }>;
  incomingText: string;
  promptVersions: Record<string, string>;
  systemPrompt: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string | { fixtureRef: "systemPrompt" };
  }>;
};

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../__fixtures__/mi-model-input.json"), "utf8"),
) as Fixture;

describe("frozen MI model input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCourseMeta.mockResolvedValue(fixture.courseMeta);
    mocks.getSocioContext.mockResolvedValue(fixture.socioContext);
    mocks.getLessonTitle.mockImplementation((_: string, lessonNumber: number) =>
      fixture.lessonTitles[String(lessonNumber)] ?? `Lección ${lessonNumber}`,
    );
    mocks.getLessonCount.mockReturnValue(fixture.lessonCount);
    mocks.hasLessonData.mockImplementation(
      (_: string, lessonNumber: number) => lessonNumber <= fixture.lessonCount,
    );
    mocks.getLessonData.mockReturnValue(undefined);
    mocks.resolvePromptScope.mockResolvedValue(fixture.scope);
    mocks.resolveCourseAiBehavior.mockResolvedValue(fixture.courseBehavior);
    mocks.getActivePromptCached.mockImplementation((category: string) => {
      const prompt = fixture.activePrompts[category];
      return prompt
        ? {
            ...prompt,
            createdAt: new Date(prompt.createdAt),
            updatedAt: new Date(prompt.updatedAt),
          }
        : null;
    });
  });

  it("keeps the real four-layer prompt and ordered messages byte-identical", async () => {
    const sink: Record<string, string> = {};
    const socio: Socio = {
      ...fixture.socio,
      createdAt: new Date(fixture.socio.createdAt),
      updatedAt: new Date(fixture.socio.updatedAt),
    };
    const routerResult: RouterResult = {
      ...fixture.routerResult,
      mode: InteractionMode.LESSON_DELIVERY,
    };

    const systemPrompt = await buildSystemPrompt(
      socio,
      routerResult,
      fixture.progress,
      fixture.collectionKey,
      fixture.dimensionState,
      sink,
      fixture.activeFlags,
      undefined,
      fixture.gateRecency,
    );

    expect(systemPrompt).toBe(fixture.systemPrompt);
    expect(sink).toEqual(fixture.promptVersions);
    const expectedMessages = fixture.messages.map((message) => ({
      role: message.role,
      content:
        typeof message.content === "string" ? message.content : fixture.systemPrompt,
    }));
    expect(
      assembleOrderedModelMessages(systemPrompt, fixture.history, fixture.incomingText),
    ).toEqual(expectedMessages);
  });
});
