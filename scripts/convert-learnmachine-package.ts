import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { journeyPackageSchema } from "../apps/web/src/lib/journey-package/journey-package.schema";

export const LESSON_ORDER = [
  "ai-day-in-the-life", "ai-magic-examples", "ai-revolution-vs-past",
  "ai-prospering-gameplan", "ai-ceo-explain-models", "ai-expert-vs-ml",
  "ai-pattern-vs-truth", "ai-train-infer-failures", "ai-prompting-iteration",
  "ai-reasoning-context-tools", "ai-harness-control", "ai-model-landscape",
  "ai-cost-context-windows", "ai-specialize-and-route", "ai-tool-shapes",
  "ai-build-vs-buy", "ai-safety-deploy",
] as const;

type ManifestMilestone = {
  key: string;
  name: string;
  availability: { type: "immediate" } | { type: "after_lesson"; lessonKey: string } | { type: "after_milestone"; milestoneKey: string };
  checkDescription?: string;
};
export type GenerationManifest = {
  schemaVersion: "1.2";
  contentVersion: string;
  lessonKeys: string[];
  expectedLessonCount: number;
  expectedBlockCount?: number;
  responseStyle?: {
    maxSentences?: number; maxOutputTokens?: number; markdown?: "allowed" | "none"; maxQuestions?: number;
    expanded?: { maxSentences: number; maxOutputTokens: number };
  };
  milestones: ManifestMilestone[];
  dimensions?: Array<{
    key: string;
    label: string;
    concepts: string[];
    topics: string[];
    lessonKeys: string[];
  }>;
  /** Maps each source diagnostic concept onto the version's declared dimension. */
  diagnosticDimensionMap?: Record<string, string>;
  diagnosticReplacement?: {
    itemIndex: number;
    item: { concept: string; type: "mcq"; prompt: string; options: string[]; correct: number; explain: string };
  };
  /** Phase 2 stays non-generatable until the professor-approved authored inputs land. */
  authoredInputsApproved?: boolean;
  requiredAuthoredInputs?: string[];
};

const CONCEPT_LABELS: Record<string, string> = {
  ai_impact: "AI impact on work and life",
  ai_productivity: "Productivity and Jevons paradox",
  expert_systems: "Expert systems",
  machine_learning: "Machine learning basics",
  hallucinations: "Hallucinations vs truth",
  prompting: "Prompting and iteration",
  reasoning: "Reasoning and context",
  tools_harness: "Tools, skills, and harnesses",
  model_selection: "Choosing AI models",
  ai_systems: "AI systems beyond chatbots",
  guardrails: "Safety and guardrails",
};

type SourceBlock =
  | { type: "prose"; concepts: string[]; md: string }
  | { type: "mcq"; concepts: string[]; prompt: string; options: string[]; correct: number; explain: string }
  | { type: "drag_order"; concepts: string[]; prompt: string; items: string[]; correct_order: number[] };
type SourceLesson = { id: string; title: string; track: number; difficulty: string; concepts: string[]; blocks: SourceBlock[] };
type SourceDiagnostic = {
  id: string; title: string; description?: string; pass_threshold: number;
  items: Array<{ concept: string; type: "mcq"; prompt: string; options: string[]; correct: number; explain: string }>;
};
export type IdentityEntry = {
  stableId: string; lessonKey: string; blockType: string; discriminator: string;
  contentHash: string; fingerprint: string; sourceOrdinal: string; retired: boolean;
};
export type IdentityMap = { version: 1; nextSequence: number; entries: IdentityEntry[] };
type Overrides = {
  blocks?: Record<string, {
    content?: string; prompt?: string; explanation?: string; options?: string[];
    correct?: number; items?: string[]; correctOrder?: number[]; contentVersion?: number;
  }>;
  teachBacks?: Record<string, { prompt?: string; contentVersion?: number }>;
};
export type Decisions = { reuse: Map<string, string>; mint: Set<string> };
export type CandidateBlock = {
  lessonKey: string; lessonIndex: number; sourceOrdinal: string; blockType: SourceBlock["type"] | "teach_back";
  discriminator: string; hash: string; fingerprint: string; source: SourceBlock | { type: "teach_back"; concepts: string[]; prompt: string };
};
type Match = CandidateBlock & { stableId: string; contentVersion: number };

