import { playerRuntimeRepo } from "@/lib/repo/playerRuntimeRepo";
import { tenantRepo } from "@/lib/repo";
import { createTenantContext } from "@/lib/repo/tenantContext";
import type { RequestIdentity } from "@/lib/auth/requestIdentity";
import { resolveCourseCode } from "@/lib/courses/resolver";
import { resolveDelivery } from "@/lib/journey-package/delivery";
import { resolveIntroMessage } from "@/lib/journey-package/introMessage";
import { lessonSchema, normalizeMilestoneAvailability, type NormalizedMilestone, type ParsedLessonBlock as LessonBlock } from "@/lib/journey-package/journey-package.schema";
import { programVersionConfigSchema, type ProgramVersionConfig } from "@/lib/journey-package/program-version-config.schema";
import { mergeAssessmentConfig } from "@/lib/journey-package/mergeAssessmentConfig";
import { getCurrentLearnerProject, learnerProjectSelectionRequired } from "./learnerProject";
import { buildLessonDashboard, type LessonDashboard } from "./dashboard";
import { createAssessmentSession } from "@/lib/ai/assessment/createAssessmentSession";

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
  /** B.1: authored course intro, resolved to the learner's language. Null if none is authored. */
  introMessage: string | null;
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
  /**
   * A.4 (Platform Restructure Phase A, Stage 4). Threaded from
   * PlayerAccess.enrollmentId so recordPlayerTutorSuccess — the one
   * BlockProgress writer here that only has a socioId, not a full
   * PlayerAccess — can still populate BlockProgress.enrollmentId at
   * creation without a second lookup.
   */
  enrollmentId: string;
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
    // A.5 (Platform Restructure Phase A, Stage 5 — closes G2): Enrollment is
    // consulted FIRST and is what grants access. Before this, the gate below
    // (curriculumCollectionKey !== collectionKey -> 403) ran BEFORE this
    // lookup, so a learner with a fully valid ACTIVE enrollment for
    // collectionKey was rejected outright whenever the single legacy field
    // happened to name a different course — the actual single-course
    // constraint, not a missing table. This is what delivers multi-course: a
    // learner with two ACTIVE enrollments can now reach either directly by
    // URL, independent of which one curriculumCollectionKey currently names.
    const enrollment = socio.participantProfile ? await playerRuntimeRepo.enrollment.findFirst({
      where: {
        participantId: socio.participantProfile.id,
        status: "active",
        programVersion: { status: { in: ["published", "archived"] }, collection: { slug: collectionKey } },
      },
      include: { programVersion: { include: { collection: true, program: true } } },
      orderBy: { enrolledAt: "desc" },
    }) : null;
    if (!enrollment?.programVersion) {
      // DEPRECATED fallback (A.6 removes this branch entirely — see the
      // curriculumCollectionKey doc comment on the Socio model). Grants
      // nothing: there is no programVersion to serve without a real
      // Enrollment row, full stop. This exists only to distinguish, in logs,
      // "the profile still names this course but has no matching Enrollment"
      // (a real data gap worth knowing about — post-A.3 no active socio
      // should hit this) from a plain "never enrolled here."
      if (socio.curriculumCollectionKey === collectionKey) {
        console.warn(`[PlayerAccess] socio ${socio.id} curriculumCollectionKey names "${collectionKey}" but has no matching active Enrollment — likely a data gap, not a legitimate deny.`);
      }
      throw new PlayerError(403, "not_enrolled", "An active enrollment in this course is required");
    }
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
    introMessage: resolveIntroMessage(programVersion.metadata, socio.language),
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
    const currentMilestoneKeys = await playerMilestoneAvailabilitySnapshot({
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
    return { surface: "player", courseCode: access.courseCode, ...input, collectionKey: access.collectionKey, programVersionId: access.programVersionId, enrollmentId: access.enrollmentId, parentAssistantMessageId, ltiContextId };
  }
  const rows = await lessonRows(access);
  const row = rows.find((item) => item.slug === input.lessonKey);
  if (!row?.versions[0]) throw new PlayerError(404, "lesson_not_found", "Lesson not found");
  const lesson = lessonSchema.parse(row.versions[0].body);
  if (!input.blockId) return { surface: "player", courseCode: access.courseCode, ...input, collectionKey: access.collectionKey, programVersionId: access.programVersionId, enrollmentId: access.enrollmentId, parentAssistantMessageId, ltiContextId };
  const block = lesson.blocks.find((item) => item.id === input.blockId);
  if (!block) throw new PlayerError(404, "block_not_found", "Block not found");
  if (input.intent === "teach_back" && block.blockType !== "teach_back") throw new PlayerError(400, "invalid_context", "The selected block is not a teach-back");
  const existing = await playerRuntimeRepo.blockProgress.findUnique({
    where: { enrollmentId_lessonKey_blockId: { enrollmentId: access.enrollmentId, lessonKey: input.lessonKey, blockId: input.blockId } },
  });
  const state = existing?.contentVersion === block.contentVersion && existing.state && typeof existing.state === "object" && !Array.isArray(existing.state)
    ? existing.state as { turnCount?: unknown } : {};
  const turnCount = typeof state.turnCount === "number" ? state.turnCount : 0;
  return {
    surface: "player", courseCode: access.courseCode, ...input, collectionKey: access.collectionKey, programVersionId: access.programVersionId, enrollmentId: access.enrollmentId,
    contentVersion: block.contentVersion, teachBackTurn: input.intent === "teach_back" ? (turnCount >= 1 ? 2 : 1) : undefined,
    parentAssistantMessageId, ltiContextId,
  };
}

