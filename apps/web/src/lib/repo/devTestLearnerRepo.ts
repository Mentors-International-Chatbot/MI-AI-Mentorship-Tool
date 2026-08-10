import { prisma } from "@/lib/db";
import { resolveDelivery } from "@/lib/journey-package/delivery";

const TEST_EXTERNAL_ID = "dev-aiess-test-learner";
const TEST_NAME = "AI Essentials Test Learner";
const TEST_METADATA = {
  synthetic: true,
  testLogin: true,
  acceptanceRun: "dev-test-login",
} as const;

type PublishedAiEssentialsCandidate = {
  id: string;
  programId: string;
  metadata: unknown;
  program: {
    organizationId: string;
    organization: { settings: unknown };
  };
  collection: { organizationId: string } | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSyntheticTestMetadata(value: unknown): boolean {
  return isObject(value)
    && value.synthetic === true
    && value.testLogin === true
    && value.acceptanceRun === "dev-test-login";
}

export function selectSyntheticAiEssentialsVersion<T extends PublishedAiEssentialsCandidate>(
  candidates: readonly T[],
): T | null {
  const eligible = candidates.filter((candidate) => {
    const settings = candidate.program.organization.settings;
    const delivery = resolveDelivery(candidate.metadata);
    return isObject(settings)
      && settings.syntheticDataOnly === true
      && candidate.collection?.organizationId === candidate.program.organizationId
      && delivery.surface === "player"
      && delivery.supportedChannels.includes("web");
  });
  return eligible.length === 1 ? eligible[0] : null;
}

export class DevTestLearnerProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevTestLearnerProvisionError";
  }
}

export async function provisionDevAiEssentialsLearner(): Promise<{
  socioId: string;
  name: string;
  organizationId: string;
  programVersionId: string;
}> {
  const candidates = await prisma.programVersion.findMany({
    where: {
      status: "published",
      collection: { slug: "ai-essentials" },
    },
    select: {
      id: true,
      programId: true,
      metadata: true,
      program: {
        select: {
          organizationId: true,
          organization: { select: { settings: true } },
        },
      },
      collection: { select: { organizationId: true } },
    },
  });
  const version = selectSyntheticAiEssentialsVersion(candidates);
  if (!version) {
    throw new DevTestLearnerProvisionError(
      "Test learner requires exactly one published, web-enabled AI Essentials version owned by a synthetic organization",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const existingSocio = await tx.socio.findUnique({
      where: {
        channelType_externalId: {
          channelType: "web",
          externalId: TEST_EXTERNAL_ID,
        },
      },
      select: {
        id: true,
        metadata: true,
        curriculumCollectionKey: true,
      },
    });
    if (existingSocio && !isSyntheticTestMetadata(existingSocio.metadata)) {
      throw new DevTestLearnerProvisionError(
        "Refusing to reuse a non-synthetic learner record for test login",
      );
    }
    if (
      existingSocio?.curriculumCollectionKey
      && existingSocio.curriculumCollectionKey !== "ai-essentials"
    ) {
      throw new DevTestLearnerProvisionError(
        "Refusing to move the test learner from another curriculum",
      );
    }

    const socio = await tx.socio.upsert({
      where: {
        channelType_externalId: {
          channelType: "web",
          externalId: TEST_EXTERNAL_ID,
        },
      },
      create: {
        channelType: "web",
        externalId: TEST_EXTERNAL_ID,
        language: "en",
        name: TEST_NAME,
        status: "ACTIVE",
        metadata: TEST_METADATA,
      },
      update: {
        language: "en",
        name: TEST_NAME,
        status: "ACTIVE",
        metadata: TEST_METADATA,
      },
      select: { id: true, name: true },
    });
    await tx.socioProgress.upsert({
      where: { socioId: socio.id },
      create: { socioId: socio.id },
      update: {},
    });

    const existingParticipant = await tx.participantProfile.findUnique({
      where: { socioId: socio.id },
      select: { id: true, organizationId: true, metadata: true },
    });
    if (
      existingParticipant
      && (
        existingParticipant.organizationId !== version.program.organizationId
        || !isSyntheticTestMetadata(existingParticipant.metadata)
      )
    ) {
      throw new DevTestLearnerProvisionError(
        "Refusing to reuse a participant profile outside the synthetic AI Essentials organization",
      );
    }

    await tx.participantProfile.upsert({
      where: { socioId: socio.id },
      create: {
        organizationId: version.program.organizationId,
        socioId: socio.id,
        displayName: TEST_NAME,
        preferredLang: "en",
        metadata: TEST_METADATA,
      },
      update: {
        displayName: TEST_NAME,
        preferredLang: "en",
        metadata: TEST_METADATA,
      },
    });

    return { socioId: socio.id, name: socio.name ?? TEST_NAME };
  });

  return {
    ...result,
    organizationId: version.program.organizationId,
    programVersionId: version.id,
  };
}
