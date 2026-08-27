/**
 * importJourneyPackage builds ProgramVersion.config from an explicit
 * field-by-field copy of pkg.config (not a spread), so a new optional field
 * added to configSchema/program-version-config.schema.ts is silently dropped
 * on import until it's also added to that copy list — three places to keep
 * in sync, nothing enforcing it. Confirmed the hard way: progressPanel
 * (decoupling the lesson-sidebar panel from projectSelection) shipped in
 * both schemas, validated cleanly, and still didn't reach the DB until this
 * third spot was found by directly checking the published config. This pins
 * that field specifically so it can't silently regress, and is a template
 * for pinning the next one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  contentCollection: { upsert: vi.fn() },
  contentLesson: { upsert: vi.fn() },
  lessonVersion: { upsert: vi.fn() },
  programVersion: { findUnique: vi.fn(), upsert: vi.fn() },
  organization: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { importJourneyPackage } from "../import-journey-package";
import { journeyPackageSchema, SCHEMA_VERSION } from "../journey-package.schema";

const pkg = journeyPackageSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  metadata: {
    packageId: "config-mapping-test",
    title: "Config Mapping Test",
    languages: ["en"],
    version: "1.0.0",
  },
  config: {
    trackedDimensions: [],
    alertRules: [],
    progressPanel: { enabled: true },
  },
  curriculum: {
    collectionKey: "config-mapping-test-collection",
    lessons: [
      {
        key: "lesson-1",
        title: "Lesson 1",
        keyConcepts: ["concept"],
        selfCheckQuestions: [],
        blocks: [
          { id: "b1", order: 1, blockType: "teach", role: "explanation", content: "Body" },
        ],
      },
    ],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.programVersion.findUnique.mockResolvedValue(null);
  mockPrisma.contentCollection.upsert.mockResolvedValue({ id: "coll-1" });
  mockPrisma.contentLesson.upsert.mockResolvedValue({ id: "lesson-1" });
  mockPrisma.lessonVersion.upsert.mockResolvedValue({ id: "lv-1" });
  mockPrisma.programVersion.upsert.mockResolvedValue({ id: "pv-1" });
  mockPrisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
});

describe("importJourneyPackage — progressPanel reaches ProgramVersion.config", () => {
  it("carries progressPanel.enabled through to the upserted config", async () => {
    await importJourneyPackage(pkg, {
      organizationId: "org-1",
      programId: "prog-1",
      importedBy: "test",
    });

    const call = mockPrisma.programVersion.upsert.mock.calls[0][0];
    expect(call.create.config.progressPanel).toEqual({ enabled: true });
  });
});
