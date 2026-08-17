import { playerRuntimeRepo } from "@/lib/repo/playerRuntimeRepo";
import type { RequestIdentity } from "@/lib/auth/requestIdentity";
import { resolveCourseCode } from "@/lib/courses/resolver";
import { resolveDelivery } from "@/lib/journey-package/delivery";
import { lessonSchema, normalizeMilestoneAvailability, type NormalizedMilestone, type ParsedLessonBlock as LessonBlock } from "@/lib/journey-package/journey-package.schema";
import { programVersionConfigSchema, type ProgramVersionConfig } from "@/lib/journey-package/program-version-config.schema";
import { getCurrentLearnerProject, learnerProjectSelectionRequired } from "./learnerProject";
import { buildLessonDashboard, type LessonDashboard } from "./dashboard";

export class PlayerError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type PlayerAccess = {
  socioId: string;
  /** Route-facing course code, normalized. The player surface is no longer single-course. */
  courseCode: string;
  collectionKey: string;
  organizationId: string;
  programVersionId: string;
  programVersion: string;
  config: ReturnType<typeof programVersionConfigSchema.parse>;
  enrollmentId: string;
};

export type PlayerParentIntent = "question" | "teach_back" | "lesson_entry" | "capstone";
export type PlayerIntent = PlayerParentIntent | "expand";
export type ValidatedPlayerContext = {
  surface: "player";
  /**
   * The course this turn belongs to. Was the literal `"AIESS"` while AI
   * Essentials was the only player course, which made the compiler agree with
   * a hardcoded value in every caller. Widened when the second course landed.
   */
  courseCode: string;
  lessonKey: string;
  blockId?: string;
  intent: PlayerIntent;
  parentIntent?: PlayerParentIntent;
  /** Exact server-validated assistant row targeted by an expansion. Never accepted from free text. */
  parentAssistantMessageId?: string;
  collectionKey: string;
  programVersionId: string;
  contentVersion?: number;
  teachBackTurn?: 1 | 2;
  ltiContextId?: string;
};

export function matchesExpansionParent(metadata: unknown, params: {
  courseCode: string; collectionKey: string; programVersionId: string; lessonKey: string; blockId?: string; parentIntent: PlayerParentIntent;
}): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const value = metadata as Record<string, unknown>;
  return value.surface === "player"
    && value.courseCode === params.courseCode
    && value.collectionKey === params.collectionKey
    && value.programVersionId === params.programVersionId
    && value.lessonKey === params.lessonKey
    && value.intent === params.parentIntent
    && (typeof params.blockId === "string" ? value.blockId === params.blockId : value.blockId === undefined);
}

export async function resolvePlayerAccess(identity: RequestIdentity, courseCode: string): Promise<PlayerAccess> {
  if (identity.role !== "socio" || !identity.socioId) throw new PlayerError(403, "learner_required", "Learner access required");
  const collectionKey = resolveCourseCode(courseCode);
  if (!collectionKey) throw new PlayerError(404, "course_not_found", "Course not found");

  const socio = await playerRuntimeRepo.socio.findUnique({
    where: { id: identity.socioId },
    include: { participantProfile: { include: { enrollments: true } } },
  });
  if (!socio) throw new PlayerError(404, "learner_not_found", "Learner not found");

  let programVersion;
  let selectedEnrollmentId: string | undefined;
  if (identity.ltiContextId) {
    const context = await playerRuntimeRepo.ltiContext.findUnique({
      where: { id: identity.ltiContextId },
      include: { programVersion: { include: { collection: true, program: true } } },
    });
    if (!context || context.programVersion.collection?.slug !== collectionKey) {
      throw new PlayerError(403, "context_mismatch", "This Canvas link does not authorize the requested course");
    }
    programVersion = context.programVersion;
    selectedEnrollmentId = socio.participantProfile?.enrollments.find((item) =>
      item.cohortId === context.cohortId
      && item.programVersionId === context.programVersionId
      && item.status === "active"
    )?.id;
  } else {
    if (socio.curriculumCollectionKey !== collectionKey) {
      throw new PlayerError(403, "not_enrolled", "You are not enrolled in this course");
    }
    const enrollment = socio.participantProfile ? await playerRuntimeRepo.enrollment.findFirst({
      where: {
        participantId: socio.participantProfile.id,
        status: "active",
        programVersion: { status: { in: ["published", "archived"] }, collection: { slug: collectionKey } },
      },
      include: { programVersion: { include: { collection: true, program: true } } },
      orderBy: { enrolledAt: "desc" },
    }) : null;
    if (!enrollment?.programVersion) throw new PlayerError(403, "not_enrolled", "An active enrollment in this course is required");
    programVersion = enrollment.programVersion;
    selectedEnrollmentId = enrollment.id;
  }
  if (!programVersion?.collection || !["published", "archived"].includes(programVersion.status)) throw new PlayerError(404, "course_unpublished", "Course is not released");
  const delivery = resolveDelivery(programVersion.metadata);
  if (delivery.surface !== "player" || !delivery.supportedChannels.includes(identity.channel)) {
    throw new PlayerError(403, "channel_not_supported", `Course is not available through ${identity.channel}`);
  }
  const enrollment = socio.participantProfile?.enrollments.find((item) => item.id === selectedEnrollmentId);
  if (!enrollment) throw new PlayerError(403, "not_enrolled", "An active enrollment in this course is required");
  return {
    socioId: socio.id, courseCode: courseCode.trim().toUpperCase(), collectionKey,
    organizationId: programVersion.program.organizationId,
    programVersionId: programVersion.id, programVersion: programVersion.version,
    config: programVersionConfigSchema.parse(programVersion.config), enrollmentId: enrollment.id,
  };
}

