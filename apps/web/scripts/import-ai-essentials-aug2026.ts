#!/usr/bin/env npx tsx
/**
 * One-off run-through import for the AI Essentials Aug-2026 package
 * (Track E, E.5-E.6.1). Mirrors scripts/import-ai-essentials.ts's exact
 * pattern (organization lookup, program upsert, importJourneyPackage,
 * optional publish, --expected-branch safety check) — not a new import
 * path, just a new entry point for a TS-exported package instead of a
 * JSON file, and a distinct program slug so it doesn't collide with the
 * existing "ai-essentials" Program.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { aiEssentialsAug2026Package } from "../src/lib/journey-package/examples/ai-essentials-aug2026-package";
import { journeyPackageSchema } from "../src/lib/journey-package/journey-package.schema";
import { importJourneyPackage } from "../src/lib/journey-package/import-journey-package";
import { publishVersion } from "../src/lib/journey-package/publication.service";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const organizationSlug = argument("--organization");
  if (!organizationSlug) throw new Error("--organization <slug> is required; the importer will not guess a tenant");
  const expectedBranch = argument("--expected-branch");
  if (expectedBranch) {
    const [connection] = await prisma.$queryRawUnsafe<Array<{ branchId: string | null }>>(
      "SELECT current_setting('neon.branch_id', true) AS \"branchId\"",
    );
    if (connection?.branchId !== expectedBranch) {
      throw new Error(`Refusing import on branch ${connection?.branchId ?? "unknown"}; expected ${expectedBranch}`);
    }
  }
  const pkg = journeyPackageSchema.parse(aiEssentialsAug2026Package);
  const organization = await prisma.organization.findUnique({ where: { slug: organizationSlug } });
  if (!organization) throw new Error(`Organization ${organizationSlug} was not found`);
  const program = await prisma.program.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "ai-essentials-aug2026" } },
    create: { organizationId: organization.id, slug: "ai-essentials-aug2026", name: pkg.metadata.title, description: pkg.metadata.description },
    update: { name: pkg.metadata.title, description: pkg.metadata.description },
  });
  const result = await importJourneyPackage(pkg, {
    organizationId: organization.id,
    programId: program.id,
    importedBy: argument("--actor") ?? "import-ai-essentials-aug2026-script",
    inheritOrgSettings: true,
  });
  process.stdout.write(`Imported ${result.lessonsImported} lesson-version documents into ${result.collectionId}.\n`);
  process.stdout.write(`programVersionId: ${result.programVersionId}\n`);
  for (const warning of result.warnings) process.stdout.write(`Warning: ${warning}\n`);
  if (process.argv.includes("--publish")) {
    const published = await publishVersion(result.programVersionId, argument("--actor") ?? "import-ai-essentials-aug2026-script");
    if (!published.success) throw new Error(published.errors.map((item) => `[${item.code}] ${item.message}`).join("\n"));
    process.stdout.write(`Published ${published.versionId} at ${published.publishedAt.toISOString()}.\n`);
  } else {
    process.stdout.write(`Draft ${result.programVersionId} is ready for review; pass --publish to publish it.\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
