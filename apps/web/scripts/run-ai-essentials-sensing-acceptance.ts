#!/usr/bin/env npx tsx
import "dotenv/config";

import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import type { DeliveryChannel } from "../src/lib/delivery/types";
import { handleIncomingMessage } from "../src/lib/messaging/handler";
import {
  preparePlayerContext,
  resolvePlayerAccess,
  type PlayerAccess,
} from "../src/lib/player/service";
import { lessonSchema } from "../src/lib/journey-package/journey-package.schema";
import { senseAndScore } from "../src/lib/ai/sensing/senseAndScore";

const COURSE_CODE = "AIESS";
const COLLECTION_KEY = "ai-essentials";
const DEFAULT_ORGANIZATION = "ai-essentials-verification";
const DEFAULT_LESSON_INDICES = [1, 2, 3];
const EXPECTED_DIMENSION_COUNT = 11;
const PREVIOUSLY_UNOBSERVED_DIMENSIONS = [
  "ai_systems",
  "expert_systems",
  "model_selection",
  "prompting",
] as const;

const ANSWERS: Record<string, [string, string]> = {
  "ai-day-in-the-life": [
    "AI changes everyday work by drafting customer emails and summarizing meetings. It can make each task cheaper and faster, but Jevons paradox means demand may grow enough that people do more total work, so a human still reviews the result.",
    "I would measure minutes saved per reviewed email and the number of useful customer replies, while checking whether faster output creates more total requests rather than assuming productivity automatically reduces workload.",
  ],
  "ai-magic-examples": [
    "Machine learning learns statistical patterns from examples instead of following only hand-written rules. This changes work and daily life by helping people classify or generate useful content faster, but it can hallucinate a plausible false claim, so important facts need source verification.",
    "For a support assistant, I would ground answers in approved documents, require citations, and route uncertain answers to a person. That keeps the productivity benefit while treating fluent output as a prediction rather than truth.",
  ],
  "ai-revolution-vs-past": [
    "Earlier machines scaled physical power, while modern AI scales prediction and parts of knowledge work. A model trained on many examples can reshape individual job tasks without replacing every part of a job or guaranteeing its claims are true.",
    "A practical example is an analyst using AI to find patterns and draft a first pass, then applying judgment to validate assumptions and evidence. The work changes from producing every line manually to directing and checking the system.",
  ],
  "ai-ceo-explain-models": [
    "Machine learning models learn patterns from examples, then use those patterns to predict or generate an output for a new case. A CEO choosing a model should compare quality, cost, speed, privacy, and whether a specialized or general model fits the actual business task.",
    "For customer-support triage, I would test a few candidate models on the same representative cases and choose the smallest model that meets accuracy and privacy requirements. I would not assume the most capable general model is automatically the best operational choice.",
  ],
  "ai-expert-vs-ml": [
    "An expert system follows rules written by people, such as approving an expense only when several explicit conditions are met. Machine learning instead learns statistical patterns from examples, so it can handle fuzzier inputs but needs evaluation because its answer is not a guaranteed fact.",
    "I would use an expert system for stable compliance rules that must be explainable, and machine learning for classifying varied support requests. A combined system could let the model classify the request while deterministic rules control the final allowed action.",
  ],
  "ai-prompting-iteration": [
    "Prompting is an iterative specification process: give the model a goal, relevant context, constraints, and an output format, inspect the result, then revise the prompt based on the failure. One useful prompt asks for a cited summary for a named audience rather than simply saying summarize this.",
    "If the result is vague, I would add an example, define what good looks like, and ask the model to identify uncertainty. I would test the revised prompt on several cases so one polished response does not hide a brittle prompting pattern or hallucination.",
  ],
  "ai-model-landscape": [
    "Model selection means matching the system to the job instead of treating every AI product as a chatbot. I would compare a general language model, a smaller specialized model, and a retrieval-backed AI system on task quality, latency, cost, privacy, and tool-use requirements.",
    "For an internal policy assistant, I would prefer a model that can retrieve approved documents and cite them, with a deterministic harness controlling access. The evaluation should test real employee questions and abstention behavior before deciding which model and system architecture to deploy.",
  ],
  "ai-tool-shapes": [
    "AI systems beyond chatbots can classify documents, retrieve knowledge, extract structured fields, recommend actions, or operate tools inside a controlled workflow. For invoice processing, a model could extract fields while a harness validates totals and requires human approval before payment.",
    "The model supplies probabilistic judgment, tools connect it to data or actions, and the harness sets permissions, sequencing, checks, and stop conditions. Measuring the entire AI system matters because a strong model inside a weak workflow can still be unsafe or unproductive.",
  ],
};