export function sanitizePlayerBlock(block: LessonBlock) {
  if (block.blockType === "quiz_checkpoint") {
    return { ...block, questions: block.questions.map((question) => {
      const safe = { ...question } as Partial<typeof question>;
      delete safe.answerKey;
      delete safe.explanation;
      return safe;
    }) };
  }
  if (block.blockType === "drag_order") {
    const safe = { ...block } as Partial<typeof block>;
    delete safe.correctOrder;
    return safe;
  }
  return block;
}

export function capstoneTutorGrounding(
  outcome: NonNullable<ProgramVersionConfig["outcome"]>,
  currentMilestoneKeys: ReadonlySet<string>,
): string {
  const current = outcome.milestones.find((milestone) => currentMilestoneKeys.has(milestone.key));
  const check = current?.checkDescription
    ? { key: current.key, name: current.name, checkDescription: current.checkDescription }
    : null;
  return [
    `Capstone: ${JSON.stringify(outcome.project)}`,
    check ? `Current milestone conversation: ${JSON.stringify(check)}` : "",
  ].filter(Boolean).join("\n");
}

/** Server-only lesson grounding for player tutor turns. Correct answers stay out. */
export async function playerTutorGrounding(socioId: string, context: ValidatedPlayerContext): Promise<string> {
  const version = await playerRuntimeRepo.programVersion.findUnique({
    where: { id: context.programVersionId },
    select: { version: true, config: true },
  });
  if (!version) throw new PlayerError(404, "course_unpublished", "Course version not found");
  if (context.intent === "capstone" || (context.intent === "expand" && context.parentIntent === "capstone")) {
    const config = programVersionConfigSchema.parse(version.config);
    if (!config.outcome) return "Capstone: {}";
    const currentMilestoneKeys = await playerMilestoneAvailabilitySnapshot(socioId, {
      ...context,
      intent: "capstone",
      parentIntent: undefined,
    });
    return capstoneTutorGrounding(config.outcome, currentMilestoneKeys);
  }
  const row = await playerRuntimeRepo.contentLesson.findFirst({
    where: { slug: context.lessonKey, collection: { programVersions: { some: { id: context.programVersionId } } } },
    include: { versions: { where: { version: version.version }, take: 1 } },
  });
  if (!row?.versions[0]) throw new PlayerError(404, "lesson_not_found", "Lesson not found");
  const lesson = lessonSchema.parse(row.versions[0].body);
  // Lesson entry has no block id, but still needs concrete, version-pinned
  // subject matter. Without this fallback the model sees only a title and can
  // drift into another lesson that happens to share a broad concept.
  const block = context.blockId
    ? lesson.blocks.find((item) => item.id === context.blockId)
    : context.intent === "lesson_entry"
      ? lesson.blocks[0]
      : undefined;
  const safeBlock = block ? sanitizePlayerBlock(block) : undefined;
  const parentIntent = context.intent === "expand" ? context.parentIntent : context.intent;
  const lessonEntry = parentIntent === "lesson_entry";
  const teachBack = parentIntent === "teach_back";
  return [
    lessonEntry ? `Lesson: ${lesson.title}` : `Lesson key: ${context.lessonKey}`,
    `Key concepts: ${lesson.keyConcepts.join(", ")}`,
    // A question is grounded by its version-pinned concepts. Sending the full
    // authored explanation also sends its illustrative industry, which the
    // model repeatedly misread as learner context. Teach-backs retain their
    // prompt/evaluation block, while entries retain the full opening block.
    safeBlock && (lessonEntry || teachBack) ? `Current block: ${JSON.stringify(safeBlock)}` : "",
  ].filter(Boolean).join("\n");
}

