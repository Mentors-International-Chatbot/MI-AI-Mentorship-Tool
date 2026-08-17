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
  config: programVersionConfigSchema.parse({
    projectSelection: {
      presets: [{ key: "brief", family: "routine", label: "Brief", defaultLevel: "L1", exampleContexts: ["Class"] }],
      interestTopics: [
        { key: "one", label: "One", dimensions: ["working_with_ai"], presetAffinity: ["brief"] },
        { key: "two", label: "Two", dimensions: ["how_ai_works"], presetAffinity: ["brief"] },
      ],
    },
    onboarding: { mode: "baseline_quiz" as const, steps: [] },
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
});