const MI_COMPARISON_TURNS = [
  {
    lessonContext: "Registros Financieros",
    text: "Entiendo que debo anotar cada ingreso y gasto del negocio todos los días, y luego restar gastos de ingresos para saber si tuve ganancia o pérdida.",
  },
  {
    lessonContext: "Registros Financieros",
    text: "Usaré un cuaderno y revisaré el resultado al final del día para detectar gastos que antes no estaba viendo.",
  },
  {
    lessonContext: "Entidades Separadas",
    text: "Separar la plata personal de la del negocio me permite saber si el negocio realmente gana y pagarme un sueldo fijo sin confundir los gastos.",
  },
  {
    lessonContext: "Entidades Separadas",
    text: "Voy a usar dos registros distintos y anotar mi sueldo como gasto del negocio para no sacar dinero sin control.",
  },
  {
    lessonContext: "Presupuesto del Negocio",
    text: "Un presupuesto compara ventas esperadas con gastos fijos y variables; si el saldo es negativo, debo vender más o reducir gastos.",
  },
  {
    lessonContext: "Presupuesto del Negocio",
    text: "Al final del mes compararé lo planeado con lo real para ajustar el próximo presupuesto con datos y no con suposiciones.",
  },
] as const;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requestedLessonIndices(): number[] {
  const raw = argument("--lessons");
  if (!raw) return DEFAULT_LESSON_INDICES;
  const indices = raw.split(",").map((value) => Number(value.trim()));
  if (
    indices.length === 0
    || indices.some((value) => !Number.isInteger(value) || value < 1 || value > 17)
    || new Set(indices).size !== indices.length
  ) {
    throw new Error("--lessons must be a comma-separated list of unique lesson numbers from 1 to 17");
  }
  return indices;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function waitForBackgroundWrites(
  socioId: string,
  enrollmentId: string,
  since: Date,
  eligibleTurns: number,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const [sentiments, observations] = await Promise.all([
      prisma.messageSentiment.count({
        where: { socioId, message: { createdAt: { gte: since } } },
      }),
      prisma.metricObservation.findMany({
        where: { enrollmentId, createdAt: { gte: since } },
        select: { evidenceRefs: true },
      }),
    ]);
    const observedTurns = new Set(
      observations.flatMap((row) => {
        if (!isObject(row.evidenceRefs) || row.evidenceRefs.kind !== "lesson_sensing") return [];
        return Array.isArray(row.evidenceRefs.messageIds)
          ? row.evidenceRefs.messageIds.filter((id): id is string => typeof id === "string")
          : [];
      }),
    ).size;
    if (sentiments >= eligibleTurns && observedTurns >= eligibleTurns) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function seedSyntheticLearner(organizationSlug: string) {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { slug: organizationSlug },
  });
  if (!isObject(organization.settings) || organization.settings.syntheticDataOnly !== true) {
    throw new Error(
      `Refusing to run in ${organizationSlug}: organization.settings.syntheticDataOnly must be true`,
    );
  }

  const version = await prisma.programVersion.findFirstOrThrow({
    where: {
      program: { organizationId: organization.id, slug: COLLECTION_KEY },
      status: "published",
      collection: { slug: COLLECTION_KEY },
    },
    include: { program: true, collection: true },
  });
  const cohort = await prisma.cohort.upsert({
    where: {
      programId_slug: { programId: version.programId, slug: "sensing-acceptance" },
    },
    create: {
      programId: version.programId,
      programVersionId: version.id,
      slug: "sensing-acceptance",
      name: "Synthetic sensing acceptance",
    },
    update: { programVersionId: version.id },
  });

  const runId = argument("--run-id") ?? randomUUID();
  const externalId = `aiess-b3-${runId}`;
  const socio = await prisma.socio.create({
    data: {
      channelType: "web",
      externalId,
      language: "en",
      name: "Synthetic AI Essentials Learner",
      status: "ACTIVE",
      curriculumCollectionKey: COLLECTION_KEY,
      metadata: { synthetic: true, acceptanceRun: "B3", runId },
      progress: { create: {} },
    },
    include: { progress: true },
  });
  const participant = await prisma.participantProfile.create({
    data: {
      organizationId: organization.id,
      socioId: socio.id,
      displayName: "Synthetic AI Essentials Learner",
      preferredLang: "en",
      metadata: { synthetic: true, acceptanceRun: "B3", runId },
    },
  });
  const enrollment = await prisma.enrollment.create({
    data: {
      participantId: participant.id,
      cohortId: cohort.id,
      programVersionId: version.id,
      metadata: { synthetic: true, acceptanceRun: "B3", runId },
    },
  });
  const access = await resolvePlayerAccess(
    {
      userId: socio.id,
      externalId,
      role: "socio",
      name: socio.name ?? "Synthetic learner",
      socioId: socio.id,
      channel: "web",
    },
    COURSE_CODE,
  );
  return { organization, version, socio, enrollment, access, runId, externalId };
}