async function lessonRows(access: PlayerAccess) {
  const rows = await playerRuntimeRepo.contentLesson.findMany({
    where: {
      collection: { slug: access.collectionKey, programVersions: { some: { id: access.programVersionId } } },
      versions: { some: { version: access.programVersion } },
    },
    orderBy: { orderIndex: "asc" },
    include: { versions: { where: { version: access.programVersion }, take: 1 } },
  });
  const declaredOrder = access.config.curriculumLessonKeys;
  if (!declaredOrder) return rows;
  const index = new Map(declaredOrder.map((key, position) => [key, position]));
  return rows.filter((row) => index.has(row.slug)).sort((a, b) => index.get(a.slug)! - index.get(b.slug)!);
}

export async function preparePlayerContext(
  access: PlayerAccess,
  input: { lessonKey: string; blockId?: string; intent: PlayerIntent; parentIntent?: PlayerParentIntent },
  ltiContextId?: string,
): Promise<ValidatedPlayerContext> {
  let parentAssistantMessageId: string | undefined;
  if (input.intent === "expand") {
    if (!input.parentIntent) throw new PlayerError(400, "invalid_context", "Expansion requires a parent intent");
    const recent = await playerRuntimeRepo.message.findMany({
      where: { socioId: access.socioId, role: "assistant" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, metadata: true },
    });
    const prior = recent.find((row) => matchesExpansionParent(row.metadata, {
      courseCode: access.courseCode,
      collectionKey: access.collectionKey,
      programVersionId: access.programVersionId,
      lessonKey: input.lessonKey,
      blockId: input.blockId,
      parentIntent: input.parentIntent!,
    }));
    if (!prior) throw new PlayerError(409, "no_prior_reply", "There is no matching tutor reply to expand");
    parentAssistantMessageId = prior.id;
  }
  if (input.intent === "capstone" || (input.intent === "expand" && input.parentIntent === "capstone")) {
    return { surface: "player", courseCode: access.courseCode, ...input, collectionKey: access.collectionKey, programVersionId: access.programVersionId, parentAssistantMessageId, ltiContextId };
  }
  const rows = await lessonRows(access);
  const row = rows.find((item) => item.slug === input.lessonKey);
  if (!row?.versions[0]) throw new PlayerError(404, "lesson_not_found", "Lesson not found");
  const lesson = lessonSchema.parse(row.versions[0].body);
  if (!input.blockId) return { surface: "player", courseCode: access.courseCode, ...input, collectionKey: access.collectionKey, programVersionId: access.programVersionId, parentAssistantMessageId, ltiContextId };
  const block = lesson.blocks.find((item) => item.id === input.blockId);
  if (!block) throw new PlayerError(404, "block_not_found", "Block not found");
  if (input.intent === "teach_back" && block.blockType !== "teach_back") throw new PlayerError(400, "invalid_context", "The selected block is not a teach-back");
  const existing = await playerRuntimeRepo.blockProgress.findUnique({
    where: { socioId_collectionKey_lessonKey_blockId: { socioId: access.socioId, collectionKey: access.collectionKey, lessonKey: input.lessonKey, blockId: input.blockId } },
  });
  const state = existing?.contentVersion === block.contentVersion && existing.state && typeof existing.state === "object" && !Array.isArray(existing.state)
    ? existing.state as { turnCount?: unknown } : {};
  const turnCount = typeof state.turnCount === "number" ? state.turnCount : 0;
  return {
    surface: "player", courseCode: access.courseCode, ...input, collectionKey: access.collectionKey, programVersionId: access.programVersionId,
    contentVersion: block.contentVersion, teachBackTurn: input.intent === "teach_back" ? (turnCount >= 1 ? 2 : 1) : undefined,
    parentAssistantMessageId, ltiContextId,
  };
}

