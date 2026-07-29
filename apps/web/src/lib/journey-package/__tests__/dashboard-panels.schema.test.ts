/**
 * Journey Package Schema — dashboard panel validation
 * ----------------------------------------------------------------------------
 * Panels are course configuration, so the schema is what stops a course from
 * declaring a panel it has no data for. These tests pin the cross-reference
 * rule (a charted dimension must be tracked) and the duplicate rule.
 */
import { describe, it, expect } from "vitest";
import {
  journeyPackageSchema,
  SCHEMA_VERSION,
  type JourneyPackageInput,
} from "../journey-package.schema";

function makeBasePackage(overrides?: Partial<JourneyPackageInput>): JourneyPackageInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      packageId: "test-pkg",
      title: "Test Package",
      languages: ["en"],
      version: "1.0.0",
    },
    config: {
      trackedDimensions: [
        {
          key: "comprehension",
          label: "Comprehension",
          category: "comprehension",
          primary: true,
          scale: { min: 0, max: 10 },
          calibrationMode: "zero_start",
        },
      ],
      alertRules: [],
    },
    curriculum: {
      collectionKey: "test-collection",
      lessons: [
        {
          key: "lesson-1",
          title: "Test Lesson",
          keyConcepts: ["concept 1"],
          selfCheckQuestions: [],
          blocks: [
            { id: "b1", order: 1, blockType: "teach", role: "explanation", content: "Test content" },
          ],
        },
      ],
    },
    ...overrides,
  };
}

/** Builds a package whose config carries the given dashboard panels. */
function withPanels(panels: unknown[]): JourneyPackageInput {
  const base = makeBasePackage();
  return {
    ...base,
    config: {
      ...base.config,
      dashboard: { panels },
    },
  } as JourneyPackageInput;
}

describe("Journey Package Schema — dashboard panels", () => {
  it("accepts a package that declares no dashboard config", () => {
    const result = journeyPackageSchema.safeParse(makeBasePackage());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config.dashboard).toBeUndefined();
    }
  });

  it("accepts a trend for a tracked dimension", () => {
    const result = journeyPackageSchema.safeParse(
      withPanels([{ type: "dimension_trend", dimensionKey: "comprehension" }]),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a trend for a dimension that is not tracked", () => {
    const result = journeyPackageSchema.safeParse(
      withPanels([{ type: "dimension_trend", dimensionKey: "revenue" }]),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('unknown dimension "revenue"'))).toBe(
        true,
      );
    }
  });

  it("rejects duplicate trends for the same dimension", () => {
    const result = journeyPackageSchema.safeParse(
      withPanels([
        { type: "dimension_trend", dimensionKey: "comprehension" },
        { type: "dimension_trend", dimensionKey: "comprehension" },
      ]),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("duplicates an earlier trend"))).toBe(
        true,
      );
    }
  });

  it("rejects a repeated singleton panel", () => {
    const result = journeyPackageSchema.safeParse(
      withPanels([{ type: "weekly_summary" }, { type: "weekly_summary" }]),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message.includes('duplicates an earlier "weekly_summary"')),
      ).toBe(true);
    }
  });

  it("allows distinct trends alongside singleton panels, preserving order", () => {
    const base = makeBasePackage();
    const pkg = {
      ...base,
      config: {
        ...base.config,
        trackedDimensions: [
          ...base.config!.trackedDimensions!,
          {
            key: "revenue",
            label: "Revenue",
            category: "metric",
            primary: false,
            scale: { min: 0, max: 1000 },
            calibrationMode: "zero_start",
          },
        ],
        dashboard: {
          panels: [
            { type: "lesson_progress" },
            { type: "dimension_trend", dimensionKey: "comprehension" },
            { type: "dimension_trend", dimensionKey: "revenue" },
          ],
        },
      },
    } as JourneyPackageInput;

    const result = journeyPackageSchema.safeParse(pkg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config.dashboard?.panels.map((p) => p.type)).toEqual([
        "lesson_progress",
        "dimension_trend",
        "dimension_trend",
      ]);
    }
  });

  it("rejects an unknown panel type", () => {
    const result = journeyPackageSchema.safeParse(withPanels([{ type: "revenue_forecast" }]));
    expect(result.success).toBe(false);
  });
});
