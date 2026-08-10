#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * MI Content Migration Script
 * ═══════════════════════════════════════════════════════════════════════════
 * Transforms the 28 hardcoded lessons from src/lib/lessons/data.ts into
 * a validated JourneyPackage, imports it to the database, and publishes it.
 *
 * This is a ONE-TIME migration that establishes MI v1 in the new domain model.
 * After running, lesson content comes from the database, not the hardcoded file.
 *
 * Usage:
 *   npx tsx scripts/migrate-mi-content.ts
 *
 * Prerequisites:
 *   - Database must have an Organization and Program created
 *   - Run with: ORG_ID=xxx PROGRAM_ID=yyy npx tsx scripts/migrate-mi-content.ts
 *   - Or set these in .env and this script will create them if missing
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { prisma } from "../src/lib/db";
import {
  journeyPackageSchema,
  type JourneyPackage,
  type PackageLesson,
} from "../src/lib/journey-package/journey-package.schema";
import { importJourneyPackage } from "../src/lib/journey-package/import-journey-package";
import { publishVersion } from "../src/lib/journey-package/publication.service";

// ═══════════════════════════════════════════════════════════════════════════
// Legacy Lesson Data Types (from src/lib/lessons/data.ts)
// ═══════════════════════════════════════════════════════════════════════════

type LegacyMessageType = 'escenario' | 'explicación' | 'ejemplo' | 'pregunta' | 'profundización';

interface LegacyMessage {
  order: number;
  type: LegacyMessageType;
  contentEs: string;
}