export async function recordPlayerTutorSuccess(socioId: string, context: ValidatedPlayerContext) {
  if (context.intent !== "teach_back" || !context.blockId || !context.contentVersion || !context.teachBackTurn) return;
  const completedAt = context.teachBackTurn === 2 ? new Date() : null;
  await playerRuntimeRepo.blockProgress.upsert({
    where: { socioId_collectionKey_lessonKey_blockId: { socioId, collectionKey: context.collectionKey, lessonKey: context.lessonKey, blockId: context.blockId } },
    create: { socioId, collectionKey: context.collectionKey, lessonKey: context.lessonKey, blockId: context.blockId, contentVersion: context.contentVersion, completedAt, score: completedAt ? 1 : null, state: { turnCount: context.teachBackTurn } },
    update: { contentVersion: context.contentVersion, completedAt, score: completedAt ? 1 : null, state: { turnCount: context.teachBackTurn } },
  });
  if (context.teachBackTurn === 2) {
    const version = await playerRuntimeRepo.programVersion.findUniqueOrThrow({ where: { id: context.programVersionId }, select: { version: true } });
    const rows = await playerRuntimeRepo.contentLesson.findMany({
      where: { collection: { slug: context.collectionKey, programVersions: { some: { id: context.programVersionId } } } }, orderBy: { orderIndex: "asc" },
      include: { versions: { where: { version: version.version }, take: 1 } },
    });
    const index = rows.findIndex((row) => row.slug === context.lessonKey);
    const body = index >= 0 && rows[index].versions[0] ? lessonSchema.safeParse(rows[index].versions[0].body) : null;
    if (body?.success) {
      const progress = await playerRuntimeRepo.blockProgress.findMany({ where: { socioId, collectionKey: context.collectionKey, lessonKey: context.lessonKey, completedAt: { not: null } } });
      const lessonComplete = body.data.blocks.every((block) => progress.some((item) => item.blockId === block.id && item.contentVersion === block.contentVersion));
      if (lessonComplete) await playerRuntimeRepo.lessonProgress.upsert({ where: { socioId_lessonNumber: { socioId, lessonNumber: index + 1 } }, create: { socioId, lessonNumber: index + 1, completedAt: new Date() }, update: { completedAt: new Date() } });
    }
  }
}

/**
 * The project dashboard for the lesson player, or null when it must not render.
 *
 * Composed here rather than behind a fourth endpoint. The player already awaits
 * the lesson DTO, and the two reads this adds are cheap next to what that call
 * already does — `rows` is threaded in from the caller precisely so this does
 * not re-run `lessonRows`, which is the expensive part and which
 * `getCourseProgress` would otherwise repeat.
 *
 * Fails open to null, never throws. A dashboard is decoration around the thing
 * the learner came for; a broken project read must not cost them the lesson.
 */
async function getLessonDashboard(
  access: PlayerAccess,
  rows: Awaited<ReturnType<typeof lessonRows>>,
): Promise<LessonDashboard | null> {
  // Courses that do not configure project selection have no project to show.
  // This is the branch that leaves MI and PB&J untouched — no course code is
  // consulted anywhere in this path.
  if (!access.config.projectSelection) return null;

  try {
    const project = await getCurrentLearnerProject(access);
    if (!project) return null;

    const blockProgress = await playerRuntimeRepo.blockProgress.findMany({
      where: { socioId: access.socioId, collectionKey: access.collectionKey },
    });
    const lessons = rows.map((row) => {
      const parsed = row.versions[0] ? lessonSchema.safeParse(row.versions[0].body) : null;
      const body = parsed?.success ? parsed.data : null;
      return {
        lessonKey: row.slug,
        title: body?.title ?? row.slug,
        complete: body
          ? body.blocks.every((block) => blockProgress.some((item) =>
              item.lessonKey === row.slug
              && item.blockId === block.id
              && item.contentVersion === block.contentVersion
              && item.completedAt))
          : false,
      };
    });

    const outcome = access.config.outcome;
    let milestones: ReturnType<typeof milestoneStates> = [];
    let graduated = false;
    if (outcome) {
      const reached = new Set(
        (await playerRuntimeRepo.milestoneProgress.findMany({
          where: { socioId: access.socioId, collectionKey: access.collectionKey },
          select: { milestoneKey: true },
        })).map((item) => item.milestoneKey),
      );
      const completedLessonKeys = new Set(
        lessons.filter((lesson) => lesson.complete).map((lesson) => lesson.lessonKey),
      );
      milestones = milestoneStates(
        outcome.milestones.map(normalizeMilestoneAvailability),
        completedLessonKeys,
        reached,
      );
      graduated = outcome.milestones.length > 0
        && outcome.milestones.every((milestone) => reached.has(milestone.key));
    }

    return buildLessonDashboard({ project, milestones, lessons, graduated });
  } catch (error) {
    console.warn("[PlayerDashboard] build failed; rendering the lesson without it", error);
    return null;
  }
}

/**
 * The learner's persisted tutor turns for one lesson, oldest first.
 *
 * Scoped by the metadata the handler already writes on both the user and the
 * assistant row (`surface`, `collectionKey`, `lessonKey`). `/api/chat/history`
 * cannot serve this: it returns the socio's last 50 messages across every
 * context, so a learner who ever used the chat surface would find MI turns
 * inside a player lesson — and it authenticates with a cookie session only,
 * which locks out Canvas learners whose identity is a bearer token.
 *
 * The socioId predicate is what makes the JSON filters cheap: `messages` is
 * indexed on `[socioId, createdAt]`, so the path comparisons only ever run over
 * one learner's rows.
 */
