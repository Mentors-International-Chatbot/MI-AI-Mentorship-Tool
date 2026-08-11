/**
 * Publication State Machine for ProgramVersion
 * ═══════════════════════════════════════════════════════════════════════════
 * States: draft → published → archived
 *
 * Invariants:
 *   - Published rows are IMMUTABLE — to change, create a new version
 *   - At most one published version per program at a time
 *   - Publish is atomic (single transaction) with audit logging
 *   - Validation runs before publish: zod passes, all references resolve
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/db";
import {
  programVersionConfigSchema,
} from "./program-version-config.schema";
import { lessonSchema, normalizeMilestoneAvailability } from "./journey-package.schema";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type PublicationValidationError = {
  code: "config_invalid" | "missing_lesson" | "missing_dimension" | "invalid_state";
  message: string;
  path?: string[];
  details?: unknown;
};

export type PublicationResult =
  | { success: true; versionId: string; publishedAt: Date }
  | { success: false; errors: PublicationValidationError[] };

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validates a ProgramVersion is ready for publication.
 *
 * Checks:
 * 1. Config passes programVersionConfigSchema
 * 2. All graduation.requiredLessonKeys exist in the linked ContentCollection
 * 3. All alertRules[].dimensionKey exist in trackedDimensions
 * 4. All graduation.requiredDimensionKeys exist in trackedDimensions
 */
export async function validateForPublication(
  versionId: string
): Promise<PublicationValidationError[]> {
  const errors: PublicationValidationError[] = [];

  // Fetch the version with its collection and lessons
  const version = await prisma.programVersion.findUnique({
    where: { id: versionId },
    include: {
      collection: {
        include: {
          lessons: {
            select: { slug: true },
          },
        },
      },
    },
  });

  if (!version) {
    return [{ code: "invalid_state", message: `ProgramVersion ${versionId} not found` }];
  }

  if (version.status !== "draft") {
    return [
      {
        code: "invalid_state",
        message: `Cannot publish: version is ${version.status}, must be draft`,
      },
    ];
  }

  // 1. Validate config against zod schema
  const configResult = programVersionConfigSchema.safeParse(version.config);
  if (!configResult.success) {
    for (const issue of configResult.error.issues) {
      errors.push({
        code: "config_invalid",
        message: issue.message,
        path: issue.path.map(String),
      });
    }
    return errors; // Can't proceed with reference checks if config is invalid
  }

  const config = configResult.data;

  // Current cartridges snapshot both membership and order. Check the exact
  // LessonVersion rows, not merely shared ContentLesson slugs left by an older
  // release in the same collection.
  if (config.curriculumLessonKeys) {
    const releasedLessons = version.collectionId ? await prisma.contentLesson.findMany({
      where: { collectionId: version.collectionId, slug: { in: config.curriculumLessonKeys }, versions: { some: { version: version.version } } },
      select: { slug: true },
    }) : [];
    const releasedKeys = new Set(releasedLessons.map((lesson) => lesson.slug));
    for (const lessonKey of config.curriculumLessonKeys) {
      if (!releasedKeys.has(lessonKey)) errors.push({ code: "missing_lesson", message: `curriculum snapshot requires missing lesson version "${lessonKey}"`, path: ["curriculumLessonKeys"] });
    }
    for (const milestone of config.outcome?.milestones ?? []) {
      const availability = normalizeMilestoneAvailability(milestone).availability;
      if (availability.type === "after_lesson" && !releasedKeys.has(availability.lessonKey)) {
        errors.push({ code: "missing_lesson", message: `milestone "${milestone.key}" references lesson "${availability.lessonKey}" outside this version`, path: ["outcome", "milestones", milestone.key] });
      }
    }
  }

  // 2. Build set of dimension keys
  const dimensionKeys = new Set(config.trackedDimensions.map((d) => d.key));

  // 3. Validate alertRules reference valid dimensions
  for (const rule of config.alertRules) {
    if (!dimensionKeys.has(rule.dimensionKey)) {
      errors.push({
        code: "missing_dimension",
        message: `alertRule "${rule.id}" references unknown dimension "${rule.dimensionKey}"`,
        path: ["alertRules", rule.id, "dimensionKey"],
      });
    }
  }

  // 4. Validate graduation.requiredDimensionKeys
  for (const dk of config.graduation?.requiredDimensionKeys ?? []) {
    if (!dimensionKeys.has(dk)) {
      errors.push({
        code: "missing_dimension",
        message: `graduation requires unknown dimension "${dk}"`,
        path: ["graduation", "requiredDimensionKeys"],
      });
    }
  }

  // 5. Validate graduation.requiredLessonKeys exist in collection
  if (config.graduation?.requiredLessonKeys?.length) {
    const lessonSlugs = new Set(version.collection?.lessons.map((l) => l.slug) ?? []);

    for (const lk of config.graduation.requiredLessonKeys) {
      if (!lessonSlugs.has(lk)) {
        errors.push({
          code: "missing_lesson",
          message: `graduation requires unknown lesson "${lk}"`,
          path: ["graduation", "requiredLessonKeys"],
        });
      }
    }
  }

  return errors;
}

/**
 * Validates all LessonVersion.body entries in a collection against lessonSchema.
 */