interface LegacyLesson {
  lessonNumber: number;
  titleEs: string;
  category: string;
  keyConcepts: string[];
  selfCheckQuestions: string[];
  exercise: string;
  commitment: string;
  messages: LegacyMessage[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Role Mapping
// ═══════════════════════════════════════════════════════════════════════════

type TeachRole = "scenario" | "explanation" | "example" | "question" | "deepening";

const ROLE_MAP: Record<LegacyMessageType, TeachRole> = {
  'escenario': 'scenario',
  'explicación': 'explanation',
  'ejemplo': 'example',
  'pregunta': 'question',
  'profundización': 'deepening',
};

// ═══════════════════════════════════════════════════════════════════════════
// Transform Functions
// ═══════════════════════════════════════════════════════════════════════════

function lessonNumberToKey(num: number): string {
  return `lesson-${String(num).padStart(2, '0')}`;
}

function transformLesson(legacy: LegacyLesson): PackageLesson {
  // Create teach blocks from legacy messages
  const blocks = legacy.messages.map((msg, idx) => ({
    id: `${lessonNumberToKey(legacy.lessonNumber)}-b${idx + 1}`,
    order: msg.order,
    blockType: 'teach' as const,
    role: ROLE_MAP[msg.type],
    content: msg.contentEs,
  }));

  return {
    key: lessonNumberToKey(legacy.lessonNumber),
    title: legacy.titleEs,
    category: legacy.category,
    keyConcepts: legacy.keyConcepts,
    selfCheckQuestions: legacy.selfCheckQuestions,
    blocks,
    exercise: legacy.exercise,
    commitment: legacy.commitment,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Build JourneyPackage
// ═══════════════════════════════════════════════════════════════════════════

async function buildMIJourneyPackage(): Promise<JourneyPackage> {
  // Dynamically import the legacy lessons
  const { getLessonData, hasLessonData } = await import("../src/lib/lessons/data");

  // Collect all lessons (1-28)
  const lessons: PackageLesson[] = [];
  for (let i = 1; i <= 28; i++) {
    if (hasLessonData(i)) {
      const legacy = getLessonData(i);
      lessons.push(transformLesson(legacy));
    }
  }

  console.log(`Transformed ${lessons.length} lessons from legacy format`);

  // Build the JourneyPackage
  const pkg = {
    schemaVersion: "1.0",

    metadata: {
      packageId: "mi-colombia-pilot",
      title: "Mentors International - Colombia Pilot Curriculum",
      description:
        "28-lesson financial literacy and business mentoring curriculum for micro-entrepreneurs in Colombia.",
      languages: ["es"],
      // 1.1.0 adds config.dashboard. Bumped rather than re-importing over
      // 1.0.0 so the published 1.0.0 stays an intact, archived record.
      version: "1.1.0",
      author: {
        name: "Mentors International",
        organizationKey: "mentors-international",
      },
    },

    config: {
      terminology: {
        participantSingular: "socio",
        participantPlural: "socios",
        mentorSingular: "mentor",
        mentorPlural: "mentores",
      },
      aiBehavior: {
        tone: "Supportive, patient, teacher-mentor. Warm but professional.",
        teachingStyle:
          "Step-by-step with concrete examples. Action-first responses. " +
          "Simplified language appropriate for micro-entrepreneurs.",
        languageInstruction:
          "Respond in Colombian Spanish. Use informal 'tú' form. " +
          "Keep sentences short and clear. Avoid technical jargon.",
      },
      onboarding: {
        mode: "skip", // Legacy system handles onboarding separately
        steps: [],
      },
      trackedDimensions: [
        {
          key: "comprehension",
          label: "Comprensión del Material",
          category: "comprehension",
          primary: true,
          scale: { min: 0, max: 10 },
          calibrationMode: "zero_start",
        },
        {
          key: "engagement",
          label: "Nivel de Participación",
          category: "behavioral",
          primary: true,
          scale: { min: 0, max: 10 },
          calibrationMode: "zero_start",
        },
        {
          key: "emotional-state",
          label: "Estado Emocional",
          category: "emotional",
          primary: false,
          scale: { min: 0, max: 10 },
          calibrationMode: "assumed_baseline",
          assumedBaseline: 5,
        },
      ],
      alertRules: [
        {
          id: "low-comprehension",
          dimensionKey: "comprehension",
          operator: "lt",
          threshold: 3,
          severity: "medium",
          cooldownHours: 48,
        },
        {
          id: "low-engagement",
          dimensionKey: "engagement",
          operator: "lt",
          threshold: 2,
          severity: "high",
          cooldownHours: 72,
        },
        {
          id: "distress-signal",
          dimensionKey: "emotional-state",
          operator: "lt",
          threshold: 2,
          severity: "high",
          cooldownHours: 24,
        },
      ],
      graduation: {
        requiredLessonKeys: [
          "lesson-05", // Punto de Equilibrio (core financial concept)
          "lesson-28", // Mi Propósito (final lesson)
        ],
        requiredDimensionKeys: ["comprehension"],
      },
      dashboard: {
        // Array order is render order. No dimension_trend: MI's tracked
        // dimensions are comprehension / engagement / emotional-state — revenue
        // is not a dimension, it reaches the dashboard via FinancialSnapshot
        // through the financial_snapshots panel.
        panels: [
          { type: "lesson_progress" },
          { type: "assessment_scores" },
          { type: "weekly_summary" },
          { type: "financial_snapshots" },
        ],
      },
    },

    curriculum: {
      collectionKey: "mi-colombia-curriculum",
      lessons,
    },

    // No outcome for v1 — milestones tracked via existing SocioProgress
  } as const;

  return journeyPackageSchema.parse(pkg);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Migration
// ═══════════════════════════════════════════════════════════════════════════

async function ensureOrgAndProgram(): Promise<{ orgId: string; programId: string }> {
  const orgSlug = "mentors-international";
  const programSlug = "colombia-pilot-2026";

  // Check for existing org
  let org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (!org) {
    console.log(`Creating organization: ${orgSlug}`);
    org = await prisma.organization.create({
      data: {
        slug: orgSlug,
        name: "Mentors International",
        settings: {
          defaultLanguage: "es",
          timezone: "America/Bogota",
        },
      },
    });
  }

  // Check for existing program
  let program = await prisma.program.findFirst({
    where: {
      organizationId: org.id,
      slug: programSlug,
    },
  });

  if (!program) {
    console.log(`Creating program: ${programSlug}`);
    program = await prisma.program.create({
      data: {
        organizationId: org.id,
        slug: programSlug,
        name: "Colombia Pilot 2026",
        description: "100-socio AI mentoring pilot in Colombia",
      },
    });
  }

  return { orgId: org.id, programId: program.id };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("MI Content Migration: Hardcoded Lessons → JourneyPackage → DB");
  console.log("═══════════════════════════════════════════════════════════════\n");

  try {
    // 1. Build the JourneyPackage from legacy data
    console.log("Step 1: Transforming legacy lessons to JourneyPackage format...");
    const pkg = await buildMIJourneyPackage();

    // 2. Validate against schema
    console.log("\nStep 2: Validating against journeyPackageSchema...");
    const parseResult = journeyPackageSchema.safeParse(pkg);

    if (!parseResult.success) {
      console.error("\n❌ VALIDATION FAILED. Errors:\n");
      for (const issue of parseResult.error.issues) {
        console.error(`  [${issue.path.join(".") || "(root)"}] ${issue.message}`);
      }
      process.exit(1);
    }

    console.log("✅ Validation passed");
    console.log(`   Lessons: ${parseResult.data.curriculum.lessons.length}`);
    console.log(`   Tracked dimensions: ${parseResult.data.config.trackedDimensions.length}`);
    console.log(`   Alert rules: ${parseResult.data.config.alertRules.length}`);

    // 3. Ensure org and program exist
    console.log("\nStep 3: Ensuring organization and program exist...");
    const { orgId, programId } = await ensureOrgAndProgram();
    console.log(`   Organization ID: ${orgId}`);
    console.log(`   Program ID: ${programId}`);

    // 4. Import to database
    console.log("\nStep 4: Importing to database...");
    const importResult = await importJourneyPackage(parseResult.data, {
      organizationId: orgId,
      programId: programId,
      importedBy: "migration-script",
      inheritOrgSettings: true,
    });

    console.log("✅ Import complete");
    console.log(`   Collection ID: ${importResult.collectionId}`);
    console.log(`   ProgramVersion ID: ${importResult.programVersionId}`);
    console.log(`   Lessons imported: ${importResult.lessonsImported}`);

    if (importResult.warnings.length > 0) {
      console.log("\n⚠️  Warnings:");
      for (const warning of importResult.warnings) {
        console.log(`   - ${warning}`);
      }
    }

    // 5. Publish the version
    console.log("\nStep 5: Publishing ProgramVersion...");
    const publishResult = await publishVersion(
      importResult.programVersionId,
      "migration-script"
    );

    if (!publishResult.success) {
      console.error("\n❌ PUBLISH FAILED. Errors:");
      for (const error of publishResult.errors) {
        console.error(`  [${error.code}] ${error.message}`);
      }
      process.exit(1);
    }

    console.log("✅ Published successfully");
    console.log(`   Published at: ${publishResult.publishedAt.toISOString()}`);

    // 6. Summary
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("✅ MIGRATION COMPLETE");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`
The 28 MI lessons are now stored in the database:
  - ContentCollection: mi-colombia-curriculum
  - 28 ContentLesson rows with LessonVersion.body containing full lesson data
  - ProgramVersion v1.1.0 is PUBLISHED and active

Next steps:
  1. Update AI prompts to read from LessonVersion rows instead of data.ts
  2. Test lesson delivery through WhatsApp/web chat
  3. The hardcoded file src/lib/lessons/data.ts can be archived (not deleted yet)
`);

  } catch (error) {
    console.error("\n❌ Migration failed with error:");
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