export async function getLessonThread(access: PlayerAccess, lessonKey: string) {
  return playerRuntimeRepo.message.findMany({
    where: {
      socioId: access.socioId,
      assessmentSessionId: null,
      AND: [
        { metadata: { path: ["surface"], equals: "player" } },
        { metadata: { path: ["collectionKey"], equals: access.collectionKey } },
        { metadata: { path: ["lessonKey"], equals: lessonKey } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, senderType: true, createdAt: true, metadata: true },
  });
}

export async function getLessonDto(access: PlayerAccess, lessonKey: string) {
  if (await learnerProjectSelectionRequired(access)) {
    throw new PlayerError(403, "project_required", "Choose your project before starting the course");
  }
  const diagnosticRequired = access.config.onboarding?.mode === "baseline_quiz";
  if (diagnosticRequired) {
    const attempts = await playerRuntimeRepo.diagnosticAttempt.count({ where: { socioId: access.socioId, programVersionId: access.programVersionId } });
    if (attempts === 0) throw new PlayerError(403, "diagnostic_required", "Complete the baseline diagnostic first");
  }
  const rows = await lessonRows(access);
  const index = rows.findIndex((row) => row.slug === lessonKey);
  if (index < 0 || !rows[index].versions[0]) throw new PlayerError(404, "lesson_not_found", "Lesson not found");
  const lesson = lessonSchema.parse(rows[index].versions[0].body);
  const progress = await playerRuntimeRepo.blockProgress.findMany({
    where: { socioId: access.socioId, collectionKey: access.collectionKey, lessonKey },
  });
  const progressById = new Map(progress.map((item) => [item.blockId, item]));
  const dashboard = await getLessonDashboard(access, rows);
  return {
    dashboard,
    lesson: { ...lesson, blocks: lesson.blocks.map(sanitizePlayerBlock) },
    previousLessonKey: rows[index - 1]?.slug ?? null,
    nextLessonKey: rows[index + 1]?.slug ?? null,
    hasCapstone: !!access.config.outcome,
    /**
     * Whether to render "request help from a human". Config-driven rather than
     * course-driven: the player must never ask which course it is showing.
     */
    helpRequestEnabled: access.config.helpRequest?.enabled === true,
    progress: lesson.blocks.map((block) => {
      const item = progressById.get(block.id);
      const current = item?.contentVersion === block.contentVersion;
      const state = current && block.blockType === "teach_back" && item?.state && typeof item.state === "object" && !Array.isArray(item.state)
        ? { turnCount: Number((item.state as { turnCount?: unknown }).turnCount) || 0 }
        : undefined;
      return { blockId: block.id, contentVersion: block.contentVersion, startedAt: current ? item?.startedAt ?? null : null, completedAt: current ? item?.completedAt ?? null : null, score: current ? item?.score ?? null : null, state };
    }),
  };
}

export function gradePlayerBlock(block: LessonBlock, response: unknown) {
  if (block.blockType === "teach") return { complete: true, score: 1, response: { acknowledged: true }, feedback: null };
  if (block.blockType === "quiz_checkpoint") {
    if (!response || typeof response !== "object" || Array.isArray(response)) throw new PlayerError(400, "invalid_response", "Submit an answer for every question");
    const answers = response as Record<string, unknown>;
    if (block.questions.some((question) => typeof answers[question.id] !== "string")) throw new PlayerError(400, "incomplete_response", "Submit an answer for every question");
    if (block.questions.some((question) => question.format === "multiple_choice" && !question.options?.includes(answers[question.id] as string))) throw new PlayerError(400, "invalid_response", "Every answer must be one of the question options");
    // Ungraded questions are recorded, never judged. Scoring runs over the
    // graded ones only, and a block with none scores null rather than zero —
    // "no opinion was wrong" and "every answer was wrong" must not look alike
    // in BlockProgress.score.
    const graded = block.questions.filter((question) => question.graded);
    const results = graded.map((question) => ({
      questionId: question.id, correct: answers[question.id] === question.answerKey,
      correctAnswer: question.answerKey, explanation: question.explanation,
    }));
    return {
      complete: true,
      score: results.length > 0 ? results.filter((item) => item.correct).length / results.length : null,
      response: answers,
      // No graded questions means no verdict to show, which also lets the
      // player advance straight past an opinion poll instead of pausing on a
      // feedback panel that would have nothing in it.
      feedback: results.length > 0 ? { questions: results } : null,
    };
  }
  if (block.blockType === "drag_order") {
    if (!Array.isArray(response) || !response.every(Number.isInteger)) throw new PlayerError(400, "invalid_response", "Submit an item-index order");
    const misplacedPositions = block.correctOrder.flatMap((value, index) => response[index] === value ? [] : [index]);
    const correct = misplacedPositions.length === 0 && response.length === block.correctOrder.length;
    return { complete: correct, score: correct ? 1 : 0, response, feedback: { correct, misplacedPositions, correctOrder: correct ? block.correctOrder : undefined } };
  }
  if (block.blockType === "teach_back") throw new PlayerError(409, "tutor_required", "Complete teach-back blocks through the tutor");
  return { complete: true, score: 1, response, feedback: null };
}

export async function completeBlock(access: PlayerAccess, lessonKey: string, blockId: string, response: unknown) {
  const rows = await lessonRows(access);
  const lessonIndex = rows.findIndex((row) => row.slug === lessonKey);
  if (lessonIndex < 0 || !rows[lessonIndex].versions[0]) throw new PlayerError(404, "lesson_not_found", "Lesson not found");
  const lesson = lessonSchema.parse(rows[lessonIndex].versions[0].body);
  const block = lesson.blocks.find((item) => item.id === blockId);
  if (!block) throw new PlayerError(404, "block_not_found", "Block not found");
  const existing = await playerRuntimeRepo.blockProgress.findUnique({
    where: { socioId_collectionKey_lessonKey_blockId: { socioId: access.socioId, collectionKey: access.collectionKey, lessonKey, blockId } },
  });
  if (existing?.contentVersion === block.contentVersion && existing.completedAt) {
    const existingGrade = gradePlayerBlock(block, existing.response);
    const progress = await playerRuntimeRepo.blockProgress.findMany({ where: { socioId: access.socioId, collectionKey: access.collectionKey, lessonKey } });
    const lessonComplete = lesson.blocks.every((item) => progress.some((entry) => entry.blockId === item.id && entry.contentVersion === item.contentVersion && entry.completedAt));
    return { blockId, completed: true, score: existing.score, feedback: existingGrade.feedback, lessonComplete };
  }
  const grade = gradePlayerBlock(block, response);
  const now = new Date();
  await playerRuntimeRepo.blockProgress.upsert({
    where: { socioId_collectionKey_lessonKey_blockId: { socioId: access.socioId, collectionKey: access.collectionKey, lessonKey, blockId } },
    create: { socioId: access.socioId, collectionKey: access.collectionKey, lessonKey, blockId, contentVersion: block.contentVersion, completedAt: grade.complete ? now : null, score: grade.score, response: grade.response as object },
    update: { contentVersion: block.contentVersion, startedAt: now, completedAt: grade.complete ? now : null, score: grade.score, response: grade.response as object, state: undefined },
  });

  const progress = await playerRuntimeRepo.blockProgress.findMany({ where: { socioId: access.socioId, collectionKey: access.collectionKey, lessonKey } });
  const completeIds = new Set(progress.filter((item) => item.completedAt && lesson.blocks.some((blockItem) => blockItem.id === item.blockId && blockItem.contentVersion === item.contentVersion)).map((item) => item.blockId));
  const lessonComplete = lesson.blocks.every((item) => completeIds.has(item.id));
  if (lessonComplete) {
    await playerRuntimeRepo.lessonProgress.upsert({
      where: { socioId_lessonNumber: { socioId: access.socioId, lessonNumber: lessonIndex + 1 } },
      create: { socioId: access.socioId, lessonNumber: lessonIndex + 1, completedAt: now },
      update: { completedAt: now },
    });
  }
  return { blockId, completed: grade.complete, score: grade.score, feedback: grade.feedback, lessonComplete };
}

export async function getCourseProgress(access: PlayerAccess) {
  const rows = await lessonRows(access);
  const progress = await playerRuntimeRepo.blockProgress.findMany({ where: { socioId: access.socioId, collectionKey: access.collectionKey } });
  const milestones = await playerRuntimeRepo.milestoneProgress.findMany({ where: { socioId: access.socioId, collectionKey: access.collectionKey }, orderBy: { reachedAt: "asc" } });
  return {
    lessons: rows.map((row) => {
      const lesson = row.versions[0] ? lessonSchema.parse(row.versions[0].body) : null;
      const complete = lesson ? lesson.blocks.every((block) => progress.some((item) => item.lessonKey === row.slug && item.blockId === block.id && item.contentVersion === block.contentVersion && item.completedAt)) : false;
      return { lessonKey: row.slug, orderIndex: row.orderIndex, title: lesson?.title ?? row.slug, complete };
    }),
    completedBlocks: rows.reduce((count, row) => {
      const lesson = row.versions[0] ? lessonSchema.safeParse(row.versions[0].body) : null;
      if (!lesson?.success) return count;
      return count + lesson.data.blocks.filter((block) => progress.some((item) => item.lessonKey === row.slug && item.blockId === block.id && item.contentVersion === block.contentVersion && item.completedAt)).length;
    }, 0),
    milestones: milestones.map((item) => ({ key: item.milestoneKey, reachedAt: item.reachedAt })),
  };
}

export async function getCapstoneDto(access: PlayerAccess) {
  const outcome = access.config.outcome;
  if (!outcome) throw new PlayerError(404, "capstone_not_found", "This course has no capstone");
  const progress = await getCourseProgress(access);
  const completedLessonKeys = new Set(progress.lessons.filter((lesson) => lesson.complete).map((lesson) => lesson.lessonKey));
  const reached = new Set(progress.milestones.map((milestone) => milestone.key));
  const states = milestoneStates(outcome.milestones.map(normalizeMilestoneAvailability), completedLessonKeys, reached);
  return {
    project: outcome.project,
    milestones: states,
    nextMilestone: states.find((milestone) => milestone.status === "current") ?? null,
    completedMilestones: reached.size,
    graduated: outcome.milestones.length > 0 && outcome.milestones.every((milestone) => reached.has(milestone.key)),
  };
}

export function milestoneStates(
  milestones: NormalizedMilestone[],
  completedLessonKeys: ReadonlySet<string>,
  reached: ReadonlySet<string>,
) {
  let currentAssigned = false;
  return milestones.map((milestone) => {
    const isReached = reached.has(milestone.key);
    const eligible = milestone.availability.type === "immediate"
      || (milestone.availability.type === "after_lesson" && completedLessonKeys.has(milestone.availability.lessonKey))
      || (milestone.availability.type === "after_milestone" && reached.has(milestone.availability.milestoneKey));
    const available = !isReached && eligible && !currentAssigned;
    if (available) currentAssigned = true;
    return { ...milestone, reached: isReached, available, status: isReached ? "reached" as const : available ? "current" as const : "locked" as const };
  });
}

/** One pre-response snapshot prevents marker N from unlocking marker N+1 in the same model reply. */
export async function playerMilestoneAvailabilitySnapshot(socioId: string, context: ValidatedPlayerContext): Promise<ReadonlySet<string>> {
  if (context.intent !== "capstone") return new Set();
  const version = await playerRuntimeRepo.programVersion.findUnique({ where: { id: context.programVersionId }, select: { version: true, config: true } });
  if (!version) return new Set();
  const config = programVersionConfigSchema.safeParse(version.config);
  const milestones = config.success ? config.data.outcome?.milestones.map(normalizeMilestoneAvailability) : undefined;
  if (!milestones) return new Set();
  const lessons = await playerRuntimeRepo.contentLesson.findMany({
    where: { collection: { programVersions: { some: { id: context.programVersionId } } }, versions: { some: { version: version.version } } },
    include: { versions: { where: { version: version.version }, take: 1 } },
  });
  const [progress, milestoneProgress] = await Promise.all([
    playerRuntimeRepo.blockProgress.findMany({ where: { socioId, collectionKey: context.collectionKey, completedAt: { not: null } } }),
    playerRuntimeRepo.milestoneProgress.findMany({ where: { socioId, collectionKey: context.collectionKey } }),
  ]);
  const completedLessonKeys = new Set(lessons.flatMap((lesson) => {
    const body = lesson.versions[0] ? lessonSchema.safeParse(lesson.versions[0].body) : null;
    if (!body?.success) return [];
    return body.data.blocks.every((block) => progress.some((item) => item.lessonKey === lesson.slug && item.blockId === block.id && item.contentVersion === block.contentVersion)) ? [lesson.slug] : [];
  }));
  const reached = new Set(milestoneProgress.map((item) => item.milestoneKey));
  return new Set(milestoneStates(milestones, completedLessonKeys, reached).filter((item) => item.available).map((item) => item.key));
}

export function diagnosticDto(access: PlayerAccess) {
  const diagnostic = access.config.onboarding?.diagnostic;
  if (!diagnostic) throw new PlayerError(404, "diagnostic_not_found", "This course has no diagnostic");
  return { ...diagnostic, questions: diagnostic.questions.map((question) => {
    const safe = { ...question } as Partial<typeof question>;
    delete safe.answerKey;
    delete safe.explanation;
    return safe;
  }) };
}

export function aggregateDiagnosticDimensionScores(
  results: ReadonlyArray<{ question: { dimensionKey?: string }; correct: boolean }>,
): Record<string, number> {
  const dimensions = new Map<string, { correct: number; total: number }>();
  for (const { question, correct } of results) {
    if (!question.dimensionKey) continue;
    const aggregate = dimensions.get(question.dimensionKey) ?? { correct: 0, total: 0 };
    aggregate.total += 1;
    if (correct) aggregate.correct += 1;
    dimensions.set(question.dimensionKey, aggregate);
  }
  return Object.fromEntries(
    [...dimensions].map(([dimensionKey, aggregate]) => [dimensionKey, aggregate.correct / aggregate.total]),
  );
}

export function passingDiagnosticDimensions(
  dimensionScores: Readonly<Record<string, number>>,
  threshold: number,
): Array<[string, number]> {
  return Object.entries(dimensionScores).filter(([, score]) => score >= threshold);
}

export async function submitDiagnostic(access: PlayerAccess, answers: unknown) {
  const diagnostic = access.config.onboarding?.diagnostic;
  if (!diagnostic) throw new PlayerError(404, "diagnostic_not_found", "This course has no diagnostic");
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new PlayerError(400, "invalid_answers", "Submit one answer per question");
  const submitted = answers as Record<string, unknown>;
  if (diagnostic.questions.some((question) => typeof submitted[question.id] !== "string")) throw new PlayerError(400, "incomplete_answers", "Submit one answer per question");
  if (diagnostic.questions.some((question) => !question.options?.includes(submitted[question.id] as string))) throw new PlayerError(400, "invalid_answers", "Every answer must be one of the question options");
  const results = diagnostic.questions.map((question) => ({ question, correct: submitted[question.id] === question.answerKey }));
  const dimensionScores = aggregateDiagnosticDimensionScores(results);
  const overallScore = results.filter((item) => item.correct).length / results.length;
  const attempt = await playerRuntimeRepo.diagnosticAttempt.create({ data: { socioId: access.socioId, programVersionId: access.programVersionId, collectionKey: access.collectionKey, answers: submitted as object, dimensionScores, overallScore } });
  for (const [dimensionKey] of passingDiagnosticDimensions(dimensionScores, diagnostic.threshold)) {
    await playerRuntimeRepo.socioDimensionState.upsert({
      where: { socioId_dimensionKey: { socioId: access.socioId, dimensionKey } },
      create: { socioId: access.socioId, dimensionKey, level: diagnostic.threshold, trend: "flat", confidence: 1, evidence: `Baseline diagnostic ${attempt.id}` },
      update: { level: diagnostic.threshold, trend: "flat", confidence: 1, evidence: `Baseline diagnostic ${attempt.id}` },
    });
    const metric = await playerRuntimeRepo.metricDefinition.findUnique({ where: { organizationId_key: { organizationId: access.organizationId, key: dimensionKey } } });
    if (metric) await playerRuntimeRepo.metricObservation.create({ data: { metricId: metric.id, enrollmentId: access.enrollmentId, signalType: "point", value: diagnostic.threshold, confidence: 1, evidenceRefs: { kind: "diagnostic", attemptId: attempt.id, dimensionKey }, source: "system_observed", observedAt: attempt.completedAt } });
  }
  return {
    attemptId: attempt.id, overallScore, threshold: diagnostic.threshold, dimensionScores,
    questions: results.map(({ question, correct }) => ({ questionId: question.id, correct, correctAnswer: question.answerKey, explanation: question.explanation })),
  };
}

export async function markTeachBackComplete(access: PlayerAccess, lessonKey: string, blockId: string, state: object) {
  const rows = await lessonRows(access);
  const row = rows.find((item) => item.slug === lessonKey);
  if (!row?.versions[0]) throw new PlayerError(404, "lesson_not_found", "Lesson not found");
  const lesson = lessonSchema.parse(row.versions[0].body);
  const block = lesson.blocks.find((item) => item.id === blockId && item.blockType === "teach_back");
  if (!block) throw new PlayerError(404, "block_not_found", "Teach-back block not found");
  await playerRuntimeRepo.blockProgress.upsert({
    where: { socioId_collectionKey_lessonKey_blockId: { socioId: access.socioId, collectionKey: access.collectionKey, lessonKey, blockId } },
    create: { socioId: access.socioId, collectionKey: access.collectionKey, lessonKey, blockId, contentVersion: block.contentVersion, completedAt: new Date(), score: 1, state },
    update: { contentVersion: block.contentVersion, completedAt: new Date(), score: 1, state },
  });
}
