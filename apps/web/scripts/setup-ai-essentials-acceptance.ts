#!/usr/bin/env npx tsx
import "dotenv/config";

import { prisma } from "../src/lib/db";

const EXPECTED_BRANCH_ID = "br-misty-dawn-adj1cbft";
const ORGANIZATION_SLUG = "ai-essentials-verification";

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  const [connection] = await prisma.$queryRawUnsafe<Array<{ branchId: string | null }>>(
    "SELECT current_setting('neon.branch_id', true) AS \"branchId\"",
  );
  if (connection?.branchId !== EXPECTED_BRANCH_ID) {
    throw new Error(
      `Refusing acceptance setup on branch ${connection?.branchId ?? "unknown"}; expected ${EXPECTED_BRANCH_ID}`,
    );
  }

  const existing = await prisma.organization.findUnique({
    where: { slug: ORGANIZATION_SLUG },
  });
  if (existing) {
    if (!isObject(existing.settings) || existing.settings.syntheticDataOnly !== true) {
      throw new Error("Refusing setup: existing organization is not marked syntheticDataOnly");
    }
    process.stdout.write(`Synthetic acceptance organization already exists: ${existing.id}\n`);
    return;
  }

  const organization = await prisma.organization.create({
    data: {
      slug: ORGANIZATION_SLUG,
      name: "AI Essentials Verification",
      settings: {
        syntheticDataOnly: true,
        purpose: "isolated AI Essentials sensing acceptance",
      },
    },
  });
  process.stdout.write(`Created synthetic acceptance organization: ${organization.id}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
