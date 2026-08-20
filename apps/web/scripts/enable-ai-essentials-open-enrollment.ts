#!/usr/bin/env npx tsx
import "dotenv/config";

import { prisma } from "../src/lib/db";

const EXPECTED_BRANCH_ID = "br-winter-cloud-ad3fou3i";
const ORGANIZATION_SLUG = "ai-essentials-verification";

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Flips AIESS's synthetic verification org into cross-tenant open enrollment
 * for testing, without touching any other organization. Additive to whatever
 * settings the org already carries (syntheticDataOnly stays put — it still
 * governs every non-flagged path); see selectPublishedPlayerVersion for how
 * the flag is consumed.
 */
async function main() {
  const [connection] = await prisma.$queryRawUnsafe<Array<{ branchId: string | null }>>(
    "SELECT current_setting('neon.branch_id', true) AS \"branchId\"",
  );
  if (connection?.branchId !== EXPECTED_BRANCH_ID) {
    throw new Error(
      `Refusing to run on branch ${connection?.branchId ?? "unknown"}; expected ${EXPECTED_BRANCH_ID}`,
    );
  }

  const existing = await prisma.organization.findUnique({ where: { slug: ORGANIZATION_SLUG } });
  if (!existing) {
    throw new Error(`Organization "${ORGANIZATION_SLUG}" does not exist — run setup-ai-essentials-acceptance first`);
  }
  const settings = isObject(existing.settings) ? existing.settings : {};
  if (settings.openEnrollment === true) {
    process.stdout.write(`${ORGANIZATION_SLUG} already has openEnrollment set\n`);
    return;
  }

  await prisma.organization.update({
    where: { id: existing.id },
    data: { settings: { ...settings, openEnrollment: true } },
  });
  process.stdout.write(`Set openEnrollment: true on ${ORGANIZATION_SLUG} (${existing.id})\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
