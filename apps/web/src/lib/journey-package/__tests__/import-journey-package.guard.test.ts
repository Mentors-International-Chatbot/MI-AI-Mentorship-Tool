/**
 * importJourneyPackage — published-version immutability guard
 * ----------------------------------------------------------------------------
 * The ProgramVersion upsert's `update` branch preserves `status`, so without
 * this guard a re-import at a published version's string would leave the row
 * published while swapping in a config that never passed validateForPublication.
 * These tests pin that only a draft may be overwritten.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  contentCollection: {
    upsert: vi.fn(),
  },
  contentLesson: {
    upsert: vi.fn(),
  },
  lessonVersion: {
    upsert: vi.fn(),
  },
  programVersion: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  organization: {
    findUnique: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

// Import AFTER mocking
import { importJourneyPackage } from "../import-journey-package";
import { journeyPackageSchema, SCHEMA_VERSION } from "../journey-package.schema";

const COLLECTION_ID = "coll-0000-0000-0000-000000000001";
const LESSON_ID = "less-0000-0000-0000-000000000001";
const PROGRAM_ID = "prog-0000-0000-0000-000000000001";
const ORG_ID = "org-0000-0000-0000-000000000001";
const VERSION = "1.0.0";

/** Minimal package that parses cleanly — one lesson, one teach block. */
const pkg = journeyPackageSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  metadata: {
    packageId: "guard-test",
    title: "Guard Test",
    languages: ["en"],
    version: VERSION,
  },
  config: {
    trackedDimensions: [],
    alertRules: [],
  },
  curriculum: {
    collectionKey: "guard-test-collection",
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

function runImport() {
  return importJourneyPackage(pkg, {
    organizationId: ORG_ID,
    programId: PROGRAM_ID,
    importedBy: "test",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.contentCollection.upsert.mockResolvedValue({ id: COLLECTION_ID });
  mockPrisma.contentLesson.upsert.mockResolvedValue({ id: LESSON_ID });
  mockPrisma.lessonVersion.upsert.mockResolvedValue({ id: "lv-1" });
  mockPrisma.programVersion.upsert.mockResolvedValue({ id: "pv-1" });
  mockPrisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
});

describe("importJourneyPackage — non-draft versions are immutable", () => {
  it("throws when a published version already exists at that (programId, version)", async () => {
    mockPrisma.programVersion.findUnique.mockResolvedValue({ status: "published" });

    await expect(runImport()).rejects.toThrow(
      /Refusing to import over ProgramVersion "1\.0\.0": it is published, not draft/,
    );
  });

  it("names the version and tells the author to bump metadata.version", async () => {
    mockPrisma.programVersion.findUnique.mockResolvedValue({ status: "published" });

    await expect(runImport()).rejects.toThrow(/Bump metadata\.version/);
  });

  it("does not write the ProgramVersion when it refuses", async () => {
    mockPrisma.programVersion.findUnique.mockResolvedValue({ status: "published" });

    await expect(runImport()).rejects.toThrow();
    expect(mockPrisma.programVersion.upsert).not.toHaveBeenCalled();
  });

  it("refuses before touching the ContentCollection", async () => {
    // The import is not transactional, so the guard has to run before the very
    // first write — otherwise a refused import still rewrites the collection.
    mockPrisma.programVersion.findUnique.mockResolvedValue({ status: "published" });

    await expect(runImport()).rejects.toThrow();
    expect(mockPrisma.contentCollection.upsert).not.toHaveBeenCalled();
  });

  it("refuses before rewriting any lesson body", async () => {
    // LessonVersion's update branch rewrites title and body with no status
    // check of its own — a late guard would corrupt published lesson content.
    mockPrisma.programVersion.findUnique.mockResolvedValue({ status: "published" });

    await expect(runImport()).rejects.toThrow();
    expect(mockPrisma.contentLesson.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.lessonVersion.upsert).not.toHaveBeenCalled();
  });

  it("writes nothing at all on refusal", async () => {
    mockPrisma.programVersion.findUnique.mockResolvedValue({ status: "archived" });

    await expect(runImport()).rejects.toThrow();
    for (const [name, model] of Object.entries(mockPrisma)) {
      const writes = Object.entries(model).filter(([method]) => method !== "findUnique");
      for (const [method, fn] of writes) {
        expect(
          (fn as { mock: { calls: unknown[] } }).mock.calls,
          `${name}.${method} should not have been called`,
        ).toHaveLength(0);
      }
    }
  });

  it("throws on an archived version too — archived is released history", async () => {
    mockPrisma.programVersion.findUnique.mockResolvedValue({ status: "archived" });

    await expect(runImport()).rejects.toThrow(/it is archived, not draft/);
  });

  it("proceeds when the existing version is a draft", async () => {
    mockPrisma.programVersion.findUnique.mockResolvedValue({ status: "draft" });

    const result = await runImport();

    expect(result.success).toBe(true);
    expect(mockPrisma.programVersion.upsert).toHaveBeenCalledTimes(1);
  });

  it("proceeds when no version row exists yet", async () => {
    mockPrisma.programVersion.findUnique.mockResolvedValue(null);

    const result = await runImport();

    expect(result.success).toBe(true);
    expect(mockPrisma.programVersion.upsert).toHaveBeenCalledTimes(1);
  });

  it("checks the guard against the exact (programId, version) pair", async () => {
    mockPrisma.programVersion.findUnique.mockResolvedValue(null);

    await runImport();

    expect(mockPrisma.programVersion.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { programId_version: { programId: PROGRAM_ID, version: VERSION } },
      }),
    );
  });
});
