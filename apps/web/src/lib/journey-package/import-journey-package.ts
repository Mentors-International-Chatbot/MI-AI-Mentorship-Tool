/**
 * JourneyPackage → Database Import
 * ═══════════════════════════════════════════════════════════════════════════
 * Given a validated JourneyPackage, imports it into database rows:
 *   - ContentCollection (upsert on slug)
 *   - ContentLesson + LessonVersion (upsert on lesson.key)
 *   - ProgramVersion in DRAFT state (upsert on version string)
 *
 * Does NOT auto-publish. Publishing is a separate explicit action.
 * Uses upsert throughout — re-running is safe and idempotent.
 *
 * NOTE: Outcome/Milestone tables don't exist in the current schema.
 *       If pkg.outcome is present, we log a warning and skip it.
 *       TODO: Add Outcome/Milestone models to schema if needed.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/db";
import type { JourneyPackage, PackageLesson } from "./journey-package.schema";
import type { ProgramVersionConfig } from "./program-version-config.schema";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type ImportOptions = {
  /** Organization ID to import into. Required. */
  organizationId: string;
  /** Program ID to attach the version to. Required. */
  programId: string;
  /** Optional user ID for audit trail. */
  importedBy?: string;
  /** If true, also inherit branding/notifications from org settings. */
  inheritOrgSettings?: boolean;
};

export type ImportResult = {
  success: true;
  collectionId: string;
  programVersionId: string;
  lessonsImported: number;
  warnings: string[];
};

// ═══════════════════════════════════════════════════════════════════════════
// Import Function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Imports a validated JourneyPackage into the database.
 *
 * @param pkg - A JourneyPackage that has already passed journeyPackageSchema.safeParse()
 * @param opts - Import options including organizationId and programId
 * @returns ImportResult with IDs and counts
 */
export async function importJourneyPackage(
  pkg: JourneyPackage,
  opts: ImportOptions
): Promise<ImportResult> {
  const warnings: string[] = [];

  // ─── 1. Upsert ContentCollection ─────────────────────────────────────────
  const collection = await prisma.contentCollection.upsert({
    where: {
      organizationId_slug: {
        organizationId: opts.organizationId,
        slug: pkg.curriculum.collectionKey,
      },
    },
    update: {
      name: pkg.metadata.title,
      description: pkg.metadata.description,
    },
    create: {
      organizationId: opts.organizationId,
      slug: pkg.curriculum.collectionKey,
      name: pkg.metadata.title,
      description: pkg.metadata.description,
    },
  });

  // ─── 2. Upsert Lessons + LessonVersions ──────────────────────────────────
  let lessonsImported = 0;

  for (let i = 0; i < pkg.curriculum.lessons.length; i++) {
    const lesson = pkg.curriculum.lessons[i];

    // Upsert the lesson row
    const lessonRow = await prisma.contentLesson.upsert({
      where: {
        collectionId_slug: {
          collectionId: collection.id,
          slug: lesson.key,
        },
      },
      update: {
        orderIndex: i,
      },
      create: {
        collectionId: collection.id,
        slug: lesson.key,
        orderIndex: i,
      },
    });

    // Upsert the lesson version
    // LessonVersion.body = the full lesson object matching lessonSchema
    await prisma.lessonVersion.upsert({
      where: {
        lessonId_version_lang: {
          lessonId: lessonRow.id,
          version: pkg.metadata.version,
          lang: pkg.metadata.languages[0],
        },
      },
      update: {
        title: lesson.title,
        body: lesson as object, // Store the full lesson object
        // Don't update active or publishedAt on re-import — that's publishing's job
      },
      create: {
        lessonId: lessonRow.id,
        version: pkg.metadata.version,
        lang: pkg.metadata.languages[0],
        title: lesson.title,
        body: lesson as object,
        active: false, // Starts inactive; publishing activates it
      },
    });

    lessonsImported++;
  }

  // ─── 3. Build ProgramVersion.config ──────────────────────────────────────
  const config: ProgramVersionConfig = {
    // Per-course fields from package
    terminology: pkg.config.terminology,
    aiBehavior: pkg.config.aiBehavior,
    onboarding: pkg.config.onboarding,
    trackedDimensions: pkg.config.trackedDimensions,
    alertRules: pkg.config.alertRules,
    graduation: pkg.config.graduation,

    // Reference to curriculum
    curriculumCollectionKey: pkg.curriculum.collectionKey,

    // Org-level fields — inherit from org if requested, else leave undefined
    branding: undefined,
    notifications: undefined,
  };

  // Optionally inherit org settings
  if (opts.inheritOrgSettings) {
    const org = await prisma.organization.findUnique({
      where: { id: opts.organizationId },
      select: { settings: true },
    });
    if (org?.settings && typeof org.settings === "object") {
      const settings = org.settings as Record<string, unknown>;
      if (settings.branding) {
        config.branding = settings.branding as ProgramVersionConfig["branding"];
      }
      if (settings.notifications) {
        config.notifications = settings.notifications as ProgramVersionConfig["notifications"];
      }
    }
  }

  // ─── 4. Upsert ProgramVersion in draft state ─────────────────────────────
  const programVersion = await prisma.programVersion.upsert({
    where: {
      programId_version: {
        programId: opts.programId,
        version: pkg.metadata.version,
      },
    },
    update: {
      config: config as object,
      collectionId: collection.id,
      primaryLang: pkg.metadata.languages[0],
      // Don't change status on re-import — preserve draft/published state
    },
    create: {
      programId: opts.programId,
      version: pkg.metadata.version,
      config: config as object,
      status: "draft",
      primaryLang: pkg.metadata.languages[0],
      collectionId: collection.id,
      active: false,
    },
  });

  // ─── 5. Handle Outcome (if present) ──────────────────────────────────────
  // NOTE: Outcome/Milestone tables don't exist in schema.prisma yet.
  // If pkg.outcome is present, log a warning.
  if (pkg.outcome) {
    warnings.push(
      `Package includes outcome data (project: "${pkg.outcome.project.title}", ` +
        `${pkg.outcome.milestones.length} milestones), but Outcome/Milestone tables ` +
        `don't exist in the schema. This data was NOT imported. ` +
        `TODO: Add models to schema.prisma if outcome tracking is needed.`
    );
  }

  // ─── 6. Audit log ────────────────────────────────────────────────────────
  if (opts.importedBy) {
    await prisma.auditLog.create({
      data: {
        actorId: opts.importedBy,
        action: "imported_journey_package",
        targetType: "program_version",
        targetId: programVersion.id,
        metadata: {
          packageId: pkg.metadata.packageId,
          packageVersion: pkg.metadata.version,
          lessonsImported,
          collectionId: collection.id,
        },
      },
    });
  }

  return {
    success: true,
    collectionId: collection.id,
    programVersionId: programVersion.id,
    lessonsImported,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper: Import from file path (for CLI scripts)
// ═══════════════════════════════════════════════════════════════════════════

import { journeyPackageSchema } from "./journey-package.schema";

/**
 * Validates and imports a JourneyPackage object.
 * Use this when you have the raw object (e.g., from a file or API).
 */
export async function validateAndImport(
  rawPackage: unknown,
  opts: ImportOptions
): Promise<
  | ImportResult
  | { success: false; errors: { path: string; message: string }[] }
> {
  const parseResult = journeyPackageSchema.safeParse(rawPackage);

  if (!parseResult.success) {
    return {
      success: false,
      errors: parseResult.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    };
  }

  return importJourneyPackage(parseResult.data, opts);
}
