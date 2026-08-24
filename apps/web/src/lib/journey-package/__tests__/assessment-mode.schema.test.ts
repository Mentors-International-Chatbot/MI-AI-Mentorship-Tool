/**
 * `config.assessment.showScoreToLearner` — B.2
 * ----------------------------------------------------------------------------
 * Investigation report §5 item 14. Package-level default only — a block's own
 * `assessment.showScoreToLearner` can override it per block (see
 * `blockAssessmentOverride.schema.test.ts` for the per-block half).
 *
 * `mode` (reteach_gate/web_quiz) does NOT live here: per the resolved design,
 * it is per-block authoring (a course can mix reteach-style gating in one
 * lesson with a plain graded checkpoint in another), not a one-per-course
 * package switch. See `blockAssessmentOverrideSchema` in
 * `journey-package.schema.ts` and its tests.
 *
 * `program-version-config.schema.ts` defines `assessment` independently (not
 * imported from `journey-package.schema.ts`), so both copies are exercised
 * here to keep them honest against drift.
 */
import { describe, it, expect } from "vitest";
import { configSchema } from "../journey-package.schema";
import { programVersionConfigSchema } from "../program-version-config.schema";

const basePassing = { dimensionKey: "comprehension", threshold: 7 };

describe("configSchema — config.assessment.showScoreToLearner", () => {
  it("regression guard: an assessment object with no showScoreToLearner still parses, defaulting it", () => {
    const parsed = configSchema.parse({
      trackedDimensions: [],
      alertRules: [],
      assessment: {
        passing: basePassing,
        blocking: true,
        allowRetake: true,
      },
    });

    expect(parsed.assessment?.showScoreToLearner).toBe(false);
    // Untouched existing fields still resolve as before.
    expect(parsed.assessment?.blocking).toBe(true);
    expect(parsed.assessment?.allowRetake).toBe(true);
    // mode is not a config.assessment field.
    expect(parsed.assessment).not.toHaveProperty("mode");
  });

  it.each([true, false])("accepts showScoreToLearner=%s", (value) => {
    const parsed = configSchema.parse({
      trackedDimensions: [],
      alertRules: [],
      assessment: { passing: basePassing, showScoreToLearner: value },
    });
    expect(parsed.assessment?.showScoreToLearner).toBe(value);
  });

  it("defaults showScoreToLearner to false when omitted", () => {
    const parsed = configSchema.parse({
      trackedDimensions: [],
      alertRules: [],
      assessment: { passing: basePassing },
    });
    expect(parsed.assessment?.showScoreToLearner).toBe(false);
  });
});

describe("programVersionConfigSchema — mirrored config.assessment.showScoreToLearner", () => {
  it("regression guard: an assessment object with no showScoreToLearner still parses, defaulting it", () => {
    const parsed = programVersionConfigSchema.parse({
      assessment: {
        passing: basePassing,
        blocking: true,
        allowRetake: true,
      },
    });

    expect(parsed.assessment?.showScoreToLearner).toBe(false);
    expect(parsed.assessment).not.toHaveProperty("mode");
  });

  it.each([true, false])("accepts showScoreToLearner=%s", (value) => {
    const parsed = programVersionConfigSchema.parse({
      assessment: { passing: basePassing, showScoreToLearner: value },
    });
    expect(parsed.assessment?.showScoreToLearner).toBe(value);
  });

  it("defaults showScoreToLearner to false when omitted", () => {
    const parsed = programVersionConfigSchema.parse({
      assessment: { passing: basePassing },
    });
    expect(parsed.assessment?.showScoreToLearner).toBe(false);
  });
});
