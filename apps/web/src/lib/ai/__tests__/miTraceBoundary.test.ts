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
  resolveLearnerDelivery: vi.fn(),
  playerProgramVersion: vi.fn(),
  playerMessages: vi.fn(),
  playerTutorGrounding: vi.fn(),
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

vi.mock("@/lib/courses/deliverySurface", () => ({
  resolveLearnerDelivery: mocks.resolveLearnerDelivery,
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    programVersion: { findFirst: mocks.playerProgramVersion },
    message: { findFirst: vi.fn(), findMany: mocks.playerMessages },
  },
}));

vi.mock("@/lib/player/service", () => ({
  playerTutorGrounding: mocks.playerTutorGrounding,
}));

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
    mocks.resolveLearnerDelivery.mockResolvedValue({ surface: "chat", supportedChannels: ["web", "whatsapp"] });
    mocks.playerMessages.mockResolvedValue([]);
    mocks.playerTutorGrounding.mockResolvedValue("Verified player block");
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

  it("never calls the chat router for a metadata-verified player turn", async () => {
    mocks.playerProgramVersion.mockResolvedValue({
      config: {},
      metadata: { delivery: { surface: "player", supportedChannels: ["web"] } },
      program: { organizationId: "org-1" },
    });
    // Long enough to clear DEFAULT_RESPONSE_STYLE's character floor on the
    // first attempt — this test is about the MI/player routing boundary, not
    // the repair loop, so the fixture must not trigger one incidentally.
    mocks.chatInvoke.mockResolvedValue({ content: "That's a common daily task, and it's worth looking at closely. Repeating the same steps by hand every day is exactly the kind of work worth automating first. Think about which part takes the most time so we can focus there." });

    const result = await generateAIResponse(
      { ...socio, channelType: "web", curriculumCollectionKey: "skills-tool-calls" },
      "I run a small shop and repeat this task every day.",
      "skills-tool-calls",
      {},
      undefined,
      {
        learnerText: "I run a small shop and repeat this task every day.",
        context: {
          surface: "player",
          courseCode: "SKILLS",
          collectionKey: "skills-tool-calls",
          programVersionId: "pv-skills",
          enrollmentId: "enrollment-skills-1",
          lessonKey: "skills-and-tool-calls",
          blockId: "stc-01",
          intent: "question",
        },
      },
    );

    expect(mocks.determineMode).not.toHaveBeenCalled();
    expect(mocks.buildSystemPrompt).not.toHaveBeenCalled();
    expect(result.mode).toBe("question");
    expect(result.determineModeResult).toBeUndefined();
    expect(mocks.playerTutorGrounding).toHaveBeenCalledTimes(1);
    expect(mocks.invokeTraced).toHaveBeenCalledTimes(1);
    expect(mocks.invokeTraced.mock.calls[0][0]).toMatchObject({
      mode: "question",
      context: { surface: "player", intent: "question", courseCode: "SKILLS" },
    });
  });

  it("rejects a player-surface course before the chat router when player context is absent", async () => {
    mocks.resolveLearnerDelivery.mockResolvedValue({ surface: "player", supportedChannels: ["web"] });

    await expect(generateAIResponse(
      { ...socio, channelType: "web", curriculumCollectionKey: "skills-tool-calls" },
      "Hello",
      "skills-tool-calls",
      {},
    )).rejects.toThrow("Chat curriculum routing rejected for player-surface course skills-tool-calls");

    expect(mocks.determineMode).not.toHaveBeenCalled();
    expect(mocks.buildSystemPrompt).not.toHaveBeenCalled();
    expect(mocks.chatInvoke).not.toHaveBeenCalled();
  });
});
