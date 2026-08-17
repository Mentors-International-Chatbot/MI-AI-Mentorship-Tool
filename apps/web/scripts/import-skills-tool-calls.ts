#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * Import Skills & Tool Calls
 * ----------------------------------------------------------------------------
 * Creates (or reuses) the program, imports the hand-authored package, and
 * publishes it under the real Mentors International organization.
 *
 * Not the Learn Machine converter: that path is AI Essentials-specific and
 * asserts its lesson and block counts.
 *
 * Idempotent. Re-running reuses the program and collection; the importer
 * refuses to overwrite a non-draft version, so a second run after publishing
 * creates a new draft version rather than rewriting the published one.
 */

import { prisma } from "../src/lib/db";
import { skillsToolCallsPackage } from "../src/lib/journey-package/examples/skills-tool-calls-package";
import { journeyPackageSchema } from "../src/lib/journey-package/journey-package.schema";
import { importJourneyPackage } from "../src/lib/journey-package/import-journey-package";
import { publishVersion } from "../src/lib/journey-package/publication.service";

const ORG_SLUG = "mentors-international";
const PROGRAM_SLUG = "skills-tool-calls";
const IMPORTED_BY = "import-skills-tool-calls-script";

async function main() {
  console.log("Skills & Tool Calls import\n");

  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) {
    console.error(`Organization '${ORG_SLUG}' not found.`);
    process.exit(1);
  }
  console.log(`Organization: ${org.name} (${org.id})`);

  let program = await prisma.program.findFirst({
    where: { organizationId: org.id, slug: PROGRAM_SLUG },
  });
  if (!program) {
    program = await prisma.program.create({
      data: {
        organizationId: org.id,
        slug: PROGRAM_SLUG,
        name: "Skills & Tool Calls",
        description: "One-lesson focus-group course on AI skills and tool calls",
      },
    });
    console.log(`Created program ${program.id}`);
  } else {
    console.log(`Reusing program ${program.id}`);
  }

  console.log("\nValidating package...");
  const parsed = journeyPackageSchema.safeParse(skillsToolCallsPackage);
  if (!parsed.success) {
    console.error("Package validation failed:");
    for (const issue of parsed.error.issues) {
      console.error(`  - [${issue.path.join(".") || "(root)"}] ${issue.message}`);
    }
    process.exit(1);
  }
  console.log("Valid.");

  console.log("\nImporting...");
  const result = await importJourneyPackage(parsed.data, {
    organizationId: org.id,
    programId: program.id,
    importedBy: IMPORTED_BY,
    inheritOrgSettings: false,
  });
  console.log(`  Collection:     ${result.collectionId}`);
  console.log(`  ProgramVersion: ${result.programVersionId}`);
  console.log(`  Lessons:        ${result.lessonsImported}`);
  for (const warning of result.warnings) console.log(`  warning: ${warning}`);

  console.log("\nPublishing...");
  const published = await publishVersion(result.programVersionId, IMPORTED_BY);
  if (!published.success) {
    console.error("Publish failed:");
    for (const error of published.errors) console.error(`  [${error.code}] ${error.message}`);
    process.exit(1);
  }
  console.log(`Published at ${published.publishedAt.toISOString()}`);

  // Re-point active enrollments at the version just published.
  //
  // `resolvePlayerAccess` accepts both `published` and `archived`, so an
  // enrollment created before this run keeps serving the OLD lesson bodies and
  // the OLD config — which meant a learner provisioned yesterday saw the
  // previous blocks and uncapped tutor replies while a learner who joined today
  // saw the new ones. In a room of people watching, that is indistinguishable
  // from the build being broken.
  //
  // Safe for this course specifically: SKILLS is a single-lesson demo where
  // "latest published" is always what everyone should be on. A multi-lesson
  // course mid-cohort would want the opposite, which is why this lives in the
  // SKILLS script rather than in `publishVersion`.
  const repointed = await prisma.enrollment.updateMany({
    where: {
      status: "active",
      programVersion: { programId: program.id },
      programVersionId: { not: result.programVersionId },
    },
    data: { programVersionId: result.programVersionId },
  });
  console.log(`\nRe-pointed ${repointed.count} active enrollment(s) to this version`);

  const version = await prisma.programVersion.findUnique({
    where: { id: result.programVersionId },
    select: { status: true, metadata: true, config: true, collection: { select: { slug: true } } },
  });
  const config = (version?.config ?? {}) as Record<string, unknown>;
  console.log("\nVerification");
  console.log(`  status:            ${version?.status}`);
  console.log(`  collection:        ${version?.collection?.slug}`);
  console.log(`  delivery:          ${JSON.stringify((version?.metadata as Record<string, unknown>)?.delivery)}`);
  console.log(`  projectSelection:  ${config.projectSelection === undefined ? "absent" : "PRESENT"}`);
  console.log(`  onboarding:        ${config.onboarding === undefined ? "absent" : "PRESENT"}`);
  console.log(`  outcome:           ${config.outcome === undefined ? "absent" : "PRESENT"}`);
  console.log(`  helpRequest:       ${config.helpRequest === undefined ? "absent" : "PRESENT"}`);
  console.log("\nLearners join at /join with code SKILLS.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