async function loadAcceptanceLessons(access: PlayerAccess, lessonIndices: number[]) {
  const collectionId = access.collectionKey
    ? (await prisma.contentCollection.findFirstOrThrow({
        where: {
          slug: access.collectionKey,
          programVersions: { some: { id: access.programVersionId } },
        },
        select: { id: true },
      })).id
    : undefined;
  const rows = await prisma.contentLesson.findMany({
    where: {
      collectionId,
      orderIndex: { in: lessonIndices.map((index) => index - 1) },
    },
    orderBy: { orderIndex: "asc" },
    include: { versions: { where: { version: access.programVersion }, take: 1 } },
  });
  if (rows.length !== lessonIndices.length) {
    throw new Error(`Found ${rows.length} of ${lessonIndices.length} requested lessons`);
  }
  const byIndex = new Map(rows.map((row) => [row.orderIndex + 1, row]));
  return lessonIndices.map((lessonIndex) => {
    const row = byIndex.get(lessonIndex);
    if (!row) throw new Error(`Lesson ${lessonIndex} was not found`);
    const lesson = lessonSchema.parse(row.versions[0]?.body);
    const teachBack = lesson.blocks.find((block) => block.blockType === "teach_back");
    if (!teachBack) throw new Error(`Lesson ${row.slug} has no teach-back block`);
    if (!ANSWERS[row.slug]) throw new Error(`No fixed acceptance answers for ${row.slug}`);
    return { lessonIndex, lessonKey: row.slug, teachBack };
  });
}

