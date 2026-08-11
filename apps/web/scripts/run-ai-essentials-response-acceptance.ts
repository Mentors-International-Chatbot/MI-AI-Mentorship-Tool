#!/usr/bin/env npx tsx
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/db";
import type { DeliveryChannel } from "../src/lib/delivery/types";
import { handleIncomingMessage } from "../src/lib/messaging/handler";
import { lessonSchema } from "../src/lib/journey-package/journey-package.schema";
import { preparePlayerContext, resolvePlayerAccess, type PlayerParentIntent } from "../src/lib/player/service";
import { deliveredTextMetrics } from "../src/lib/player/telemetryMetrics";

const EXPECTED_BRANCH_ID = "br-misty-dawn-adj1cbft";
const ORGANIZATION_SLUG = "ai-essentials-verification";
const COLLECTION_KEY = "ai-essentials";

type Sample = { id: string; intent: PlayerParentIntent | "expand"; parentIntent?: PlayerParentIntent; lessonKey: string; message?: string; parentSampleId?: string };

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function progressSnapshot(socioId: string) {
  const [blocks, lessons, milestones] = await Promise.all([
    prisma.blockProgress.findMany({ where: { socioId }, orderBy: { id: "asc" } }),
    prisma.lessonProgress.findMany({ where: { socioId }, orderBy: { lessonNumber: "asc" } }),
    prisma.milestoneProgress.findMany({ where: { socioId, collectionKey: COLLECTION_KEY }, orderBy: { milestoneKey: "asc" } }),
  ]);
  return JSON.stringify({ blocks, lessons, milestones }, (_key, value) => value instanceof Date ? value.toISOString() : value);
}

