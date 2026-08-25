import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  learnerProjectSelectionRequired: vi.fn(),
  diagnosticAttemptCount: vi.fn(),
  contentLessonFindMany: vi.fn(),
  blockProgressFindMany: vi.fn(),
}));

vi.mock("../learnerProject", () => ({
  learnerProjectSelectionRequired: mocks.learnerProjectSelectionRequired,
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    diagnosticAttempt: { count: mocks.diagnosticAttemptCount },
    contentLesson: { findMany: mocks.contentLessonFindMany },
    blockProgress: { findMany: mocks.blockProgressFindMany },
  },
}));

import { getLessonDto, type PlayerAccess } from "../service";
import { programVersionConfigSchema } from "@/lib/journey-package/program-version-config.schema";

const access = {
  socioId: "learner-1",
  courseCode: "AIESS",
  collectionKey: "ai-essentials",
  organizationId: "org-1",
  programVersionId: "version-1",
  programVersion: "2.0.0",
  enrollmentId: "enrollment-1",
  introMessage: null,
  language: "en",
  config: programVersionConfigSchema.parse({
    projectSelection: {
      presets: [{ key: "brief", family: "routine", label: "Brief", defaultLevel: "L1", exampleContexts: ["Class"] }],
      interestTopics: [
        { key: "one", label: "One", dimensions: ["working_with_ai"], presetAffinity: ["brief"] },
        { key: "two", label: "Two", dimensions: ["how_ai_works"], presetAffinity: ["brief"] },
      ],
    },
    // E.3.5 finding 5: diagnosticRequired now gates on `diagnostic`'s own
    // presence, not `mode` — this fixture needs an actual diagnostic to keep
    // exercising the diagnostic_required path below under the new semantics.
    onboarding: {
      mode: "baseline_quiz" as const,
      steps: [],
      diagnostic: {
        id: "diag1", title: "Diagnostic", threshold: 0.7,
        questions: [{ id: "q1", prompt: "Test?", format: "multiple_choice" as const, options: ["A", "B"], answerKey: "A", explanation: "Because.", graded: true }],
      },
    },
  }),
} satisfies PlayerAccess;

describe("direct lesson prerequisite ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws project_required before diagnostic_required", async () => {
    mocks.learnerProjectSelectionRequired.mockResolvedValue(true);
    mocks.diagnosticAttemptCount.mockResolvedValue(0);

    await expect(getLessonDto(access, "lesson-one")).rejects.toMatchObject({
      status: 403,
      code: "project_required",
    });
    expect(mocks.diagnosticAttemptCount).not.toHaveBeenCalled();
  });

  it("preserves diagnostic_required after the project prerequisite is satisfied", async () => {
    mocks.learnerProjectSelectionRequired.mockResolvedValue(false);
    mocks.diagnosticAttemptCount.mockResolvedValue(0);

    await expect(getLessonDto(access, "lesson-one")).rejects.toMatchObject({
      status: 403,
      code: "diagnostic_required",
    });
  });

  // E.3.5 finding 5: the actual regression this fix targets. `mode` used to
  // be the sole gate; now a course can have `diagnostic` populated under any
  // (or no) `mode` — e.g. once onboarding_survey blocks make `mode: "survey"`
  // a real, separate player-surface possibility — and the diagnostic gate
  // must still fire.
  it("gates on the diagnostic's own presence, not on mode: 'baseline_quiz' specifically", async () => {
    mocks.learnerProjectSelectionRequired.mockResolvedValue(false);
    mocks.diagnosticAttemptCount.mockResolvedValue(0);
    const accessWithoutBaselineQuizMode = {
      ...access,
      config: programVersionConfigSchema.parse({
        ...access.config,
        onboarding: {
          mode: "skip" as const,
          steps: [],
          diagnostic: {
            id: "diag1", title: "Diagnostic", threshold: 0.7,
            questions: [{ id: "q1", prompt: "Test?", format: "multiple_choice" as const, options: ["A", "B"], answerKey: "A", explanation: "Because.", graded: true }],
          },
        },
      }),
    };

    await expect(getLessonDto(accessWithoutBaselineQuizMode, "lesson-one")).rejects.toMatchObject({
      status: 403,
      code: "diagnostic_required",
    });
  });
});
