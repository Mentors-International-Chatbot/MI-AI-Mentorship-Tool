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
 * Outcome content is retained in ProgramVersion.config. Learner attainment is
 * recorded separately in MilestoneProgress by the existing marker pipeline.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/db";
import { normalizeMilestoneAvailability, type JourneyPackage, type PackageLesson } from "./journey-package.schema";
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
// Auto-Append Teach-Back
// ═══════════════════════════════════════════════════════════════════════════

type AppendResult = {
  lessons: PackageLesson[];
  synthesizedCount: number;
};

/**
 * If autoAppendTeachBack is enabled, synthesize a gated teach_back at the end
 * of each lesson that doesn't already have one.
 * Exported for testing.
 */
export function maybeAppendTeachBack(
  lessons: PackageLesson[],
  assessment: JourneyPackage["config"]["assessment"]
): AppendResult {
  if (!assessment?.autoAppendTeachBack) {
    return { lessons, synthesizedCount: 0 };
  }

  const dimensionKey = assessment.passing.dimensionKey;
  let synthesizedCount = 0;

  const transformed = lessons.map((lesson) => {
    // Check if lesson already has any teach_back block (inline or gated)
    const hasTeachBack = lesson.blocks.some((b) => b.blockType === "teach_back");

    if (hasTeachBack) {
      // Skip - lesson already has a teach_back (author's intent preserved)
      return lesson;
    }

    // Synthesize a gated teach_back block
    synthesizedCount++;
    const maxOrder = Math.max(...lesson.blocks.map((b) => b.order), 0);
    const synthesizedBlock = {
      id: `${lesson.key}-synth-teachback`,
      order: maxOrder + 1,
      blockType: "teach_back" as const,
      prompt: `In your own words, explain what you learned about: ${lesson.title}`,
      evaluatesConcepts: lesson.keyConcepts,
      dimensionKey,
      delivery: "gated_session" as const,
    };

    return {
      ...lesson,
      blocks: [...lesson.blocks, synthesizedBlock],
    };
  });

  return { lessons: transformed, synthesizedCount };
}

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

  // ─── 0a. Refuse to overwrite a non-draft version — BEFORE any write ────────
  //
  // This has to be the first thing the function does. The import is not
  // transactional, and the ContentCollection / ContentLesson / LessonVersion
  // upserts below all rewrite title and body with no status check of their own.
  // Guarding later would let a refused import still overwrite published lesson
  // bodies on its way to throwing.
  //
  // The upsert's `update` branch also deliberately preserves `status`, so a
  // re-import at a published version's string would leave the row published
  // while swapping in a config that never passed validateForPublication.
  // Immutability of non-draft versions is documented in publication.service.ts;
  // this is where it is enforced.
  const existingVersion = await prisma.programVersion.findUnique({
    where: {
      programId_version: {
        programId: opts.programId,
        version: pkg.metadata.version,
      },
    },
    select: { status: true },
  });

  if (existingVersion && existingVersion.status !== "draft") {
    throw new Error(
      `Refusing to import over ProgramVersion "${pkg.metadata.version}": it is ` +
        `${existingVersion.status}, not draft. Published and archived versions are ` +
        `immutable — a re-import would replace released content with a config that ` +
        `never went through validateForPublication. Bump metadata.version to a new ` +
        `version string (current: "${pkg.metadata.version}") and import that instead.`,
    );
  }

  // ─── 0. Auto-append teach-back blocks if enabled ───────────────────────────
  const { lessons, synthesizedCount } = maybeAppendTeachBack(
    pkg.curriculum.lessons,
    pkg.config.assessment
  );
  if (synthesizedCount > 0) {
    warnings.push(
      `autoAppendTeachBack: synthesized ${synthesizedCount} gated teach_back block(s) ` +
        `using dimension "${pkg.config.assessment?.passing.dimensionKey}".`
    );
  }

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

  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i];

    // Upsert the lesson row
    const lessonRow = await prisma.contentLesson.upsert({
      where: {
        collectionId_slug: {
          collectionId: collection.id,
          slug: lesson.key,
        },
      },
      update: {
        // Shared ContentLesson rows serve every released ProgramVersion. Their
        // legacy order must not move when a newer version reorders lessons;
        // current versions read the immutable curriculumLessonKeys snapshot.
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
    responseStyle: pkg.config.responseStyle,
    projectSelection: pkg.config.projectSelection,
    helpRequest: pkg.config.helpRequest,
    onboarding: pkg.config.onboarding,
    trackedDimensions: pkg.config.trackedDimensions,
    alertRules: pkg.config.alertRules,
    graduation: pkg.config.graduation,
    assessment: pkg.config.assessment,
    dashboard: pkg.config.dashboard,

    // `outcome` used to be validated here and then thrown away with a warning,
    // because there were no Outcome/Milestone tables. That made every project,
    // milestone and mentor resource an author wrote invisible at runtime — the
    // schema cross-validated them, and nothing could ever read them.
    outcome: pkg.outcome ? {
      ...pkg.outcome,
      milestones: pkg.outcome.milestones.map(normalizeMilestoneAvailability),
    } : undefined,

    // Reference to curriculum
    curriculumCollectionKey: pkg.curriculum.collectionKey,
    curriculumLessonKeys: lessons.map((lesson) => lesson.key),

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
  // Non-draft versions were already refused in step 0a, before any writes.
  const programVersion = await prisma.programVersion.upsert({
    where: {
      programId_version: {
        programId: opts.programId,
        version: pkg.metadata.version,
      },
    },
    update: {
      config: config as object,
      metadata: pkg.metadata as object,
      collectionId: collection.id,
      primaryLang: pkg.metadata.languages[0],
      // Don't change status on re-import — preserve draft/published state
    },
    create: {
      programId: opts.programId,
      version: pkg.metadata.version,
      config: config as object,
      metadata: pkg.metadata as object,
      status: "draft",
      primaryLang: pkg.metadata.languages[0],
      collectionId: collection.id,
      active: false,
    },
  });

  // ─── 5. Outcome ──────────────────────────────────────────────────────────
  // Stored in ProgramVersion.config above; MilestoneProgress records learner
  // attainment when the validated marker pipeline observes it.

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
