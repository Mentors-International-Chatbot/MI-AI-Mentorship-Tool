#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * Import PBJ Curriculum Script
 * Imports the toy PB&J course under the existing MI organization.
 */

import { prisma } from "../src/lib/db";
import { pbjPackage } from "../src/lib/journey-package/examples/pbj-journey-package";
import { importJourneyPackage } from "../src/lib/journey-package/import-journey-package";
import { publishVersion } from "../src/lib/journey-package/publication.service";

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("PBJ Curriculum Import");
  console.log("═══════════════════════════════════════════════════════════════\n");

  try {
    // 1. Get the MI organization (created by migrate-mi-content.ts)
    const org = await prisma.organization.findUnique({
      where: { slug: "mentors-international" },
    });

    if (!org) {
      console.error("❌ Organization 'mentors-international' not found.");
      console.error("   Run migrate-mi-content.ts first to create the org.");
      process.exit(1);
    }

    // 2. Create or get PBJ program
    const programSlug = "pbj-sandbox";
    let program = await prisma.program.findFirst({
      where: { organizationId: org.id, slug: programSlug },
    });

    if (!program) {
      console.log(`Creating program: ${programSlug}`);
      program = await prisma.program.create({
        data: {
          organizationId: org.id,
          slug: programSlug,
          name: "PB&J Sandbox",
          description: "Toy course for testing the JourneyPackage system",
        },
      });
    }

    console.log(`Organization ID: ${org.id}`);
    console.log(`Program ID: ${program.id}`);

    // 3. Import the PBJ package
    console.log("\nStep 1: Importing PBJ JourneyPackage...");
    const importResult = await importJourneyPackage(pbjPackage, {
      organizationId: org.id,
      programId: program.id,
      importedBy: "import-pbj-script",
      inheritOrgSettings: false,
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

    // 4. Publish the version
    console.log("\nStep 2: Publishing ProgramVersion...");
    const publishResult = await publishVersion(
      importResult.programVersionId,
      "import-pbj-script"
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

    // 5. Verify both collections exist with active lessons
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("Verifying Collections");
    console.log("═══════════════════════════════════════════════════════════════\n");

    const collections = await prisma.contentCollection.findMany({
      where: { organizationId: org.id },
      include: {
        lessons: {
          include: {
            versions: {
              where: { active: true },
            },
          },
        },
      },
    });

    for (const col of collections) {
      const activeLessonCount = col.lessons.filter(
        (l) => l.versions.length > 0
      ).length;
      console.log(`Collection: ${col.slug}`);
      console.log(`   ID: ${col.id}`);
      console.log(`   Active lessons: ${activeLessonCount}`);
      console.log("");
    }

    console.log("═══════════════════════════════════════════════════════════════");
    console.log("✅ PBJ IMPORT COMPLETE");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`\nCollection slugs:`);
    for (const col of collections) {
      console.log(`  - ${col.slug}`);
    }

  } catch (error) {
    console.error("\n❌ Import failed with error:");
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
