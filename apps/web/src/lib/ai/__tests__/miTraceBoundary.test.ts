import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Socio, SocioProgress } from "@/lib/repo/types";

const mocks = vi.hoisted(() => ({
  getSocioProgress: vi.fn(),
  getMessages: vi.fn(),
  determineMode: vi.fn(),
  buildSystemPrompt: vi.fn(),
  resolveAnalysisPolicy: vi.fn(),
  chatInvoke: vi.fn(),
  invokeTraced: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/repo", () => ({
  repo: {
    getSocioProgress: mocks.getSocioProgress,
    getMessages: mocks.getMessages,
  },
}));

vi.mock("@/lib/ai/prompts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/prompts")>("@/lib/ai/prompts");
  return {
    ...actual,
    determineMode: mocks.determineMode,
    buildSystemPrompt: mocks.buildSystemPrompt,
  };
});

vi.mock("@/lib/ai/analysisPolicy", () => ({
  resolveAnalysisPolicy: mocks.resolveAnalysisPolicy,
}));

vi.mock("@/lib/ai/openrouter", () => ({
  createOpenRouterChat: () => ({ invoke: mocks.chatInvoke }),
  resolveOpenRouterModel: () => "mi-model",
}));

vi.mock("@/lib/ai/trace/invokeTraced", () => ({
  invokeTraced: mocks.invokeTraced,
}));

vi.mock("@/lib/logging/logger", () => ({ logEvent: mocks.logEvent }));

vi.mock("@/lib/ai/prompts/layers/content", () => ({
  getContentIdentity: () => "mi-content-v1",
}));

import { generateAIResponse } from "@/lib/ai/service";
import { InteractionMode } from "@/lib/ai/prompts";

const progress: SocioProgress = {
  id: "progress-1",
  socioId: "mi-socio",
  currentLessonNumber: 1,
  currentMessageIndex: 0,
  completedLessons: [],
  weeklyUnderstanding: null,
  weeklyImplementation: null,
  lastLessonCompletedAt: null,
  remindersSent: 0,
  lastInteractionAt: null,
};

const socio: Socio = {
  id: "mi-socio",
  channelType: "whatsapp",
  externalId: "mi-external",
  language: "es",
  name: "Learner",
  status: "ACTIVE",
  aiPaused: false,
  curriculumCollectionKey: "mi-colombia-curriculum",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("MI lesson-delivery trace boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSocioProgress.mockResolvedValue(progress);
    mocks.getMessages.mockResolvedValue([]);
    mocks.determineMode.mockResolvedValue({
      routerResult: { mode: InteractionMode.LESSON_DELIVERY },
      progress,
      repoProgress: progress,
      activeFlags: [],
      reachedMilestoneKeys: new Set<string>(),
      gateRecency: undefined,
    });
    mocks.buildSystemPrompt.mockResolvedValue("Frozen MI system prompt");
    mocks.resolveAnalysisPolicy.mockReturnValue({ sensing: false, sentiment: false, contextExtraction: false });
    mocks.chatInvoke.mockResolvedValue({ content: "Respuesta MI completa." });
    mocks.invokeTraced.mockImplementation(async (params) => params.invoke(() => undefined));
  });

  it("keeps one legacy logical AiInvocation with no v2 player context", async () => {
    await generateAIResponse(
      socio,
      "Continua la leccion",
      "mi-colombia-curriculum",
      {},
    );

    expect(mocks.invokeTraced).toHaveBeenCalledTimes(1);
    expect(mocks.chatInvoke).toHaveBeenCalledTimes(1);
    const trace = mocks.invokeTraced.mock.calls[0][0];
    expect(trace).toMatchObject({
      operation: "lesson_delivery",
      model: "mi-model",
      socioId: "mi-socio",
      systemPrompt: "Frozen MI system prompt",
    });
    expect(trace.context).toBeUndefined();
  });
});