export async function recordPlayerTutorSuccess(socioId: string, context: ValidatedPlayerContext) {
  if (context.intent !== "teach_back" || !context.blockId || !context.contentVersion || !context.teachBackTurn) return;
  const completedAt = context.teachBackTurn === 2 ? new Date() : null;
  const state = {
    turnCount: context.teachBackTurn,
    // The tutor's closing feedback is learner-visible review just like a quiz
    // verdict. Keep the block current until Continue explicitly acknowledges
    // it, including after a reload.
    ...(completedAt ? { reviewPending: true } : {}),
  };
  await playerRuntimeRepo.blockProgress.upsert({
    where: { enrollmentId_lessonKey_blockId: { enrollmentId: context.enrollmentId, lessonKey: context.lessonKey, blockId: context.blockId } },
    // enrollmentId set only on create, never on update — see the doc comment
    // on BlockProgress.collectionKey (A.4): the row is pinned to whichever
    // enrollment first wrote it.
    // A.6 closing cleanup: socioId/collectionKey no longer populated here —
    // this write's own reads (A.6.1's addendum) already moved to
    // enrollmentId, so the columns would just be dead weight on new rows.
    create: { lessonKey: context.lessonKey, blockId: context.blockId, contentVersion: context.contentVersion, completedAt, score: completedAt ? 1 : null, state, enrollmentId: context.enrollmentId },
    update: { contentVersion: context.contentVersion, completedAt, score: completedAt ? 1 : null, state },
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
      const progress = await playerRuntimeRepo.blockProgress.findMany({ where: { enrollmentId: context.enrollmentId, lessonKey: context.lessonKey, completedAt: { not: null } } });
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

    // A.6.1 addendum: enrollment-scoped, not socioId+collectionKey — a
    // retake must not show the dashboard as already complete from the
    // archived enrollment's rows.
    const blockProgress = await playerRuntimeRepo.blockProgress.findMany({
      where: { enrollmentId: access.enrollmentId },
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
          where: { enrollmentId: access.enrollmentId },
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
 * AI and learner turns are scoped by the metadata the handler writes on both
 * rows (`surface`, `collectionKey`, `lessonKey`). Human mentor DMs are direct
 * learner-level messages, so every `senderType="mentor"` row for this socio is
 * unioned into the thread without requiring guessed lesson metadata.
 *
 * The socioId predicate is what makes the JSON filters cheap: `messages` is
 * indexed on `[socioId, createdAt]`, so the path comparisons only ever run over
 * one learner's rows.
 */
export async function getLessonThread(access: PlayerAccess, lessonKey: string) {
  const rows = await playerRuntimeRepo.message.findMany({
    where: {
      socioId: access.socioId,
      OR: [
        { senderType: "mentor" },
        {
          assessmentSessionId: null,
          AND: [
            { metadata: { path: ["surface"], equals: "player" } },
            { metadata: { path: ["collectionKey"], equals: access.collectionKey } },
            { metadata: { path: ["lessonKey"], equals: lessonKey } },
          ],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, senderType: true, createdAt: true, metadata: true },
  });
  // Player lessons are introduced by authored block 1. Historical
  // mount-generated lesson_entry rows remain in the audit record but are not
  // lesson conversation and must not reappear after this fix.
  //
  // Filtered here rather than negating a JSON `intent` path equality directly
  // in the Prisma `where` clause: Postgres JSON-path equality on a missing
  // key evaluates to UNKNOWN, not FALSE, so negating that UNKNOWN is still
  // UNKNOWN and the WHERE clause silently drops the row instead of keeping
  // it. A missing `intent` must default to "not lesson_entry", not to
  // "excluded". Human mentor rows are always retained regardless of metadata.
  return rows.filter((row) => row.senderType === "mentor" || progressState(row.metadata).intent !== "lesson_entry");
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
    where: { enrollmentId: access.enrollmentId, lessonKey },
  });
  const progressById = new Map(progress.map((item) => [item.blockId, item]));
  const dashboard = await getLessonDashboard(access, rows);
  return {
    dashboard,
    lesson: { ...lesson, blocks: lesson.blocks.map(sanitizePlayerBlock) },
    // B.1: shown only entering the course's first lesson (index === 0, per
    // curriculum order — see `lessonRows`) AND only before the learner has
    // completed anything in it. Without the second half this re-showed on
    // every visit/reload of lesson 1, including after a retake landed back
    // on the same lesson mid-course — a course-level "welcome" reappearing
    // on visit six reads as a bug even though it's correct by `index === 0`
    // alone. `progressById` is enrollment-scoped, so a retake's fresh
    // enrollment naturally sees no completions and gets the intro again.
    introMessage: index === 0 && lesson.blocks.every((block) => !progressById.get(block.id)?.completedAt)
      ? access.introMessage
      : null,
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
      const persistedState = current && item?.state && typeof item.state === "object" && !Array.isArray(item.state)
        ? item.state as { turnCount?: unknown; reviewPending?: unknown }
        : undefined;
      const state = persistedState
        ? {
            ...(block.blockType === "teach_back" ? { turnCount: Number(persistedState.turnCount) || 0 } : {}),
            reviewPending: persistedState.reviewPending === true,
          }
        : undefined;
      const priorAttempts = Number(progressState(item?.state).attempts) || 0;
      const feedback = current && item?.completedAt && state?.reviewPending && block.blockType !== "teach_back"
        ? gradePlayerBlock(block, item.response, Math.max(priorAttempts, QUIZ_ATTEMPT_LIMIT), undefined, access.config.assessment).feedback
        : undefined;
      return { blockId: block.id, contentVersion: block.contentVersion, startedAt: current ? item?.startedAt ?? null : null, completedAt: current ? item?.completedAt ?? null : null, score: current ? item?.score ?? null : null, state, feedback };
    }),
  };
}

/**
 * How many times a learner may answer one graded quiz block.
 *
 * Two, because the answer key is a teaching resource that is spent the moment
 * it is shown. A first wrong answer is worth more as a second attempt than as
 * a reveal, and revealing on the first miss is also what made the block
 * unretryable: `completeBlock` stamps `completedAt` as soon as the block is
 * complete, and a complete block returns its stored grade instead of grading
 * the new one. Holding the key back and leaving the block incomplete is the
 * same shape `drag_order` has always had.
 */
export const QUIZ_ATTEMPT_LIMIT = 2;

/**
 * Server-graded verdicts, tagged so the player can dispatch on `kind` rather
 * than sniffing for properties. Anything the player cannot name it does not
 * render — an unrecognized verdict is a bug to fix in here, never a JSON dump
 * for a learner to read.
 */
export type PlayerFeedback =
  | {
      kind: "quiz";
      correct: boolean;
      /** The learner may submit a different set of answers to this block. */
      retryAvailable: boolean;
      questions: Array<{
        questionId: string;
        correct: boolean;
        /**
         * Present only once this question's key is spent — see
         * QUIZ_ATTEMPT_LIMIT. An array because `answerKey` is one, for the
         * multi-select formats; `multiple_choice` is refined to a single
         * string in the package schema.
         */
        correctAnswer?: string | string[];
        explanation?: string;
      }>;
    }
  | { kind: "drag_order"; correct: boolean; misplacedPositions: number[]; correctOrder?: number[] };

/**
 * B.2 Stage 2: merges a block's own `assessment` override onto the package's
 * `config.assessment` defaults. Mirrors `createAssessmentSession.ts`'s
 * `mergePassingConfig` exactly — per-field `override ?? base`, not a deep
 * merge or an object spread, so a block can override e.g. only
 * `showScoreToLearner` while inheriting everything else from the package.
 *
 * `base` is the already-zod-parsed `config.assessment` (schema defaults
 * already filled), so unlike `mergePassingConfig` — which merges a possibly-
 * unparsed raw input and needs a third hardcoded fallback per passing field —
 * this needs only two levels per field.
 */
/** Backward-compatible export; the merge itself lives at the shared choke point. */
export const mergeBlockAssessmentConfig = mergeAssessmentConfig;

export function gradePlayerBlock(
  block: LessonBlock,
  response: unknown,
  attempt = 1,
  /**
   * B.2 Stage 2: the caller resolves this — a DB read via
   * `tenantRepo.getAssessmentSessionsForSocioLesson` — before calling in,
   * keeping this function itself free of I/O. `score` is already
   * `showScoreToLearner`-gated by the caller; this function never re-derives
   * or re-gates it.
   */
  reteachGate?: { passed: boolean; score: number | null },
  /**
   * B.3 Stage 1: `config.assessment` (package-level defaults), needed only
   * when `block.assessment?.mode === "web_quiz"` to resolve
   * `mergeBlockAssessmentConfig`. Unlike `reteachGate`, this needs no I/O —
   * `access.config.assessment` is already in every caller's hand — so it's
   * passed straight through rather than pre-resolved into a caller-side
   * helper the way `resolveReteachGateSignal` is for reteach_gate.
   */
  packageAssessment?: ProgramVersionConfig["assessment"],
): { complete: boolean; score: number | null; response: unknown; feedback: PlayerFeedback | null } {
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
    const results = graded.map((question) => ({ question, correct: answers[question.id] === question.answerKey }));
    const allCorrect = results.every((item) => item.correct);
    // The last attempt either way: nothing left to earn by holding the key
    // back, and the block has to stop being a wall.
    const lastAttempt = allCorrect || attempt >= QUIZ_ATTEMPT_LIMIT;
    const rawScore = results.length > 0 ? results.filter((item) => item.correct).length / results.length : null;
    // No graded questions means no verdict to show, which also lets the
    // player advance straight past an opinion poll instead of pausing on a
    // feedback panel that would have nothing in it.
    const rawFeedback: PlayerFeedback | null = results.length > 0 ? {
      kind: "quiz" as const,
      correct: allCorrect,
      retryAvailable: !lastAttempt,
      questions: results.map(({ question, correct }) => (
        // Per question, not per block: a question the learner already got
        // right has no key left to protect, so its explanation lands while
        // they are still looking at their own answer. A question they missed
        // keeps both until the retry is spent.
        correct || lastAttempt
          ? { questionId: question.id, correct, correctAnswer: question.answerKey, explanation: question.explanation }
          : { questionId: question.id, correct }
      )),
    } : null;
    // B.3 Stage 1: a plain quiz_checkpoint (no assessment key — every block
    // in every live/archived course today) is completely untouched below —
    // rawScore/rawFeedback pass straight through, byte-identical to before
    // this stage. Only assessment.mode === "web_quiz" reroutes through
    // mergeBlockAssessmentConfig, mirroring resolveReteachGateSignal's
    // showScoreToLearner gate exactly (merged.showScoreToLearner ? value :
    // null), applied uniformly to score AND feedback, on every attempt
    // (complete or not) — not just the final one. Full suppression, not
    // field-stripping: gated feedback becomes `null` outright rather than
    // keeping the correct/incorrect shape with only correctAnswer/explanation
    // stripped. Reasoning: (a) mirrors the coarse feedback:null shape
    // resolveReteachGateSignal already ships for reteach_gate, keeping the
    // two showScoreToLearner-gated completion paths consistent with each
    // other; (b) a per-question correct/incorrect breakdown is itself a
    // score, just not expressed as a fraction — stripping only
    // correctAnswer/explanation would still tell the learner how many they
    // got right, which is exactly what showScoreToLearner:false is asking
    // not to reveal. One accepted side effect: nulling feedback also means
    // completeBlock's reviewPending/"Continue" pause never triggers for
    // these blocks (reviewPending requires !!grade.feedback or an actual
    // open-question hold) — coherent, not a bug, since there is nothing to
    // review when nothing was shown. The retry mechanism itself still works:
    // an incomplete attempt still returns complete:false, so the block stays
    // open for resubmission; the client just falls back to its generic
    // "Submit answer" label instead of "Try again" (feedbackAllowsRetry
    // requires a real quiz-shaped feedback object, which null doesn't
    // satisfy) — a label difference, not a functional break.
    if (block.assessment?.mode === "web_quiz") {
      const merged = mergeBlockAssessmentConfig(
        packageAssessment ?? { passing: { dimensionKey: "", threshold: 0, confidenceFloor: 0.5, minTurns: 2, maxTurns: 12 }, allowRetake: true, blocking: true, onMaxTurnsWithoutPass: "complete_with_scores", autoAppendTeachBack: false, showScoreToLearner: false },
        block.assessment,
      );
      return {
        complete: results.length === 0 || lastAttempt,
        score: merged.showScoreToLearner ? rawScore : null,
        response: answers,
        feedback: merged.showScoreToLearner ? rawFeedback : null,
      };
    }
    return {
      // A missed first attempt leaves the block incomplete so the learner can
      // answer it again; the second attempt completes it whatever the score,
      // which is what the block did unconditionally before.
      complete: results.length === 0 || lastAttempt,
      score: rawScore,
      response: answers,
      feedback: rawFeedback,
    };
  }
  if (block.blockType === "drag_order") {
    if (!Array.isArray(response) || !response.every(Number.isInteger)) throw new PlayerError(400, "invalid_response", "Submit an item-index order");
    const misplacedPositions = block.correctOrder.flatMap((value, index) => response[index] === value ? [] : [index]);
    const correct = misplacedPositions.length === 0 && response.length === block.correctOrder.length;
    return { complete: correct, score: correct ? 1 : 0, response, feedback: { kind: "drag_order" as const, correct, misplacedPositions, correctOrder: correct ? block.correctOrder : undefined } };
  }
  if (block.blockType === "teach_back") {
    // B.2 Stage 2: a reteach_gate teach_back resolves through
    // AssessmentSession.passedAt (via the caller-supplied reteachGate),
    // never through the tutor-turn path recordPlayerTutorSuccess uses for a
    // plain teach_back. Not complete until a passed session exists — no
    // hardcoded default lets it complete on its own.
    if (block.assessment?.mode === "reteach_gate") {
      return { complete: reteachGate?.passed === true, score: reteachGate?.score ?? null, response, feedback: null };
    }
    throw new PlayerError(409, "tutor_required", "Complete teach-back blocks through the tutor");
  }
  return { complete: true, score: 1, response, feedback: null };
}

type CompleteBlockOptions = {
  /** Client-side cap may disable the open-question pause after repeated gates. */
  openQuestionGateEnabled?: boolean;
  /** Explicit Continue from a block already saved as complete. */
  acknowledgeReview?: boolean;
};

function progressState(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * B.2 Stage 2: the only I/O behind a reteach_gate teach_back's completion
 * check — everything else in `gradePlayerBlock` stays a pure function. Goes
 * through the Stage 1 choke point (`tenantRepo.getAssessmentSessionsForSocioLesson`,
 * enrollment-scoped, tenant-isolated), never a direct `AssessmentSession`
 * query. "Passed" means any session for this enrollment+lesson+block has
 * `passedAt !== null` — same fact `stance.hasPassedCurrentLessonGates` uses
 * on the chat surface, so a learner who passed via one surface (once a
 * creation/turn UI exists on this one — not built yet, see report) reads as
 * passed on the other too.
 *
 * `showScoreToLearner` gating happens exactly once, here, at completion time.
 * The resulting `score` (or `null`) is what `completeBlock` writes into
 * `BlockProgress.score` — not re-derived on every later read. That means it
 * is NOT retroactive: flipping `showScoreToLearner` in config later does not
 * reveal a score for a block already completed under the old setting, since
 * the persisted row already has `null` baked in. Every later read of this
 * block's score (this function's own caller, `getLessonDto`'s progress
 * array, any future dashboard panel) inherits that write-time decision for
 * free rather than needing its own gate.
 */
async function resolveReteachGateSignal(
  access: PlayerAccess,
  lessonKey: string,
  blockId: string,
  block: LessonBlock & { blockType: "teach_back" },
): Promise<{ passed: boolean; score: number | null }> {
  const sessions = await tenantRepo.getAssessmentSessionsForSocioLesson(
    createTenantContext(access.organizationId),
    access.enrollmentId,
    lessonKey,
    blockId,
  );
  const passedSession = sessions.find((session) => session.passedAt !== null);
  if (!passedSession) return { passed: false, score: null };

  const merged = access.config.assessment
    ? mergeBlockAssessmentConfig(access.config.assessment, block.assessment)
    : undefined;
  const dimensionKey = merged?.passing.dimensionKey;
  const rawScore = dimensionKey && passedSession.scores && typeof passedSession.scores === "object"
    ? (passedSession.scores as Record<string, unknown>)[dimensionKey]
    : undefined;
  return { passed: true, score: merged?.showScoreToLearner && typeof rawScore === "number" ? rawScore : null };
}

/**
 * Stage 1 of the reteach-gate write path (see
 * reports/reteach-gate-write-path-design.md §a). Mirrors
 * `router.checkGatePosition`'s find-or-create shape exactly: an open
 * (non-completed) session for this enrollment+lesson+block is returned as-is;
 * only when none exists is a new one created via `createAssessmentSession`,
 * the same channel-agnostic core the chat surface uses. `channel` is always
 * `"web"` here — the player surface has no other transport.
 *
 * A completed session is deliberately NOT treated as "resumed" — the same
 * gate `checkGatePosition` applies (only non-completed sessions count as
 * open) — so calling this again after a completed-but-unpassed session with
 * `allowRetake: true` starts a fresh attempt, matching
 * `createAssessmentSession`'s own attempt-number semantics.
 */
export async function resolveOrCreateReteachGateSession(
  access: PlayerAccess,
  lessonKey: string,
  blockId: string,
): Promise<{ sessionId: string; resumed: boolean }> {
  const rows = await lessonRows(access);
  const lessonRow = rows.find((row) => row.slug === lessonKey);
  if (!lessonRow?.versions[0]) throw new PlayerError(404, "lesson_not_found", "Lesson not found");
  const lesson = lessonSchema.parse(lessonRow.versions[0].body);
  const block = lesson.blocks.find((item) => item.id === blockId);
  if (!block) throw new PlayerError(404, "block_not_found", "Block not found");
  if (block.blockType !== "teach_back" || block.assessment?.mode !== "reteach_gate") {
    throw new PlayerError(400, "not_reteach_gate", "This block is not a reteach-gate teach-back block");
  }

  const ctx = createTenantContext(access.organizationId);
  const existingSessions = await tenantRepo.getAssessmentSessionsForSocioLesson(ctx, access.enrollmentId, lessonKey, blockId);
  const openSession = existingSessions.find((session) => session.status !== "completed");
  if (openSession) return { sessionId: openSession.id, resumed: true };

  const session = await createAssessmentSession({
    ctx,
    repo: tenantRepo,
    socioId: access.socioId,
    lessonKey,
    blockId,
    channel: "web",
    enrollmentId: access.enrollmentId,
    collectionKey: access.collectionKey,
  });
  return { sessionId: session.id, resumed: false };
}

async function persistedBlockHoldsOpenQuestion(access: PlayerAccess, lessonKey: string, blockId: string): Promise<boolean> {
  const latest = await playerRuntimeRepo.message.findFirst({
    where: {
      socioId: access.socioId,
      assessmentSessionId: null,
      AND: [
        { metadata: { path: ["surface"], equals: "player" } },
        { metadata: { path: ["collectionKey"], equals: access.collectionKey } },
        { metadata: { path: ["lessonKey"], equals: lessonKey } },
        { metadata: { path: ["blockId"], equals: blockId } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { role: true, metadata: true },
  });
  const metadata = progressState(latest?.metadata);
  return latest?.role === "assistant" && metadata.endsWithQuestion === true;
}

export async function completeBlock(access: PlayerAccess, lessonKey: string, blockId: string, response: unknown, options: CompleteBlockOptions = {}) {
  const rows = await lessonRows(access);
  const lessonIndex = rows.findIndex((row) => row.slug === lessonKey);
  if (lessonIndex < 0 || !rows[lessonIndex].versions[0]) throw new PlayerError(404, "lesson_not_found", "Lesson not found");
  const lesson = lessonSchema.parse(rows[lessonIndex].versions[0].body);
  const block = lesson.blocks.find((item) => item.id === blockId);
  if (!block) throw new PlayerError(404, "block_not_found", "Block not found");
  const existing = await playerRuntimeRepo.blockProgress.findUnique({
    where: { enrollmentId_lessonKey_blockId: { enrollmentId: access.enrollmentId, lessonKey, blockId } },
  });
  if (options.acknowledgeReview) {
    if (existing?.contentVersion !== block.contentVersion || !existing.completedAt) {
      throw new PlayerError(409, "review_not_ready", "This block is not ready for review");
    }
    await playerRuntimeRepo.blockProgress.update({
      where: { id: existing.id },
      data: { state: { ...progressState(existing.state), reviewPending: false } },
    });
    return { blockId, completed: true, score: existing.score, feedback: null, reviewPending: false, lessonComplete: false };
  }
  // Attempts survive on the progress row, so a reload between tries cannot
  // hand the learner a fresh set of them. Counted per content version: an
  // edited block is a different question and starts over.
  const priorAttempts = existing?.contentVersion === block.contentVersion
    ? Number((existing.state as { attempts?: unknown } | null)?.attempts) || 0
    : 0;
  if (existing?.contentVersion === block.contentVersion && existing.completedAt) {
    // A finished block has no retry left to protect, so it re-grades at the
    // limit and shows the key. Legacy rows carry no attempt count; they are
    // complete, which is the only fact that matters here.
    const existingGrade = gradePlayerBlock(block, existing.response, Math.max(priorAttempts, QUIZ_ATTEMPT_LIMIT), undefined, access.config.assessment);
    const progress = await playerRuntimeRepo.blockProgress.findMany({ where: { enrollmentId: access.enrollmentId, lessonKey } });
    const lessonComplete = lesson.blocks.every((item) => progress.some((entry) => entry.blockId === item.id && entry.contentVersion === item.contentVersion && entry.completedAt));
    return {
      blockId,
      completed: true,
      score: existing.score,
      feedback: existingGrade.feedback,
      reviewPending: progressState(existing.state).reviewPending === true,
      lessonComplete,
    };
  }
  const attempt = priorAttempts + 1;
  const reteachGate = block.blockType === "teach_back" && block.assessment?.mode === "reteach_gate"
    ? await resolveReteachGateSignal(access, lessonKey, blockId, block)
    : undefined;
  const grade = gradePlayerBlock(block, response, attempt, reteachGate, access.config.assessment);
  const openQuestionReview = grade.complete
    && !grade.feedback
    && options.openQuestionGateEnabled !== false
    && await persistedBlockHoldsOpenQuestion(access, lessonKey, blockId);
  // Every bounded payload returns through an explicit verdict/Continue state,
  // including score-hidden quizzes whose feedback is intentionally null.
  // Plain quizzes and every non-assessment block keep their existing review
  // behavior exactly.
  const boundedReturnReview = grade.complete && block.assessment !== undefined;
  const reviewPending = grade.complete && (!!grade.feedback || openQuestionReview || boundedReturnReview);
  // Quizzes persist attempt count; every completed review shape also persists
  // its hold so hydration cannot mistake "saved" for "already reviewed."
  const state = {
    ...(block.blockType === "quiz_checkpoint" ? { attempts: attempt } : {}),
    ...(reviewPending ? { reviewPending: true } : {}),
  };
  const savedState = Object.keys(state).length > 0 ? state : undefined;
  const now = new Date();
  await playerRuntimeRepo.blockProgress.upsert({
    where: { enrollmentId_lessonKey_blockId: { enrollmentId: access.enrollmentId, lessonKey, blockId } },
    // enrollmentId set only on create, never on update — see A.4 note above.
    // A.6 closing cleanup: see recordPlayerTutorSuccess's identical note above.
    create: { lessonKey, blockId, contentVersion: block.contentVersion, completedAt: grade.complete ? now : null, score: grade.score, response: grade.response as object, state: savedState, enrollmentId: access.enrollmentId },
    update: { contentVersion: block.contentVersion, startedAt: now, completedAt: grade.complete ? now : null, score: grade.score, response: grade.response as object, state: savedState },
  });

  const progress = await playerRuntimeRepo.blockProgress.findMany({ where: { enrollmentId: access.enrollmentId, lessonKey } });
  const completeIds = new Set(progress.filter((item) => item.completedAt && lesson.blocks.some((blockItem) => blockItem.id === item.blockId && blockItem.contentVersion === item.contentVersion)).map((item) => item.blockId));
  const lessonComplete = lesson.blocks.every((item) => completeIds.has(item.id));
  if (lessonComplete) {
    await playerRuntimeRepo.lessonProgress.upsert({
      where: { socioId_lessonNumber: { socioId: access.socioId, lessonNumber: lessonIndex + 1 } },
      create: { socioId: access.socioId, lessonNumber: lessonIndex + 1, completedAt: now },
      update: { completedAt: now },
    });
  }
  return { blockId, completed: grade.complete, score: grade.score, feedback: grade.feedback, reviewPending, lessonComplete };
}

export async function getCourseProgress(access: PlayerAccess) {
  const rows = await lessonRows(access);
  const progress = await playerRuntimeRepo.blockProgress.findMany({ where: { enrollmentId: access.enrollmentId } });
  const milestones = await playerRuntimeRepo.milestoneProgress.findMany({ where: { enrollmentId: access.enrollmentId }, orderBy: { reachedAt: "asc" } });
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
export async function playerMilestoneAvailabilitySnapshot(context: ValidatedPlayerContext): Promise<ReadonlySet<string>> {
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
    playerRuntimeRepo.blockProgress.findMany({ where: { enrollmentId: context.enrollmentId, completedAt: { not: null } } }),
    playerRuntimeRepo.milestoneProgress.findMany({ where: { enrollmentId: context.enrollmentId } }),
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
    where: { enrollmentId_lessonKey_blockId: { enrollmentId: access.enrollmentId, lessonKey, blockId } },
    // enrollmentId set only on create, never on update — see A.4 note above.
    // A.6 closing cleanup: see recordPlayerTutorSuccess's identical note above.
    create: { lessonKey, blockId, contentVersion: block.contentVersion, completedAt: new Date(), score: 1, state, enrollmentId: access.enrollmentId },
    update: { contentVersion: block.contentVersion, completedAt: new Date(), score: 1, state },
  });
}
