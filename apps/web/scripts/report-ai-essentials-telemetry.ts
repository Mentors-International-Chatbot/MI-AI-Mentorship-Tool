#!/usr/bin/env npx tsx
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/db";
import { programVersionConfigSchema } from "../src/lib/journey-package/program-version-config.schema";
import { deliveredTextMetrics } from "../src/lib/player/telemetryMetrics";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseDate(name: string): Date | undefined {
  const value = argument(name);
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${name} must be an ISO-8601 date`);
  return date;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

function percentiles(values: number[]) {
  return { p50: percentile(values, .5), p90: percentile(values, .9), p95: percentile(values, .95) };
}

type Group = {
  invocations: Array<{ responseLength: number | null; finishReason: string | null; success: boolean }>;
  messages: Array<{ content: string; generationStatus: string | null }>;
};

function summarize(group: Group) {
  const delivered = group.messages.map((message) => deliveredTextMetrics(message.content));
  const knownFinish = group.invocations.filter((item) => item.finishReason !== null);
  const knownGeneration = group.messages.filter((item) => item.generationStatus !== null);
  return {
    invocationCount: group.invocations.length,
    deliveredMessageCount: group.messages.length,
    rawResponseLength: percentiles(group.invocations.flatMap((item) => item.responseLength === null ? [] : [item.responseLength])),
    deliveredCharacters: percentiles(delivered.map((item) => item.characters)),
    deliveredSentences: percentiles(delivered.map((item) => item.sentences)),
    deliveredQuestions: {
      total: delivered.reduce((total, item) => total + item.questionCount, 0),
      ...percentiles(delivered.map((item) => item.questionCount)),
    },
    markdownIncidence: { count: delivered.filter((item) => item.markdown).length, rate: delivered.length ? delivered.filter((item) => item.markdown).length / delivered.length : null },
    providerLengthFinish: { count: knownFinish.filter((item) => item.finishReason === "length").length, rate: knownFinish.length ? knownFinish.filter((item) => item.finishReason === "length").length / knownFinish.length : null, unknown: group.invocations.length - knownFinish.length },
    invocationFailure: { count: group.invocations.filter((item) => !item.success).length, rate: group.invocations.length ? group.invocations.filter((item) => !item.success).length / group.invocations.length : null },
    persistedFallback: { count: knownGeneration.filter((item) => item.generationStatus === "fallback").length, rate: knownGeneration.length ? knownGeneration.filter((item) => item.generationStatus === "fallback").length / knownGeneration.length : null, unknown: group.messages.length - knownGeneration.length },
  };
}

async function main() {
  const programVersionId = argument("--program-version-id");
  if (!programVersionId) throw new Error("--program-version-id is required");
  const from = parseDate("--from");
  const to = parseDate("--to");
  if (from && to && from > to) throw new Error("--from must be before --to");
  const createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
  const version = await prisma.programVersion.findUnique({ where: { id: programVersionId }, select: { id: true, version: true, config: true, collection: { select: { slug: true } } } });
  if (!version) throw new Error(`ProgramVersion ${programVersionId} was not found`);

  const [invocations, messages, milestoneRows] = await Promise.all([
    prisma.aiInvocation.findMany({
      where: { context: { path: ["programVersionId"], equals: programVersionId }, ...(Object.keys(createdAt).length ? { createdAt } : {}) },
      select: { responseLength: true, finishReason: true, success: true, context: true },
    }),
    prisma.message.findMany({
      where: { role: "assistant", metadata: { path: ["programVersionId"], equals: programVersionId }, ...(Object.keys(createdAt).length ? { createdAt } : {}) },
      select: { content: true, metadata: true },
    }),
    version.collection ? prisma.milestoneProgress.findMany({
      where: { collectionKey: version.collection.slug, ...(Object.keys(createdAt).length ? { reachedAt: createdAt } : {}) },
      orderBy: [{ socioId: "asc" }, { reachedAt: "asc" }],
      select: { socioId: true, milestoneKey: true, reachedAt: true, evidence: true },
    }) : Promise.resolve([]),
  ]);

  const groups = new Map<string, Group>();
  const getGroup = (key: string) => {
    const group = groups.get(key) ?? { invocations: [], messages: [] };
    groups.set(key, group);
    return group;
  };
  for (const invocation of invocations) {
    const context = invocation.context && typeof invocation.context === "object" && !Array.isArray(invocation.context) ? invocation.context as Record<string, unknown> : {};
    const intent = typeof context.intent === "string" ? context.intent : "unknown";
    const parent = intent === "expand" && typeof context.parentIntent === "string" ? `:${context.parentIntent}` : "";
    getGroup(`${intent}${parent}`).invocations.push(invocation);
  }
  for (const message of messages) {
    const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata as Record<string, unknown> : {};
    const intent = typeof metadata.intent === "string" ? metadata.intent : "unknown";
    const parent = intent === "expand" && typeof metadata.parentIntent === "string" ? `:${metadata.parentIntent}` : "";
    getGroup(`${intent}${parent}`).messages.push({ content: message.content, generationStatus: typeof metadata.generationStatus === "string" ? metadata.generationStatus : null });
  }

  const byLearner = Map.groupBy(milestoneRows, (row) => row.socioId);
  const intervals = [...byLearner.values()].flatMap((rows) => rows.slice(1).map((row, index) => ({ socioId: row.socioId, previous: rows[index].milestoneKey, current: row.milestoneKey, seconds: (row.reachedAt.valueOf() - rows[index].reachedAt.valueOf()) / 1000 })));
  const shortEvidence = milestoneRows.filter((row) => (row.evidence?.trim().length ?? 0) < 20);
  const tooClose = [...byLearner.values()].flatMap((rows) => rows.slice(1).flatMap((row, index) => row.reachedAt.valueOf() - rows[index].reachedAt.valueOf() < 60_000 ? [{ socioId: row.socioId, previous: rows[index].milestoneKey, current: row.milestoneKey, seconds: (row.reachedAt.valueOf() - rows[index].reachedAt.valueOf()) / 1000 }] : []));
  const evidenceGroups = Map.groupBy(milestoneRows, (row) => `${row.socioId}:${row.evidence ?? ""}`);
  const multipleMarkers = [...evidenceGroups.values()].filter((rows) => rows.length > 1).map((rows) => ({ socioId: rows[0].socioId, milestoneKeys: rows.map((row) => row.milestoneKey), evidenceCharacters: rows[0].evidence?.length ?? 0 }));
  const config = programVersionConfigSchema.safeParse(version.config);

  const report = JSON.stringify({
    programVersion: { id: version.id, contentVersion: version.version, collectionKey: version.collection?.slug ?? null },
    range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
    byIntentAndExpansionParent: Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => [key, summarize(group)])),
    historicalUnknowns: { invocationsWithoutContext: invocations.filter((item) => !item.context).length, messagesWithoutGenerationStatus: messages.filter((item) => !(item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) && typeof (item.metadata as Record<string, unknown>).generationStatus === "string")).length },
    milestoneReview: {
      declaredMilestones: config.success ? config.data.outcome?.milestones.length ?? 0 : null,
      reachedCount: milestoneRows.length,
      timeBetweenMilestones: intervals,
      evidenceCharacterCounts: milestoneRows.map((row) => ({ socioId: row.socioId, milestoneKey: row.milestoneKey, characters: row.evidence?.trim().length ?? 0 })),
      lessThanSixtySecondsApart: tooClose,
      evidenceShorterThanTwentyCharacters: shortEvidence.map((row) => ({ socioId: row.socioId, milestoneKey: row.milestoneKey, characters: row.evidence?.trim().length ?? 0 })),
      multipleMarkersFromSameEvidence: multipleMarkers,
    },
  }, null, 2) + "\n";
  const output = argument("--output");
  if (output) {
    const outputPath = resolve(output);
    writeFileSync(outputPath, report);
    process.stdout.write(`Wrote telemetry report to ${outputPath}.\n`);
  } else {
    process.stdout.write(report);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
