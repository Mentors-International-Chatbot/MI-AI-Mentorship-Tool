#!/usr/bin/env npx tsx
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/db";
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
      throw new Error(
        `Refusing import on branch ${connection?.branchId ?? "unknown"}; expected ${expectedBranch}`,
      );
    }
  }
  const packagePath = resolve(argument("--package") ?? fileURLToPath(new URL("../../../content/ai-essentials.package.json", import.meta.url)));
  const raw = JSON.parse(readFileSync(packagePath, "utf8")) as unknown;
  const pkg = journeyPackageSchema.parse(raw);
  const organization = await prisma.organization.findUnique({ where: { slug: organizationSlug } });
  if (!organization) throw new Error(`Organization ${organizationSlug} was not found`);
  const program = await prisma.program.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "ai-essentials" } },
    create: { organizationId: organization.id, slug: "ai-essentials", name: pkg.metadata.title, description: pkg.metadata.description },
    update: { name: pkg.metadata.title, description: pkg.metadata.description },
  });
  const result = await importJourneyPackage(pkg, {
    organizationId: organization.id,
    programId: program.id,
    importedBy: argument("--actor") ?? "import-ai-essentials-script",
    inheritOrgSettings: true,
  });
  process.stdout.write(`Imported ${result.lessonsImported} lesson-version documents into ${result.collectionId}.\n`);
  for (const warning of result.warnings) process.stdout.write(`Warning: ${warning}\n`);
  if (process.argv.includes("--publish")) {
    const published = await publishVersion(result.programVersionId, argument("--actor") ?? "import-ai-essentials-script");
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