export type ConvertOptions = {
  source: string; manifestPath: string; idMapPath: string; overridesPath: string; outputPath: string;
  reviewPath: string; decisions?: Decisions; write?: boolean;
};

export function validateGenerationManifest(manifest: GenerationManifest): void {
  if (manifest.schemaVersion !== "1.2") throw new Error(`Unsupported manifest schema ${manifest.schemaVersion}`);
  if (new Set(manifest.lessonKeys).size !== manifest.lessonKeys.length) throw new Error("Generation manifest contains duplicate lesson keys");
  if (manifest.lessonKeys.length !== manifest.expectedLessonCount) throw new Error(`Manifest expected ${manifest.expectedLessonCount} lessons but declares ${manifest.lessonKeys.length}`);
  if (manifest.dimensions) {
    const dimensionKeys = manifest.dimensions.map((dimension) => dimension.key);
    if (new Set(dimensionKeys).size !== dimensionKeys.length) throw new Error("Generation manifest contains duplicate dimension keys");
    const lessonKeys = new Set(manifest.lessonKeys);
    for (const dimension of manifest.dimensions) {
      if (dimension.lessonKeys.length === 0) throw new Error(`Dimension ${dimension.key} has no teach-back lesson source`);
      const unknown = dimension.lessonKeys.filter((lessonKey) => !lessonKeys.has(lessonKey));
      if (unknown.length) throw new Error(`Dimension ${dimension.key} references lessons outside the manifest: ${unknown.join(", ")}`);
    }
    if (manifest.diagnosticDimensionMap) {
      const unknown = [...new Set(Object.values(manifest.diagnosticDimensionMap))].filter((key) => !dimensionKeys.includes(key));
      if (unknown.length) throw new Error(`Diagnostic mapping references undeclared dimensions: ${unknown.join(", ")}`);
    }
  }
  if (manifest.authoredInputsApproved === false) {
    throw new Error(`Authored inputs are not approved: ${(manifest.requiredAuthoredInputs ?? []).join(", ") || "unspecified inputs"}`);
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function fingerprint(value: unknown): string {
  return stableJson(value).normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

export function tokenOverlap(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / union.size;
}

function identityContent(block: SourceBlock | { type: "teach_back"; concepts: string[]; prompt: string }, discriminator: string) {
  if (block.type === "prose") return { type: block.type, discriminator, concepts: block.concepts, content: block.md };
  if (block.type === "mcq") return { type: block.type, discriminator, concepts: block.concepts, prompt: block.prompt, options: block.options, correct: block.correct, explanation: block.explain };
  if (block.type === "drag_order") return { type: block.type, discriminator, concepts: block.concepts, prompt: block.prompt, items: block.items, correctOrder: block.correct_order };
  return { type: block.type, discriminator, concepts: block.concepts, prompt: block.prompt };
}

function makeCandidate(lesson: SourceLesson, lessonIndex: number, source: CandidateBlock["source"], sourceOrdinal: string): CandidateBlock {
  const discriminator = `${lesson.id}:${source.type}:${source.concepts[0] ?? "none"}`;
  const content = identityContent(source, discriminator);
  return { lessonKey: lesson.id, lessonIndex, sourceOrdinal, blockType: source.type, discriminator, hash: sha(content), fingerprint: fingerprint(content), source };
}

function mintId(map: IdentityMap, lessonIndex: number): string {
  const id = `aiess-l${String(lessonIndex + 1).padStart(2, "0")}-b${String(map.nextSequence).padStart(3, "0")}`;
  map.nextSequence++;
  return id;
}

export function matchIdentityCandidates(candidates: CandidateBlock[], current: IdentityMap, decisions: Decisions): { matches: Match[]; drift: unknown[]; review: unknown[] } {
  const map: IdentityMap = JSON.parse(JSON.stringify(current));
  const used = new Set<string>();
  const seen = new Set<string>();
  const matches: Match[] = [];
  const drift: unknown[] = [];
  const review: unknown[] = [];

  for (const candidate of candidates) {
    const sourceRef = `${candidate.lessonKey}:${candidate.sourceOrdinal}`;
    const explicitReuse = decisions.reuse.get(sourceRef);
    let entry: IdentityEntry | undefined;
    if (explicitReuse) {
      entry = map.entries.find((item) => item.stableId === explicitReuse);
      if (!entry) throw new Error(`--reuse-id for ${sourceRef} names unknown id ${explicitReuse}`);
      if (used.has(entry.stableId)) throw new Error(`stable id ${entry.stableId} was assigned twice`);
    } else {
      const exact = map.entries.filter((item) => item.contentHash === candidate.hash && !used.has(item.stableId));
      if (exact.length === 1) entry = exact[0];
      else if (exact.length > 1) {
        review.push({ sourceRef, reason: "multiple_exact_hash_matches", candidates: exact.map((item) => item.stableId) });
        continue;
      }
    }

    if (!entry && !decisions.mint.has(sourceRef)) {
      const prior = map.entries.filter((item) => item.discriminator === candidate.discriminator && !used.has(item.stableId));
      const scored = prior.map((item) => ({ item, overlap: tokenOverlap(candidate.fingerprint, item.fingerprint) })).sort((a, b) => b.overlap - a.overlap);
      const eligible = scored.filter((item) => item.overlap >= 0.5);
      if (eligible.length === 1) {
        entry = eligible[0].item;
        drift.push({ sourceRef, stableId: entry.stableId, overlap: eligible[0].overlap, previousHash: entry.contentHash, nextHash: candidate.hash });
      } else if (eligible.length > 1) {
        review.push({ sourceRef, reason: "ambiguous_similarity", candidates: eligible.map(({ item, overlap }) => ({ stableId: item.stableId, overlap })) });
        continue;
      } else if (scored.some((item) => item.overlap > 0)) {
        review.push({ sourceRef, reason: "sub_threshold_possible_edit", candidates: scored.slice(0, 5).map(({ item, overlap }) => ({ stableId: item.stableId, overlap })) });
        continue;
      }
    }

    if (!entry) {
      entry = {
        stableId: mintId(map, candidate.lessonIndex), lessonKey: candidate.lessonKey,
        blockType: candidate.blockType, discriminator: candidate.discriminator,
        contentHash: candidate.hash, fingerprint: candidate.fingerprint,
        sourceOrdinal: candidate.sourceOrdinal, retired: false,
      };
      map.entries.push(entry);
    } else {
      entry.lessonKey = candidate.lessonKey;
      entry.blockType = candidate.blockType;
      entry.discriminator = candidate.discriminator;
      entry.contentHash = candidate.hash;
      entry.fingerprint = candidate.fingerprint;
      entry.sourceOrdinal = candidate.sourceOrdinal;
      entry.retired = false;
    }
    used.add(entry.stableId);
    seen.add(entry.stableId);
    matches.push({ ...candidate, stableId: entry.stableId, contentVersion: 1 });
  }

  if (review.length === 0) {
    for (const entry of map.entries) if (!seen.has(entry.stableId)) entry.retired = true;
    current.nextSequence = map.nextSequence;
    current.entries = map.entries.sort((a, b) => a.stableId.localeCompare(b.stableId));
  }
  return { matches, drift, review };
}

function loadLessons(source: string, lessonOrder: readonly string[]): SourceLesson[] {
  const contentDir = existsSync(resolve(source, "backend/content/ai-essentials"))
    ? resolve(source, "backend/content/ai-essentials") : source;
  const files = new Set(readdirSync(contentDir));
  return lessonOrder.map((id) => {
    if (!files.has(`${id}.json`)) throw new Error(`Missing required lesson ${id}.json in ${contentDir}`);
    const lesson = readJson<SourceLesson>(resolve(contentDir, `${id}.json`));
    if (lesson.id !== id) throw new Error(`Lesson ${id}.json declares id ${lesson.id}`);
    return lesson;
  });
}

function sourceContentDir(source: string): string {
  return existsSync(resolve(source, "backend/content/ai-essentials"))
    ? resolve(source, "backend/content/ai-essentials") : source;
}

export function convertLearnMachinePackage(options: ConvertOptions) {
  const manifest = readJson<GenerationManifest>(options.manifestPath);
  validateGenerationManifest(manifest);
  const lessons = loadLessons(options.source, manifest.lessonKeys);
  const contentDir = sourceContentDir(options.source);
  const diagnostic = readJson<SourceDiagnostic>(resolve(contentDir, "placement-diagnostic.json"));
  if (manifest.diagnosticReplacement) {
    const { itemIndex, item } = manifest.diagnosticReplacement;
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= diagnostic.items.length) throw new Error(`Diagnostic replacement index ${itemIndex} is out of range`);
    diagnostic.items[itemIndex] = item;
  }
  const overrides = existsSync(options.overridesPath) ? readJson<Overrides>(options.overridesPath) : {};
  const dimensions = manifest.dimensions ?? Object.entries(CONCEPT_LABELS).map(([key, label]) => ({
    key, label, concepts: [key], topics: [], lessonKeys: lessons.filter((lesson) => lesson.concepts.includes(key)).map((lesson) => lesson.id),
  }));
  const identityMap = existsSync(options.idMapPath) ? readJson<IdentityMap>(options.idMapPath) : { version: 1, nextSequence: 1, entries: [] };
  const candidates: CandidateBlock[] = [];

  lessons.forEach((lesson, lessonIndex) => {
    lesson.blocks.forEach((block, ordinal) => candidates.push(makeCandidate(lesson, lessonIndex, block, String(ordinal + 1))));
    const prompt = overrides.teachBacks?.[lesson.id]?.prompt ?? `In your own words, explain ${CONCEPT_LABELS[lesson.concepts[0]] ?? lesson.concepts[0]}. Use one practical example.`;
    candidates.push(makeCandidate(lesson, lessonIndex, { type: "teach_back", concepts: [lesson.concepts[0]], prompt }, "generated-teach-back"));
  });

  const decisions = options.decisions ?? { reuse: new Map(), mint: new Set() };
  const { matches, drift, review } = matchIdentityCandidates(candidates, identityMap, decisions);
  if (review.length) {
    writeFileSync(options.reviewPath, JSON.stringify({ generatedAt: new Date().toISOString(), review }, null, 2) + "\n");
    throw new Error(`Converter stopped for ${review.length} identity decision(s). See ${options.reviewPath}`);
  }

  const matchByRef = new Map(matches.map((match) => [`${match.lessonKey}:${match.sourceOrdinal}`, match]));
  const packageLessons = lessons.map((lesson) => {
    const mapped = lesson.blocks.map((block, ordinal) => {
      const match = matchByRef.get(`${lesson.id}:${ordinal + 1}`)!;
      const override = overrides.blocks?.[match.stableId];
      const base = { id: match.stableId, order: 0, concepts: block.concepts, contentVersion: override?.contentVersion ?? 1 };
      if (override && Object.keys(override).some((key) => key !== "contentVersion") && (override.contentVersion ?? 1) <= 1) {
        throw new Error(`Changed block ${match.stableId} requires an intentional contentVersion bump`);
      }
      if (block.type === "prose") return { ...base, blockType: "teach" as const, role: "explanation" as const, content: override?.content ?? block.md, presentation: "rendered" as const };
      if (block.type === "mcq") return {
        ...base, blockType: "quiz_checkpoint" as const,
        questions: [{ id: `${match.stableId}-q1`, prompt: override?.prompt ?? block.prompt, format: "multiple_choice" as const, options: override?.options ?? block.options, answerKey: (override?.options ?? block.options)[override?.correct ?? block.correct], explanation: override?.explanation ?? block.explain, dimensionKey: block.concepts[0] }],
      };
      return { ...base, blockType: "drag_order" as const, prompt: override?.prompt ?? block.prompt, items: override?.items ?? block.items, correctOrder: override?.correctOrder ?? block.correct_order };
    });
    const openingProseCount = lesson.blocks.findIndex((block) => block.type !== "prose");
    const insertionIndex = openingProseCount === -1 ? lesson.blocks.length : openingProseCount;
    const teachBackMatch = matchByRef.get(`${lesson.id}:generated-teach-back`)!;
    const teachBackOverride = overrides.teachBacks?.[lesson.id];
    if (teachBackOverride?.prompt && (teachBackOverride.contentVersion ?? 1) <= 1) {
      throw new Error(`Changed teach-back ${lesson.id} requires an intentional contentVersion bump`);
    }
    mapped.splice(insertionIndex, 0, {
      id: teachBackMatch.stableId, order: 0, blockType: "teach_back", concepts: [lesson.concepts[0]],
      contentVersion: teachBackOverride?.contentVersion ?? 1, prompt: (teachBackMatch.source as { prompt: string }).prompt,
      evaluatesConcepts: (manifest.dimensions
        ? dimensions.filter((dimension) => dimension.lessonKeys.includes(lesson.id)).map((dimension) => dimension.label)
        : lesson.concepts.map((concept) => CONCEPT_LABELS[concept] ?? concept.replaceAll("_", " "))),
      dimensionKey: dimensions.find((dimension) => dimension.lessonKeys.includes(lesson.id))?.key ?? lesson.concepts[0], delivery: "inline",
    } as (typeof mapped)[number]);
    return {
      key: lesson.id, title: lesson.title, category: `Track ${lesson.track}`,
      keyConcepts: lesson.concepts.map((concept) => CONCEPT_LABELS[concept] ?? concept.replaceAll("_", " ")),
      selfCheckQuestions: [], blocks: mapped.map((block, index) => ({ ...block, order: index + 1 })),
    };
  });

  const deliverables = [
    "A one-paragraph use case, user, decision, and success definition",
    "A reusable prompt with context, constraints, output format, and one documented iteration",
    "A tool/harness plan showing inputs, steps, human checkpoints, and model choice",
    "A guardrail and evaluation plan with at least three tests and a failure-response path",
    "A final operating brief that explains what AI does, what the human owns, and why",
  ];
  const pkg = {
    schemaVersion: manifest.schemaVersion,
    metadata: {
      packageId: "ai-essentials", title: "AI Essentials",
      description: "AI literacy for GSCM undergraduates: how models work, how to use them, and how to choose tools.",
      languages: ["en"], version: manifest.contentVersion, author: { name: "Learn Machine" },
      identity: { mentorName: "AI Mentor", displayName: "AI Essentials" },
      terminology: { participant: { en: "learner" } },
      delivery: { surface: "player", supportedChannels: ["web", "canvas"] },
    },
    config: {
      aiBehavior: { tone: "clear, practical, and encouraging", teachingStyle: "Socratic coaching with concise feedback", languageInstruction: "Respond in English." },
      responseStyle: manifest.responseStyle,
      onboarding: {
        mode: "baseline_quiz", steps: [],
        diagnostic: {
          id: diagnostic.id, title: diagnostic.title, description: diagnostic.description, threshold: diagnostic.pass_threshold,
          questions: diagnostic.items.map((item, index) => ({ id: `diagnostic-${String(index + 1).padStart(2, "0")}`, prompt: item.prompt, format: "multiple_choice", options: item.options, answerKey: item.options[item.correct], explanation: item.explain, dimensionKey: manifest.diagnosticDimensionMap?.[item.concept] ?? item.concept })),
        },
      },
      trackedDimensions: dimensions.map(({ key, label }) => ({ key, label, category: "comprehension", primary: true, scale: { min: 0, max: 1 }, calibrationMode: "zero_start" })),
      alertRules: [], dashboard: { panels: [{ type: "lesson_progress" }, { type: "assessment_scores" }, { type: "weekly_summary" }] },
    },
    curriculum: { collectionKey: "ai-essentials", lessons: packageLessons },
    outcome: {
      project: {
        title: "Build a trustworthy AI decision-support workflow",
        description: "Design an AI-assisted workflow that turns a messy operational request into a reliable, evidence-backed recommendation. Show how a person frames the task, supplies context, uses tools, checks the output, handles failure, and makes the final decision.",
        deliverables: deliverables.map((name) => ({ name })),
      },
      milestones: manifest.milestones,
      mentorResources: [],
    },
  };

  const parsed = journeyPackageSchema.parse(pkg);
  const counts = parsed.curriculum.lessons.reduce((acc, lesson) => {
    for (const block of lesson.blocks) acc[block.blockType] = (acc[block.blockType] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const blockCount = Object.values(counts).reduce((a, b) => a + b, 0);
  if (parsed.curriculum.lessons.length !== manifest.expectedLessonCount || (manifest.expectedBlockCount !== undefined && blockCount !== manifest.expectedBlockCount)) {
    throw new Error(`Unexpected output counts: ${parsed.curriculum.lessons.length} lessons, ${JSON.stringify(counts)}`);
  }
  const teachBackDimensions = manifest.dimensions
    ? new Set(parsed.curriculum.lessons.flatMap((lesson) => lesson.blocks.flatMap((block) => {
        if (block.blockType !== "teach_back") return [];
        return dimensions.flatMap((dimension) => block.evaluatesConcepts.includes(dimension.label) ? [dimension.key] : []);
      })))
    : new Set(lessons.flatMap((lesson) => lesson.concepts));
  const allDimensions = new Set(parsed.config.trackedDimensions.map((dimension) => dimension.key));
  const unreachable = [...allDimensions].filter((dimension) => !teachBackDimensions.has(dimension));
  if (unreachable.length) throw new Error(`Tracked dimensions unreachable from emitted teach-backs: ${unreachable.join(", ")}`);
  const deadDiagnosticDimensions = parsed.config.onboarding?.diagnostic?.questions.flatMap((question) => question.dimensionKey && !allDimensions.has(question.dimensionKey) ? [question.dimensionKey] : []) ?? [];
  if (deadDiagnosticDimensions.length) throw new Error(`Diagnostic dimensions have no remaining lesson source: ${[...new Set(deadDiagnosticDimensions)].join(", ")}`);
  if (manifest.dimensions) {
    const diagnosticDimensions = new Set(parsed.config.onboarding?.diagnostic?.questions.flatMap((question) => question.dimensionKey ? [question.dimensionKey] : []) ?? []);
    const unseededDimensions = [...allDimensions].filter((dimension) => !diagnosticDimensions.has(dimension));
    if (unseededDimensions.length) throw new Error(`Declared dimensions missing from diagnostic mapping: ${unseededDimensions.join(", ")}`);
  }
  const matchById = new Map(matches.map((match) => [match.stableId, match]));
  const contentChanges = parsed.curriculum.lessons.flatMap((lesson) => lesson.blocks.flatMap((block) => {
    if (block.contentVersion <= 1) return [];
    const match = matchById.get(block.id);
    const oldContent = match ? identityContent(match.source, match.discriminator) : null;
    return [{
      lessonKey: lesson.key,
      stableId: block.id,
      contentVersion: block.contentVersion,
      oldContent,
      newContent: block,
      oldHash: oldContent ? sha(oldContent) : null,
      newHash: sha(block),
    }];
  }));
  if (options.write !== false) {
    writeFileSync(options.idMapPath, JSON.stringify(identityMap, null, 2) + "\n");
    writeFileSync(options.outputPath, JSON.stringify(parsed, null, 2) + "\n");
    writeFileSync(options.reviewPath, JSON.stringify({ contentVersion: manifest.contentVersion, contentChanges, identityDrift: drift }, null, 2) + "\n");
  }
  return { package: parsed, identityMap, counts, drift };
}

function parseArgs(argv: string[]) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const multi = (name: string) => argv.flatMap((arg, index) => arg === name && argv[index + 1] ? [argv[index + 1]] : []);
  const reuse = new Map<string, string>();
  for (const item of multi("--reuse-id")) {
    const split = item.lastIndexOf("=");
    if (split < 1) throw new Error(`--reuse-id expects source-ref=stable-id, received ${item}`);
    reuse.set(item.slice(0, split), item.slice(split + 1));
  }
  return {
    source: resolve(value("--source") ?? "/Users/michaelbertoldo/Desktop/Finance Trainer"),
    manifestPath: resolve(value("--manifest") ?? resolve(root, "content/ai-essentials-manifest.json")),
    idMapPath: resolve(value("--id-map") ?? resolve(root, "content/block-ids.json")),
    overridesPath: resolve(value("--overrides") ?? resolve(root, "content/ai-essentials-overrides.json")),
    outputPath: resolve(value("--output") ?? resolve(root, "content/ai-essentials.package.json")),
    reviewPath: resolve(value("--review") ?? resolve(root, "content/ai-essentials-review.json")),
    decisions: { reuse, mint: new Set(multi("--mint-new")) },
  } satisfies ConvertOptions;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = convertLearnMachinePackage(parseArgs(process.argv.slice(2)));
  process.stdout.write(`Generated ${result.package.curriculum.lessons.length} lessons: ${JSON.stringify(result.counts)}\n`);
  if (result.drift.length) process.stdout.write(`Reused ${result.drift.length} drifted block id(s).\n`);
}
