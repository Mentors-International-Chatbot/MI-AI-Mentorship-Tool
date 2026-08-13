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
import { finalQuestionHasOneFocus, hasPromptStartingPoint, hasTutorSelfIntroduction, repeatsParentOpening } from "../src/lib/player/responseStyle";

const EXPECTED_BRANCH_ID = "br-misty-dawn-adj1cbft";
const ORGANIZATION_SLUG = "ai-essentials-verification";
const COLLECTION_KEY = "ai-essentials";

type Sample = { id: string; intent: PlayerParentIntent | "expand"; parentIntent?: PlayerParentIntent; lessonKey: string; message?: string; parentSampleId?: string; identityAnchors?: string[]; requiresPromptStartingPoint?: boolean };
type SampleOutput = Sample & {
  blockId?: string;
  output: string;
  model: string | null;
  promptHash: string | null;
  finishReason: string | null;
  generationStatus: "success" | "fallback";
  attempts: number;
  sampleAttempts: number;
  deliveryPath: "first_draft" | "repair" | "sample_retry_first_draft" | "sample_retry_repair";
  repairDrafts: number;
  firstDraftViolations: string[];
  providerTimeouts: number;
  metrics: ReturnType<typeof deliveredTextMetrics>;
  progressUnchanged: boolean | null;
  acceptance: Record<string, boolean | null>;
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
  generationPolicy?: { timeoutMs: number; maxSampleAttempts: number; allowFallback: false };
  timeoutSummary?: { providerAttempts: number; providerTimeouts: number; rate: number | null };
  generationSummary?: {
    firstAttemptPass: { count: number; rate: number };
    deliveredWithoutRepair: { count: number; rate: number };
    deliveredAfterRepair: { count: number; rate: number };
    sampleRetry: { count: number; rate: number };
    livePathProjection: {
      successful: { count: number; rate: number };
      fallback: { count: number; rate: number };
      providerCalls: number;
      averageCallsPerTurn: number;
    };
  };
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function expansionAddsNewOpening(parent: string | undefined, expanded: string): boolean {
  return Boolean(parent) && !repeatsParentOpening(parent, expanded);
}

const STOCK_TEACHBACK_PRAISE = /\b(?:you(?:'ve| have)? nailed|complete shape|right (?:frame|order)|you(?:'ve| have)? (?:named|captured|listed|identified)(?: all| the| this)?|that(?:'s| is) exactly (?:the|right)|you(?:'ve| have) (?:got|mapped) the)\b/iu;

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
  const firstDraftOnly = process.argv.includes("--first-draft-only");
  const timeoutMs = positiveIntegerArgument("--timeout-ms", 75_000);
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
      generationPolicy: { timeoutMs, maxSampleAttempts: firstDraftOnly ? 1 : 3, allowFallback: false },
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
    let sampleAttempts = 0;
    let providerTimeouts = 0;
    const styleValidations: Array<{ sampleAttempt: number; stage: "initial" | "repair"; repairIndex: number; passed: boolean; violations: string[] }> = [];
    try {
      let lastError: unknown;
      const maxSampleAttempts = firstDraftOnly ? 1 : 3;
      for (sampleAttempts = 1; sampleAttempts <= maxSampleAttempts; sampleAttempts++) {
        try {
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
            // Acceptance is a buffered batch job. The outer loop retries the
            // complete generation and style-validation path twice. No attempt
            // is allowed to substitute fallback text.
            bufferedGenerationPolicy: {
              timeoutMs, maxRetries: 0, retryTimeouts: true, allowFallback: false,
              observeFirstDraftOnly: firstDraftOnly,
              onAttempt: () => { attempts += 1; },
              onAttemptFailure: ({ timeout }) => { if (timeout) providerTimeouts += 1; },
              onStyleValidation: (event) => { styleValidations.push({ sampleAttempt: sampleAttempts, ...event }); },
            },
          });
          after = sample.intent === "expand" ? await progressSnapshot(socio.id) : null;
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (sampleAttempts < maxSampleAttempts) {
            process.stdout.write(`Retrying ${sample.id} after hard generation failure (${sampleAttempts}/${maxSampleAttempts}).\n`);
            await wait(2 ** (sampleAttempts - 1) * 1000);
          }
        }
      }
      if (lastError) throw lastError;
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
    let correctLessonIdentity: boolean | null = null;
    if (sample.intent === "lesson_entry") {
      correctLessonIdentity = lessonIdentity !== undefined && (
        (sample.identityAnchors ? matchingIdentityAnchors >= Math.min(2, sample.identityAnchors.length) : normalizedOutput.includes(lessonIdentity.title.toLocaleLowerCase()))
        && !lessonIdentity.otherTitles.some((title) => normalizedOutput.includes(title.toLocaleLowerCase()))
      );
    }
    const cleanLessonEntry = sample.intent !== "lesson_entry" ? null : !/^\s*(?:lesson|module)\s+\d+\s*:/iu.test(result.responseText) && !/\[(?:end|start|complete)[^\]]*\]/iu.test(result.responseText);
    const successfulGeneration = !result.isError && !result.suppressed && result.responseText.trim().length > 0 && trace?.success === true;
    const characterRange = sample.intent === "expand" ? { min: 450, max: 700 } : { min: 200, max: 420 };
    const noSelfReference = !hasTutorSelfIntroduction(result.responseText, "AI Mentor") && !hasTutorSelfIntroduction(result.responseText, "Tutor");
    const deliveredValidation = styleValidations.findLast((event) => event.passed) ?? styleValidations.at(-1);
    if (!deliveredValidation) throw new Error(`No style validation recorded for ${sample.id}`);
    const usedRepair = deliveredValidation.stage === "repair";
    const deliveryPath: SampleOutput["deliveryPath"] = sampleAttempts === 1
      ? (usedRepair ? "repair" : "first_draft")
      : (usedRepair ? "sample_retry_repair" : "sample_retry_first_draft");
    const firstDraftViolations = styleValidations.find((event) => event.sampleAttempt === 1 && event.stage === "initial")?.violations ?? [];
    checkpoint.samples.push({ ...sample, blockId, output: result.responseText, model: trace?.model ?? null, promptHash: trace?.promptHash ?? null, finishReason: trace?.finishReason ?? null, generationStatus: successfulGeneration ? "success" : "fallback", attempts, sampleAttempts, deliveryPath, repairDrafts: styleValidations.filter((event) => event.stage === "repair").length, firstDraftViolations, providerTimeouts, metrics, progressUnchanged: sample.intent === "expand" ? before === after : null, acceptance: { sentenceLimit: metrics.sentences <= maxSentences, sentenceWordLimit: metrics.maxSentenceWords <= 35, commaChainedEnumeration: !metrics.commaChainedEnumeration, characterRange: metrics.characters >= characterRange.min && metrics.characters <= characterRange.max, questionLimit: metrics.questionCount <= 1, questionPosition: metrics.questionInFinalSentence, singleFocusQuestion: finalQuestionHasOneFocus(result.responseText), asciiPunctuation: metrics.asciiPunctuation, singleParagraph: metrics.singleParagraph, noSelfReference, noMarkdown: !metrics.markdown, completeEnding, traceRecorded: trace !== null, noLengthFinish: trace !== null && trace.finishReason !== "length", successfulGeneration, noExpansionProgress: sample.intent === "expand" ? before === after : null, expansionGrounded: sample.intent === "expand" ? expansionGrounded : null, expansionNewOpening: sample.intent === "expand" ? expansionNewOpening : null, correctLessonIdentity, cleanLessonEntry, noStockTeachbackPraise: (sample.intent === "teach_back" || sample.parentIntent === "teach_back") ? !STOCK_TEACHBACK_PRAISE.test(result.responseText) : null, promptStartingPoint: sample.requiresPromptStartingPoint ? hasPromptStartingPoint(result.responseText) : null } });
    if (sample.intent !== "expand") contexts.set(sample.id, { blockId, intent: sample.intent });
    checkpoint.nextSampleIndex = sampleIndex + 1;
    checkpoint.status = "running";
    checkpoint.lastError = null;
    writeCheckpoint(outputPath, checkpoint);
    process.stdout.write(`Checkpointed ${sample.id} (${checkpoint.nextSampleIndex}/${input.samples.length}).\n`);
  }
  const failed = checkpoint.samples.flatMap((output) => Object.values(output.acceptance).every((value) => value !== false) && output.generationStatus === "success" ? [] : [output.id]);
  checkpoint.status = "complete";
  checkpoint.generatedAt = new Date().toISOString();
  checkpoint.automatedAcceptance = { passed: failed.length === 0, failedSampleIds: failed };
  const providerAttempts = checkpoint.samples.reduce((total, sample) => total + sample.attempts, 0);
  const providerTimeouts = checkpoint.samples.reduce((total, sample) => total + sample.providerTimeouts, 0);
  checkpoint.generationPolicy = { timeoutMs, maxSampleAttempts: firstDraftOnly ? 1 : 3, allowFallback: false };
  checkpoint.timeoutSummary = { providerAttempts, providerTimeouts, rate: providerAttempts ? providerTimeouts / providerAttempts : null };
  const firstAttemptPassCount = checkpoint.samples.filter((sample) => sample.firstDraftViolations.length === 0).length;
  const deliveredWithoutRepairCount = checkpoint.samples.filter((sample) => sample.deliveryPath === "first_draft" || sample.deliveryPath === "sample_retry_first_draft").length;
  const deliveredAfterRepairCount = checkpoint.samples.filter((sample) => sample.deliveryPath === "repair" || sample.deliveryPath === "sample_retry_repair").length;
  const sampleRetryCount = checkpoint.samples.filter((sample) => sample.sampleAttempts > 1).length;
  const liveSuccessCount = checkpoint.samples.filter((sample) => sample.sampleAttempts === 1).length;
  const liveProviderCalls = checkpoint.samples.reduce((total, sample) => total + (sample.firstDraftViolations.length === 0 ? 1 : 2), 0);
  checkpoint.generationSummary = {
    firstAttemptPass: { count: firstAttemptPassCount, rate: firstAttemptPassCount / checkpoint.samples.length },
    deliveredWithoutRepair: { count: deliveredWithoutRepairCount, rate: deliveredWithoutRepairCount / checkpoint.samples.length },
    deliveredAfterRepair: { count: deliveredAfterRepairCount, rate: deliveredAfterRepairCount / checkpoint.samples.length },
    sampleRetry: { count: sampleRetryCount, rate: sampleRetryCount / checkpoint.samples.length },
    livePathProjection: {
      successful: { count: liveSuccessCount, rate: liveSuccessCount / checkpoint.samples.length },
      fallback: { count: checkpoint.samples.length - liveSuccessCount, rate: (checkpoint.samples.length - liveSuccessCount) / checkpoint.samples.length },
      providerCalls: liveProviderCalls,
      averageCallsPerTurn: liveProviderCalls / checkpoint.samples.length,
    },
  };
  writeCheckpoint(outputPath, checkpoint);
  process.stdout.write(`Wrote ${checkpoint.samples.length} response samples to ${outputPath}; automated gate ${failed.length ? `failed: ${failed.join(", ")}` : "passed"}.\n`);
  process.stdout.write(`Provider attempt timeouts: ${providerTimeouts}/${providerAttempts} (${providerAttempts ? (providerTimeouts / providerAttempts * 100).toFixed(1) : "0.0"}%).\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