async function main() {
  const [connection] = await prisma.$queryRawUnsafe<Array<{ branchId: string | null }>>("SELECT current_setting('neon.branch_id', true) AS \"branchId\"");
  if (connection?.branchId !== EXPECTED_BRANCH_ID) throw new Error(`Refusing response acceptance on branch ${connection?.branchId ?? "unknown"}; expected ${EXPECTED_BRANCH_ID}`);
  const contentVersion = argument("--content-version") ?? "1.1.0";
  const inputPath = resolve(argument("--inputs") ?? "../../content/ai-essentials-response-acceptance-inputs.json");
  const outputPath = resolve(argument("--output") ?? "../../content/ai-essentials-response-acceptance.json");
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as { contentVersion: string; samples: Sample[] };
  if (input.contentVersion !== contentVersion || input.samples.length !== 20) throw new Error("Acceptance input must contain exactly 20 samples for the requested content version");
  const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: ORGANIZATION_SLUG } });
  const settings = organization.settings as Record<string, unknown> | null;
  if (settings?.syntheticDataOnly !== true) throw new Error("Acceptance organization must be marked syntheticDataOnly");
  const version = await prisma.programVersion.findFirstOrThrow({ where: { version: contentVersion, program: { organizationId: organization.id, slug: COLLECTION_KEY }, status: { in: ["published", "archived"] } }, include: { program: true } });
  const cohort = await prisma.cohort.upsert({
    where: { programId_slug: { programId: version.programId, slug: `response-acceptance-${contentVersion.replaceAll(".", "-")}` } },
    create: { programId: version.programId, programVersionId: version.id, slug: `response-acceptance-${contentVersion.replaceAll(".", "-")}`, name: `Response acceptance ${contentVersion}` },
    update: { programVersionId: version.id },
  });
  const runId = randomUUID();
  const externalId = `aiess-response-${runId}`;
  const socio = await prisma.socio.create({ data: { channelType: "web", externalId, language: "en", name: "Synthetic Response Reviewer", status: "ACTIVE", curriculumCollectionKey: COLLECTION_KEY, metadata: { synthetic: true, acceptanceRun: "response", runId }, progress: { create: {} } } });
  const participant = await prisma.participantProfile.create({ data: { organizationId: organization.id, socioId: socio.id, displayName: "Synthetic Response Reviewer", preferredLang: "en", metadata: { synthetic: true, acceptanceRun: "response", runId } } });
  await prisma.enrollment.create({ data: { participantId: participant.id, cohortId: cohort.id, programVersionId: version.id, metadata: { synthetic: true, acceptanceRun: "response", runId } } });
  const access = await resolvePlayerAccess({ userId: socio.id, externalId, role: "socio", name: socio.name ?? "Synthetic learner", socioId: socio.id, channel: "web" }, "AIESS");
  const sent: string[] = [];
  const channel: DeliveryChannel = { getChannelType: () => "web", sendMessage: async (_recipient, text) => { sent.push(text); } };
  const contexts = new Map<string, { blockId?: string; intent: PlayerParentIntent }>();
  const outputs: unknown[] = [];

  for (const sample of input.samples) {
    let blockId: string | undefined;
    if (sample.parentSampleId) blockId = contexts.get(sample.parentSampleId)?.blockId;
    if (!blockId && sample.lessonKey !== "capstone" && sample.intent !== "lesson_entry") {
      const row = await prisma.contentLesson.findFirstOrThrow({ where: { slug: sample.lessonKey, collection: { programVersions: { some: { id: version.id } } } }, include: { versions: { where: { version: contentVersion }, take: 1 } } });
      const lesson = lessonSchema.parse(row.versions[0]?.body);
      blockId = sample.intent === "teach_back" ? lesson.blocks.find((block) => block.blockType === "teach_back")?.id : lesson.blocks[0]?.id;
    }
    const parentIntent = sample.intent === "expand" ? sample.parentIntent : undefined;
    const context = await preparePlayerContext(access, { lessonKey: sample.lessonKey, blockId, intent: sample.intent, parentIntent });
    const before = sample.intent === "expand" ? await progressSnapshot(socio.id) : null;
    const startedAt = new Date();
    const result = await handleIncomingMessage({ externalId, channelType: "web", channel, language: "en", message: sample.message ?? "Explain more.", playerContext: context });
    const after = sample.intent === "expand" ? await progressSnapshot(socio.id) : null;
    const trace = await prisma.aiInvocation.findFirst({ where: { socioId: socio.id, createdAt: { gte: startedAt }, context: { path: ["programVersionId"], equals: version.id } }, orderBy: { createdAt: "desc" }, select: { model: true, promptHash: true, finishReason: true, success: true } });
    const metrics = deliveredTextMetrics(result.responseText);
    const maxSentences = sample.intent === "expand" ? 6 : 3;
    const completeEnding = /[.!?]["')\]]?$/u.test(result.responseText.trim());
    outputs.push({ ...sample, blockId, output: result.responseText, model: trace?.model ?? null, promptHash: trace?.promptHash ?? null, finishReason: trace?.finishReason ?? null, generationStatus: result.isError ? "fallback" : "success", metrics, progressUnchanged: sample.intent === "expand" ? before === after : null, acceptance: { sentenceLimit: metrics.sentences <= maxSentences, questionLimit: metrics.questionCount <= 1, noMarkdown: !metrics.markdown, completeEnding, noLengthFinish: trace?.finishReason !== "length", noExpansionProgress: sample.intent !== "expand" || before === after } });
    if (sample.intent !== "expand") contexts.set(sample.id, { blockId, intent: sample.intent });
  }
  const failed = outputs.flatMap((output) => Object.values((output as { acceptance: Record<string, boolean> }).acceptance).every(Boolean) ? [] : [(output as { id: string }).id]);
  const artifact = { generatedAt: new Date().toISOString(), runId, programVersionId: version.id, contentVersion, samples: outputs, automatedAcceptance: { passed: failed.length === 0, failedSampleIds: failed }, professorReview: { required: true, completed: false, rubric: ["conversational tone", "clarity", "usefulness", "concision"], passingRule: "At least 18/20 score 4+ on every dimension; no score may be 1 or 2." } };
  writeFileSync(outputPath, JSON.stringify(artifact, null, 2) + "\n");
  process.stdout.write(`Wrote ${outputs.length} response samples to ${outputPath}; automated gate ${failed.length ? `failed: ${failed.join(", ")}` : "passed"}.\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
