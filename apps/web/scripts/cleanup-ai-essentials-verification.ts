#!/usr/bin/env npx tsx
import "dotenv/config";

import { prisma } from "../src/lib/db";

const EXPECTED_BRANCH_ID = "br-winter-cloud-ad3fou3i";
const ORGANIZATION_SLUG = "ai-essentials-verification";
const COURSE_SLUG = "ai-essentials";
const LEARNER_PREFIX = "aiess-b3-";

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  if (!process.argv.includes("--execute")) {
    throw new Error("Refusing cleanup without explicit --execute");
  }

  const [connection] = await prisma.$queryRawUnsafe<Array<{ branchId: string | null }>>(
    "SELECT current_setting('neon.branch_id', true) AS \"branchId\"",
  );
  if (connection?.branchId !== EXPECTED_BRANCH_ID) {
    throw new Error(`Refusing cleanup on branch ${connection?.branchId ?? "unknown"}`);
  }

  const organization = await prisma.organization.findUnique({
    where: { slug: ORGANIZATION_SLUG },
    include: {
      programs: { select: { slug: true } },
      collections: { select: { slug: true } },
      participants: { select: { socioId: true, metadata: true } },
    },
  });
  if (!organization) {
    process.stdout.write("Verification tenant is already absent.\n");
    return;
  }
  if (!isObject(organization.settings) || organization.settings.syntheticDataOnly !== true) {
    throw new Error("Refusing cleanup: organization is not marked syntheticDataOnly");
  }
  if (organization.programs.length !== 1 || organization.programs[0]?.slug !== COURSE_SLUG) {
    throw new Error("Refusing cleanup: unexpected programs exist in verification tenant");
  }
  if (organization.collections.length !== 1 || organization.collections[0]?.slug !== COURSE_SLUG) {
    throw new Error("Refusing cleanup: unexpected collections exist in verification tenant");
  }

  const socios = await prisma.socio.findMany({
    where: {
      OR: [
        { externalId: { startsWith: LEARNER_PREFIX } },
        { metadata: { path: ["acceptanceRun"], equals: "B3" } },
      ],
    },
    select: { id: true, externalId: true, metadata: true },
  });
  if (socios.length === 0 || socios.some((socio) =>
    !socio.externalId.startsWith(LEARNER_PREFIX)
    || !isObject(socio.metadata)
    || socio.metadata.synthetic !== true
    || socio.metadata.acceptanceRun !== "B3"
  )) {
    throw new Error("Refusing cleanup: learner tag/prefix invariant failed");
  }
  const socioIds = socios.map(({ id }) => id);
  const participantSocioIds = organization.participants.map(({ socioId, metadata }) => {
    if (!socioId || !isObject(metadata) || metadata.synthetic !== true || metadata.acceptanceRun !== "B3") {
      throw new Error("Refusing cleanup: verification tenant contains an untagged participant");
    }
    return socioId;
  });
  if (participantSocioIds.length !== socioIds.length
    || participantSocioIds.some((id) => !socioIds.includes(id))) {
    throw new Error("Refusing cleanup: participant and synthetic learner sets differ");
  }

  const result = await prisma.$transaction(async (tx) => {
    const sentiment = await tx.messageSentiment.deleteMany({ where: { socioId: { in: socioIds } } });
    const messages = await tx.message.deleteMany({ where: { socioId: { in: socioIds } } });
    const assessmentSessions = await tx.assessmentSession.deleteMany({ where: { socioId: { in: socioIds } } });
    const financialSnapshots = await tx.financialSnapshot.deleteMany({ where: { socioId: { in: socioIds } } });
    const lessonProgress = await tx.lessonProgress.deleteMany({ where: { socioId: { in: socioIds } } });
    const milestoneProgress = await tx.milestoneProgress.deleteMany({ where: { socioId: { in: socioIds } } });
    const contexts = await tx.socioContext.deleteMany({ where: { socioId: { in: socioIds } } });
    const flags = await tx.socioFlag.deleteMany({ where: { socioId: { in: socioIds } } });
    const progress = await tx.socioProgress.deleteMany({ where: { socioId: { in: socioIds } } });
    const summaries = await tx.summary.deleteMany({ where: { socioId: { in: socioIds } } });
    const invocations = await tx.aiInvocation.deleteMany({
      where: { OR: [{ socioId: { in: socioIds } }, { organizationId: organization.id }] },
    });
    await tx.organization.delete({ where: { id: organization.id } });
    const deletedSocios = await tx.socio.deleteMany({ where: { id: { in: socioIds } } });
    return {
      organization: 1,
      socios: deletedSocios.count,
      sentiments: sentiment.count,
      messages: messages.count,
      assessmentSessions: assessmentSessions.count,
      financialSnapshots: financialSnapshots.count,
      lessonProgress: lessonProgress.count,
      milestoneProgress: milestoneProgress.count,
      contexts: contexts.count,
      flags: flags.count,
      progress: progress.count,
      summaries: summaries.count,
      aiInvocations: invocations.count,
    };
  }, { timeout: 30_000 });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