export async function validateLessonBodies(
  collectionId: string,
  versionString?: string,
): Promise<PublicationValidationError[]> {
  const errors: PublicationValidationError[] = [];

  const lessons = await prisma.contentLesson.findMany({
    where: { collectionId },
    include: {
      versions: {
        where: versionString ? { version: versionString } : { active: true },
      },
    },
  });

  for (const lesson of lessons) {
    for (const version of lesson.versions) {
      const result = lessonSchema.safeParse(version.body);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            code: "config_invalid",
            message: `Lesson "${lesson.slug}" version "${version.version}": ${issue.message}`,
            path: ["lessons", lesson.slug, ...issue.path.map(String)],
          });
        }
      }
    }
  }

  return errors;
}

// ═══════════════════════════════════════════════════════════════════════════
// State Transitions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Publishes a draft ProgramVersion.
 *
 * Atomic transaction:
 * 1. Validate the version
 * 2. Archive any currently published version of the same program
 * 3. Set this version to published
 * 4. Create audit log entry
 */
export async function publishVersion(
  versionId: string,
  publishedBy: string
): Promise<PublicationResult> {
  // Validate first (outside transaction for better error messages)
  const validationErrors = await validateForPublication(versionId);
  if (validationErrors.length > 0) {
    return { success: false, errors: validationErrors };
  }

  const version = await prisma.programVersion.findUnique({
    where: { id: versionId },
    select: {
      programId: true,
      collectionId: true,
      version: true,
      config: true,
      program: { select: { organizationId: true } },
    },
  });

  if (!version) {
    return {
      success: false,
      errors: [{ code: "invalid_state", message: "Version not found" }],
    };
  }

  // Also validate lesson bodies if there's a collection
  if (version.collectionId) {
    const lessonErrors = await validateLessonBodies(version.collectionId, version.version);
    if (lessonErrors.length > 0) {
      return { success: false, errors: lessonErrors };
    }
  }

  const now = new Date();
  const config = programVersionConfigSchema.parse(version.config);

  // Atomic transaction with extended timeout for bulk operations
  await prisma.$transaction(async (tx) => {
    // Archive any currently published version
    await tx.programVersion.updateMany({
      where: {
        programId: version.programId,
        status: "published",
      },
      data: {
        status: "archived",
        active: false,
      },
    });

    // Publish this version
    await tx.programVersion.update({
      where: { id: versionId },
      data: {
        status: "published",
        active: true,
        publishedAt: now,
        publishedBy,
      },
    });

    // Publication establishes every metric the sensing pipeline may emit.
    // Upsert keeps existing descriptions/history while making new dimensions live.
    for (const dimension of config.trackedDimensions) {
      await tx.metricDefinition.upsert({
        where: {
          organizationId_key: {
            organizationId: version.program.organizationId,
            key: dimension.key,
          },
        },
        update: {
          name: dimension.label,
          category: dimension.category === "comprehension" ? "learning" : dimension.category,
          dataType: "continuous",
          scale: dimension.scale,
        },
        create: {
          organizationId: version.program.organizationId,
          key: dimension.key,
          name: dimension.label,
          category: dimension.category === "comprehension" ? "learning" : dimension.category,
          dataType: "continuous",
          scale: dimension.scale,
        },
      });
    }

    // Activate all lesson versions in the collection using batch operations
    if (version.collectionId) {
      // Get all lesson IDs in this collection
      const lessons = await tx.contentLesson.findMany({
        where: { collectionId: version.collectionId },
        select: { id: true },
      });
      const lessonIds = lessons.map((l) => l.id);

      // Batch 1: Deactivate all lesson versions in these lessons
      await tx.lessonVersion.updateMany({
        where: { lessonId: { in: lessonIds } },
        data: { active: false },
      });

      // Batch 2: Activate exactly the cartridge version being published. A
      // newer draft may already exist in the same collection and must stay dark.
      await tx.lessonVersion.updateMany({
        where: { lessonId: { in: lessonIds }, version: version.version },
        data: { active: true, publishedAt: now },
      });
    }

    // Audit log
    await tx.auditLog.create({
      data: {
        actorId: publishedBy,
        action: "published_version",
        targetType: "program_version",
        targetId: versionId,
        metadata: {
          programId: version.programId,
          version: version.version,
          publishedAt: now.toISOString(),
        },
      },
    });
  }, {
    timeout: 30000, // 30 seconds for bulk lesson operations
  });

  return { success: true, versionId, publishedAt: now };
}

/**
 * Archives a published ProgramVersion.
 * Cannot archive a draft (must publish first or delete).
 */
export async function archiveVersion(
  versionId: string,
  archivedBy: string
): Promise<{ success: true } | { success: false; error: string }> {
  const version = await prisma.programVersion.findUnique({
    where: { id: versionId },
    select: { status: true, programId: true, version: true },
  });

  if (!version) {
    return { success: false, error: "Version not found" };
  }

  if (version.status !== "published") {
    return {
      success: false,
      error: `Cannot archive: version is ${version.status}, must be published`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.programVersion.update({
      where: { id: versionId },
      data: {
        status: "archived",
        active: false,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: archivedBy,
        action: "archived_version",
        targetType: "program_version",
        targetId: versionId,
        metadata: {
          programId: version.programId,
          version: version.version,
          archivedAt: new Date().toISOString(),
        },
      },
    });
  });

  return { success: true };
}

/**
 * Gets the currently published version for a program, if any.
 */
export async function getPublishedVersion(programId: string) {
  return prisma.programVersion.findFirst({
    where: {
      programId,
      status: "published",
    },
    include: {
      collection: {
        include: {
          lessons: {
            orderBy: { orderIndex: "asc" },
            include: {
              versions: {
                where: { active: true },
              },
            },
          },
        },
      },
    },
  });
}