async function main() {
  const organizationSlug = argument("--organization") ?? DEFAULT_ORGANIZATION;
  const lessonIndices = requestedLessonIndices();
  const seeded = await seedSyntheticLearner(organizationSlug);
  const lessons = await loadAcceptanceLessons(seeded.access, lessonIndices);
  const sent: string[] = [];
  const channel: DeliveryChannel = {
    getChannelType: () => "web",
    sendMessage: async (_recipientId, text) => { sent.push(text); },
  };
  const startedAt = new Date();
  const initialMessageIndex = seeded.socio.progress?.currentMessageIndex ?? 0;

  for (const lesson of lessons) {
    for (const answer of ANSWERS[lesson.lessonKey]) {
      const context = await preparePlayerContext(seeded.access, {
        lessonKey: lesson.lessonKey,
        blockId: lesson.teachBack.id,
        intent: "teach_back",
      });
      const result = await handleIncomingMessage({
        externalId: seeded.externalId,
        channelType: "web",
        channel,
        language: "en",
        message: answer,
        playerContext: context,
      });
      if (result.isError) throw new Error(`Tutor generation failed for ${lesson.lessonKey}`);
    }
  }

  const eligibleTurns = lessons.length * 2;
  await waitForBackgroundWrites(
    seeded.socio.id,
    seeded.enrollment.id,
    startedAt,
    eligibleTurns,
  );

  const [messages, sentiments, observations, dimensions, progress] = await Promise.all([
    prisma.message.findMany({
      where: { socioId: seeded.socio.id, role: "user", createdAt: { gte: startedAt } },
      select: { id: true, metadata: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.messageSentiment.findMany({
      where: { socioId: seeded.socio.id, message: { createdAt: { gte: startedAt } } },
      select: { messageId: true },
    }),
    prisma.metricObservation.findMany({
      where: { enrollmentId: seeded.enrollment.id, createdAt: { gte: startedAt } },
      include: { metric: { select: { key: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.metricDefinition.findMany({
      where: { organizationId: seeded.organization.id },
      select: { key: true },
      orderBy: { key: "asc" },
    }),
    prisma.socioProgress.findUniqueOrThrow({ where: { socioId: seeded.socio.id } }),
  ]);

  const lessonObservations = observations.filter(
    (row) => isObject(row.evidenceRefs) && row.evidenceRefs.kind === "lesson_sensing",
  );
  const observedMessageIds = new Set(
    lessonObservations.flatMap((row) => {
      if (!isObject(row.evidenceRefs) || !Array.isArray(row.evidenceRefs.messageIds)) return [];
      return row.evidenceRefs.messageIds.filter((id): id is string => typeof id === "string");
    }),
  );
  const counts = Object.fromEntries(
    dimensions.map(({ key }) => [
      key,
      lessonObservations.filter((observation) => observation.metric.key === key).length,
    ]),
  );
  const principalCoverage = Object.fromEntries(
    lessons.map(({ lessonKey, teachBack }) => [
      lessonKey,
      lessonObservations.some(
        (observation) =>
          observation.metric.key === teachBack.dimensionKey &&
          isObject(observation.evidenceRefs) &&
          observation.evidenceRefs.lessonKey === lessonKey,
      ),
    ]),
  );
  const distinctObservedDimensions = Object.values(counts).filter((count) => count > 0).length;
  const previouslyUnobservedDimensionCoverage = Object.fromEntries(
    PREVIOUSLY_UNOBSERVED_DIMENSIONS.map((key) => [key, (counts[key] ?? 0) > 0]),
  );
  let miTurnsWithNonNullObservation = 0;
  for (const turn of MI_COMPARISON_TURNS) {
    const sensed = await senseAndScore({
      incomingText: turn.text,
      priorState: {},
      lessonContext: turn.lessonContext,
      socioId: seeded.socio.id,
      organizationId: seeded.organization.id,
      // Explicit definitions keep this comparison about signal availability.
      // The live platform sentiment prompt is legacy v1.0 and has no dimensions
      // contract, so using it would measure prompt drift rather than MI signal.
      dimensions: [
        { key: "comprehension", label: "Comprehension", min: 0, max: 10 },
        { key: "confusion", label: "Confusion", min: 0, max: 10 },
      ],
    });
    if (sensed.dimensions.length > 0) miTurnsWithNonNullObservation++;
  }
  const miNonNullObservationRate = miTurnsWithNonNullObservation / MI_COMPARISON_TURNS.length;
  const playerNonNullObservationRate = observedMessageIds.size / eligibleTurns;
  const report = {
    runId: seeded.runId,
    organization: organizationSlug,
    lessonIndices,
    lessonKeys: lessons.map((lesson) => lesson.lessonKey),
    eligibleTeachBackTurns: eligibleTurns,
    persistedPlayerUserMessages: messages.length,
    sentimentRows: sentiments.length,
    sentimentCoverage: sentiments.length / eligibleTurns,
    lessonSensingObservations: lessonObservations.length,
    turnsWithNonNullObservation: observedMessageIds.size,
    nonNullObservationRate: playerNonNullObservationRate,
    comparableMiSensingProbe: {
      mode: "controlled-dimension-contract",
      eligibleTurns: MI_COMPARISON_TURNS.length,
      turnsWithNonNullObservation: miTurnsWithNonNullObservation,
      nonNullObservationRate: miNonNullObservationRate,
      playerToMiRateRatio: miNonNullObservationRate === 0
        ? null
        : playerNonNullObservationRate / miNonNullObservationRate,
    },
    principalCoverage,
    distinctObservedDimensions,
    dimensionCounts: counts,
    previouslyUnobservedDimensionCoverage,
    numericChatProgress: {
      initialMessageIndex,
      finalMessageIndex: progress.currentMessageIndex,
      unchanged: initialMessageIndex === progress.currentMessageIndex,
    },
    tutorResponses: sent.length,
    acceptance: {
      elevenDimensionsReported: dimensions.length === EXPECTED_DIMENSION_COUNT,
      sentimentForEveryAnswer: sentiments.length === eligibleTurns,
      everyPrincipalObserved: Object.values(principalCoverage).every(Boolean),
      atLeastThreeDimensionsObserved: distinctObservedDimensions >= 3,
      allPreviouslyUnobservedDimensionsObserved: Object.values(
        previouslyUnobservedDimensionCoverage,
      ).every(Boolean),
      signalRateAtLeastHalfOfMi: miNonNullObservationRate > 0 &&
        playerNonNullObservationRate >= miNonNullObservationRate * 0.5,
      numericChatProgressUnchanged: initialMessageIndex === progress.currentMessageIndex,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
