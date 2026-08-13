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
import { finalQuestionHasOneFocus, hasTutorSelfIntroduction, repeatsParentOpening } from "../src/lib/player/responseStyle";

const EXPECTED_BRANCH_ID = "br-misty-dawn-adj1cbft";
const ORGANIZATION_SLUG = "ai-essentials-verification";
const COLLECTION_KEY = "ai-essentials";

type Sample = { id: string; intent: PlayerParentIntent | "expand"; parentIntent?: PlayerParentIntent; lessonKey: string; message?: string; parentSampleId?: string; identityAnchors?: string[]; domainNeutral?: boolean; requiresPromptStartingPoint?: boolean };
type SampleOutput = Sample & {
  blockId?: string;
  output: string;
  model: string | null;
  promptHash: string | null;
  finishReason: string | null;
  generationStatus: "success" | "fallback";
  attempts: number;
  metrics: ReturnType<typeof deliveredTextMetrics>;
  progressUnchanged: boolean | null;
  acceptance: Record<string, boolean>;
};
type LessonIdentity = { title: string; otherTitles: string[] };
type Checkpoint = {
  status: "running" | "failed" | "complete";
  runStartedAt: string;
  generatedAt: string | null;
  runId: string;
  socioId: string;
  externalId: string;
  programVersionId: string;
  contentVersion: string;
  nextSampleIndex: number;
  samples: SampleOutput[];
  lastError: { sampleId: string; message: string; at: string } | null;
  automatedAcceptance: { passed: boolean; failedSampleIds: string[] } | null;
  professorReview: {
    required: true;
    completed: false;
    rubric: string[];
    passingRule: string;
  };
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function writeCheckpoint(outputPath: string, checkpoint: Checkpoint): void {
  writeFileSync(outputPath, JSON.stringify(checkpoint, null, 2) + "\n");
}

function positiveIntegerArgument(name: string, fallback: number): number {
  const raw = argument(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function expansionAddsNewOpening(parent: string | undefined, expanded: string): boolean {
  return Boolean(parent) && !repeatsParentOpening(parent, expanded);
}

const COURSE_DOMAIN_TERMS = /\b(?:supply chains?|suppliers?|shipments?|inventory|demand forecast(?:ing)?|safety stock|procurement|customer service|outdoor gear|marketing(?: email| campaign)?|baker(?:y|ies)|medical(?: diagnosis| clinic| advice)?|hiring tool|restaurants?)\b/iu;
const STOCK_TEACHBACK_PRAISE = /\b(?:you(?:'ve| have)? nailed|complete shape|right (?:frame|order)|you(?:'ve| have)? (?:named|captured|listed|identified)(?: all| the| this)?|that(?:'s| is) exactly (?:the|right)|you(?:'ve| have) (?:got|mapped) the)\b/iu;
const PROMPT_STARTING_POINT = /\b(?:act as|role)\b[\s\S]*\b(?:context|using)\b[\s\S]*\b(?:output|create)\b/iu;

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
  const resume = process.argv.includes("--resume");
  const maxSampleAttempts = positiveIntegerArgument("--max-sample-attempts", 3);
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as { contentVersion: string; samples: Sample[] };
  if (input.contentVersion !== contentVersion || input.samples.length !== 25) throw new Error("Acceptance input must contain exactly 25 samples for the requested content version");
  const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: ORGANIZATION_SLUG } });
  const settings = organization.settings as Record<string, unknown> | null;
  if (settings?.syntheticDataOnly !== true) throw new Error("Acceptance organization must be marked syntheticDataOnly");
  const version = await prisma.programVersion.findFirstOrThrow({ where: { version: contentVersion, program: { organizationId: organization.id, slug: COLLECTION_KEY }, status: { in: ["published", "archived"] } }, include: { program: true } });
  const cohort = await prisma.cohort.upsert({
    where: { programId_slug: { programId: version.programId, slug: `response-acceptance-${contentVersion.replaceAll(".", "-")}` } },
    create: { programId: version.programId, programVersionId: version.id, slug: `response-acceptance-${contentVersion.replaceAll(".", "-")}`, name: `Response acceptance ${contentVersion}` },
    update: { programVersionId: version.id },
  });
  let checkpoint: Checkpoint;
  let socio;
  if (resume) {
    checkpoint = JSON.parse(readFileSync(outputPath, "utf8")) as Checkpoint;
    if (checkpoint.contentVersion !== contentVersion || checkpoint.programVersionId !== version.id) throw new Error("Checkpoint does not match the requested released version");
    if (checkpoint.status === "complete") throw new Error("Checkpoint is already complete; omit --resume to start a new run");
    if (checkpoint.nextSampleIndex !== checkpoint.samples.length || checkpoint.nextSampleIndex > input.samples.length) throw new Error("Checkpoint sample index is inconsistent");
    socio = await prisma.socio.findUniqueOrThrow({ where: { id: checkpoint.socioId } });
    process.stdout.write(`Resuming ${checkpoint.runId} at sample ${checkpoint.nextSampleIndex + 1}/${input.samples.length}.\n`);
  } else {
    const runId = randomUUID();
    const externalId = `aiess-response-${runId}`;
    socio = await prisma.socio.create({ data: { channelType: "web", externalId, language: "en", name: "Synthetic Response Reviewer", status: "ACTIVE", curriculumCollectionKey: COLLECTION_KEY, metadata: { synthetic: true, acceptanceRun: "response", runId }, progress: { create: {} } } });
    const participant = await prisma.participantProfile.create({ data: { organizationId: organization.id, socioId: socio.id, displayName: "Synthetic Response Reviewer", preferredLang: "en", metadata: { synthetic: true, acceptanceRun: "response", runId } } });
    await prisma.enrollment.create({ data: { participantId: participant.id, cohortId: cohort.id, programVersionId: version.id, metadata: { synthetic: true, acceptanceRun: "response", runId } } });
    checkpoint = {
      status: "running", runStartedAt: new Date().toISOString(), generatedAt: null,
      runId, socioId: socio.id, externalId, programVersionId: version.id, contentVersion,
      nextSampleIndex: 0, samples: [], lastError: null, automatedAcceptance: null,
      professorReview: { required: true, completed: false, rubric: ["conversational tone", "clarity", "usefulness", "concision"], passingRule: "At least 23/25 score 4+ on every dimension; no score may be 1 or 2." },
    };
    writeCheckpoint(outputPath, checkpoint);
  }
  const { externalId } = checkpoint;
  const access = await resolvePlayerAccess({ userId: socio.id, externalId, role: "socio", name: socio.name ?? "Synthetic learner", socioId: socio.id, channel: "web" }, "AIESS");
  const lessonIdentityRows = await prisma.contentLesson.findMany({
    where: { collection: { programVersions: { some: { id: version.id } } }, versions: { some: { version: contentVersion } } },
    select: { slug: true, versions: { where: { version: contentVersion }, take: 1, select: { body: true } } },
  });
  const allLessonTitles = lessonIdentityRows.map((row) => lessonSchema.parse(row.versions[0]?.body).title);
  const lessonIdentities = new Map<string, LessonIdentity>(lessonIdentityRows.map((row) => {
    const title = lessonSchema.parse(row.versions[0]?.body).title;
    return [row.slug, { title, otherTitles: allLessonTitles.filter((candidate) => candidate !== title) }];
  }));
  const sent: string[] = [];
  const channel: DeliveryChannel = { getChannelType: () => "web", sendMessage: async (_recipient, text) => { sent.push(text); } };
  const contexts = new Map<string, { blockId?: string; intent: PlayerParentIntent }>();
  for (const prior of checkpoint.samples) if (prior.intent !== "expand") contexts.set(prior.id, { blockId: prior.blockId, intent: prior.intent });

  for (let sampleIndex = checkpoint.nextSampleIndex; sampleIndex < input.samples.length; sampleIndex++) {
    const sample = input.samples[sampleIndex];
    let blockId: string | undefined;
    if (sample.parentSampleId) blockId = contexts.get(sample.parentSampleId)?.blockId;
    if (!blockId && sample.lessonKey !== "capstone" && sample.intent !== "lesson_entry") {
      const row = await prisma.contentLesson.findFirstOrThrow({ where: { slug: sample.lessonKey, collection: { programVersions: { some: { id: version.id } } } }, include: { versions: { where: { version: contentVersion }, take: 1 } } });
      const lesson = lessonSchema.parse(row.versions[0]?.body);
      blockId = sample.intent === "teach_back" ? lesson.blocks.find((block) => block.blockType === "teach_back")?.id : lesson.blocks[0]?.id;
    }
    const parentIntent = sample.intent === "expand" ? sample.parentIntent : undefined;
    let result: Awaited<ReturnType<typeof handleIncomingMessage>> | undefined;
    let context: Awaited<ReturnType<typeof preparePlayerContext>> | undefined;
    let startedAt = new Date();
    let before: string | null = null;
    let after: string | null = null;
    let attempts = 0;
    try {
      for (attempts = 1; attempts <= maxSampleAttempts; attempts++) {
        context = await preparePlayerContext(access, { lessonKey: sample.lessonKey, blockId, intent: sample.intent, parentIntent });
        before = sample.intent === "expand" ? await progressSnapshot(socio.id) : null;
        startedAt = new Date();
        result = await handleIncomingMessage({
          externalId, channelType: "web", channel, language: "en",
          message: sample.message ?? "Explain more.", playerContext: context,
          // This suite measures tutor writing and player state. Sensing has its
          // own acceptance run; launching a second model here couples response
          // quality to unrelated provider latency and observation writes.
          overrideDimensionState: {},
        });
        after = sample.intent === "expand" ? await progressSnapshot(socio.id) : null;
        const delivered = !result.isError && !result.suppressed && result.responseText.trim().length > 0;
        if (delivered || attempts === maxSampleAttempts) break;
        process.stdout.write(`Retrying ${sample.id} after fallback (${attempts}/${maxSampleAttempts}).\n`);
      }
    } catch (error) {
      checkpoint.status = "failed";
      checkpoint.lastError = { sampleId: sample.id, message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() };
      writeCheckpoint(outputPath, checkpoint);
      throw error;
    }
    if (!result || !context) throw new Error(`No result produced for ${sample.id}`);
    const trace = await prisma.aiInvocation.findFirst({ where: { socioId: socio.id, createdAt: { gte: startedAt }, context: { path: ["programVersionId"], equals: version.id } }, orderBy: { createdAt: "desc" }, select: { model: true, promptHash: true, finishReason: true, success: true } });
    const metrics = deliveredTextMetrics(result.responseText);
    const maxSentences = sample.intent === "expand" ? 6 : 3;
    const completeEnding = /[.!?](?:["')\]]|\p{Extended_Pictographic}|\uFE0F|\s)*$/u.test(result.responseText.trim());
    const expansionGrounded = sample.intent !== "expand" || !/(?:do not|don't|cannot|can't) see (?:a )?prior|no prior .*reply|first message (?:in|of) (?:our|this) (?:chat|conversation)|prior .* (?:is )?missing/iu.test(result.responseText);
    const expansionNewOpening = sample.intent !== "expand" || expansionAddsNewOpening(checkpoint.samples.find((item) => item.id === sample.parentSampleId)?.output, result.responseText);
    const lessonIdentity = lessonIdentities.get(sample.lessonKey);
    const normalizedOutput = result.responseText.toLocaleLowerCase();
    const matchingIdentityAnchors = sample.identityAnchors?.filter((anchor) => normalizedOutput.includes(anchor.toLocaleLowerCase())).length ?? 0;
    const correctLessonIdentity = sample.intent !== "lesson_entry" || !lessonIdentity || (
      (sample.identityAnchors ? matchingIdentityAnchors >= Math.min(2, sample.identityAnchors.length) : normalizedOutput.includes(lessonIdentity.title.toLocaleLowerCase()))
      && !lessonIdentity.otherTitles.some((title) => normalizedOutput.includes(title.toLocaleLowerCase()))
    );
    const cleanLessonEntry = sample.intent !== "lesson_entry" || (!/^\s*(?:lesson|module)\s+\d+\s*:/iu.test(result.responseText) && !/\[(?:end|start|complete)[^\]]*\]/iu.test(result.responseText));
    const successfulGeneration = !result.isError && !result.suppressed && result.responseText.trim().length > 0;
    const characterRange = sample.intent === "expand" ? { min: 450, max: 700 } : { min: 200, max: 420 };
    const noSelfReference = !hasTutorSelfIntroduction(result.responseText, "AI Mentor") && !hasTutorSelfIntroduction(result.responseText, "Tutor");
    checkpoint.samples.push({ ...sample, blockId, output: result.responseText, model: trace?.model ?? null, promptHash: trace?.promptHash ?? null, finishReason: trace?.finishReason ?? null, generationStatus: successfulGeneration ? "success" : "fallback", attempts, metrics, progressUnchanged: sample.intent === "expand" ? before === after : null, acceptance: { sentenceLimit: metrics.sentences <= maxSentences, sentenceWordLimit: metrics.maxSentenceWords <= 35, characterRange: metrics.characters >= characterRange.min && metrics.characters <= characterRange.max, questionLimit: metrics.questionCount <= 1, questionPosition: metrics.questionInFinalSentence, singleFocusQuestion: finalQuestionHasOneFocus(result.responseText), asciiPunctuation: metrics.asciiPunctuation, singleParagraph: metrics.singleParagraph, noSelfReference, noMarkdown: !metrics.markdown, completeEnding, noLengthFinish: trace?.finishReason !== "length", successfulGeneration, noExpansionProgress: sample.intent !== "expand" || before === after, expansionGrounded, expansionNewOpening, correctLessonIdentity, cleanLessonEntry, domainNeutral: !sample.domainNeutral || !COURSE_DOMAIN_TERMS.test(result.responseText), noStockTeachbackPraise: (sample.intent !== "teach_back" && sample.parentIntent !== "teach_back") || !STOCK_TEACHBACK_PRAISE.test(result.responseText), promptStartingPoint: !sample.requiresPromptStartingPoint || PROMPT_STARTING_POINT.test(result.responseText) } });
    if (sample.intent !== "expand") contexts.set(sample.id, { blockId, intent: sample.intent });
    checkpoint.nextSampleIndex = sampleIndex + 1;
    checkpoint.status = "running";
    checkpoint.lastError = null;
    writeCheckpoint(outputPath, checkpoint);
    process.stdout.write(`Checkpointed ${sample.id} (${checkpoint.nextSampleIndex}/${input.samples.length}).\n`);
  }
  const failed = checkpoint.samples.flatMap((output) => Object.values(output.acceptance).every(Boolean) ? [] : [output.id]);
  checkpoint.status = "complete";
  checkpoint.generatedAt = new Date().toISOString();
  checkpoint.automatedAcceptance = { passed: failed.length === 0, failedSampleIds: failed };
  writeCheckpoint(outputPath, checkpoint);
  process.stdout.write(`Wrote ${checkpoint.samples.length} response samples to ${outputPath}; automated gate ${failed.length ? `failed: ${failed.join(", ")}` : "passed"}.\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
