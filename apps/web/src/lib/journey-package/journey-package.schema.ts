/**
 * Journey Package Schema — course cartridge format v1.0 through v1.2
 * ----------------------------------------------------------------------------
 * The portable, self-contained definition of one course/journey. A Course Lead
 * (or a file importer) produces one of these; the importer decomposes it into
 * database rows; the existing runtime reads those rows and delivers the course.
 *
 * This is the single source of truth for "what is a valid course." The same
 * schema backs (a) the file-upload validator, (b) the API ingestion endpoint,
 * and (c) the future web builder. It supersedes the hand-written `LessonData`
 * interface in src/lib/lessons/data.ts.
 *
 * How a package maps onto the planned domain model:
 *   metadata + config   -> Program + ProgramVersion.config (JSON blob)
 *   curriculum.lessons   -> ContentCollection + Lesson + LessonVersion rows
 *   outcome              -> Program outcome (project / milestones / resources)
 *
 * schemaVersion is the FORMAT version (bump when this file's shape changes).
 * metadata.version is the CONTENT version (author-managed, per course).
 * ----------------------------------------------------------------------------
 */
import { z } from "zod";

export const LEGACY_SCHEMA_VERSION = "1.0" as const;
export const V11_SCHEMA_VERSION = "1.1" as const;
export const SCHEMA_VERSION = "1.2" as const;

// ── Shared primitives ────────────────────────────────────────────────────────

/** Stable, human-readable identifier. Used for cross-references inside a package. */
const key = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "keys are lowercase, alphanumeric, hyphens, or underscores");

export const responseStyleSchema = z.object({
  maxSentences: z.number().int().min(1).optional(),
  maxOutputTokens: z.number().int().min(64).max(2048).optional(),
  markdown: z.enum(["allowed", "none"]).optional(),
  maxQuestions: z.number().int().min(0).optional(),
  expanded: z.object({
    maxSentences: z.number().int().min(1),
    maxOutputTokens: z.number().int().min(64).max(2048),
  }).optional(),
}).superRefine((style, ctx) => {
  if (style.expanded && style.maxSentences !== undefined && style.expanded.maxSentences < style.maxSentences) {
    ctx.addIssue({ code: "custom", message: "expanded.maxSentences cannot be lower than maxSentences", path: ["expanded", "maxSentences"] });
  }
  if (style.expanded && style.maxOutputTokens !== undefined && style.expanded.maxOutputTokens < style.maxOutputTokens) {
    ctx.addIssue({ code: "custom", message: "expanded.maxOutputTokens cannot be lower than maxOutputTokens", path: ["expanded", "maxOutputTokens"] });
  }
});
export type ResponseStyle = z.infer<typeof responseStyleSchema>;

export const milestoneAvailabilitySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("immediate") }),
  z.object({ type: z.literal("after_lesson"), lessonKey: key }),
  z.object({ type: z.literal("after_milestone"), milestoneKey: key }),
]);
export type MilestoneAvailability = z.infer<typeof milestoneAvailabilitySchema>;

export const milestoneSchema = z.object({
  key,
  name: z.string().min(1),
  availability: milestoneAvailabilitySchema.optional(),
  /** Legacy v1.0/v1.1 input. Import normalizes it to availability.after_lesson. */
  afterLessonKey: key.optional(),
  checkDescription: z.string().optional(),
}).superRefine((milestone, ctx) => {
  if (!milestone.availability && !milestone.afterLessonKey) {
    ctx.addIssue({ code: "custom", message: "milestone requires availability or legacy afterLessonKey", path: ["availability"] });
  }
  if (milestone.availability && milestone.afterLessonKey) {
    ctx.addIssue({ code: "custom", message: "milestone cannot declare both availability and afterLessonKey" });
  }
});

export type MilestoneInput = z.infer<typeof milestoneSchema>;
export type NormalizedMilestone = Omit<MilestoneInput, "availability" | "afterLessonKey"> & { availability: MilestoneAvailability };

export function normalizeMilestoneAvailability(milestone: MilestoneInput): NormalizedMilestone {
  const { afterLessonKey, ...rest } = milestone;
  return {
    ...rest,
    availability: milestone.availability ?? { type: "after_lesson", lessonKey: afterLessonKey! },
  };
}

/**
 * Localized string: English required, other languages optional.
 * Resolution: requested language → en (never empty).
 */
export const localizedStringSchema = z.object({
  en: z.string().min(1),
  es: z.string().optional(),
  pt: z.string().optional(),
});
export type LocalizedString = z.infer<typeof localizedStringSchema>;

/**
 * Source grounding (from the ingestion PDF): keeps AI-taught material traceable
 * back to an approved source. Optional per lesson.
 */
const provenanceSchema = z.object({
  sourceDocument: z.string().optional(),
  chapter: z.string().optional(),
  page: z.string().optional(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().datetime().optional(),
});

// ── Lesson blocks: the drag-and-drop unit within a lesson's timeline ─────────
//
// A lesson is a container; its `blocks[]` array IS the thing a Course Lead
// drags and reorders in the builder UI. Every block variant below is a peer
// on that one timeline — "AI explains," "quiz checkpoint," "teach-back," and
// "media/interactive" all sit at the same level and can be freely interleaved.
// This replaces the old `conversationSegmentSchema` (now the `teach` variant)
// plus the separate `resources`/`assessments` arrays (now `resource` and
// `quiz_checkpoint` variants, inline where the author placed them).
//
// order = array position. The `order` field is kept (not just array index) so
// block IDs survive a drag-reorder without renumbering every sibling.

export function normalizeOption(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
}

export const quizQuestionSchema = z
  .object({
    id: key,
    prompt: z.string().min(1),
    format: z.enum(["multiple_choice", "short_answer", "fill_in_blank", "drag_to_order", "matching"]),
    options: z.array(z.string()).optional(),
    /**
     * fill_in_blank only. A learner picks from this list instead of typing
     * free text, so an answer the grader sees is always one of these exact
     * strings — the paraphrase-marked-wrong failure mode (a correct-in-spirit
     * answer that free-text grading's normalized string match can never
     * catch, since it only ever compares against the authored `answerKey`
     * set) cannot occur by construction. Not `options`: that field is
     * explicitly forbidden on fill_in_blank below, and reusing it would
     * conflate "the choice list IS the question" (multiple_choice) with "an
     * optional aid alongside the blank" (this).
     *
     * Optional and additive: a question with no `wordBank` renders the
     * existing free-text input unchanged. Whether to include distractors
     * (harder, closer to a real recall check) or only the accepted answer(s)
     * (easier, closer to matching) is an authoring decision per question,
     * not something this schema decides — either is valid as long as every
     * accepted `answerKey` value is selectable (enforced below).
     */
    wordBank: z.array(z.string()).optional(),
    matchingPrompts: z.array(z.object({ id: key, text: z.string().min(1) })).optional(),
    answerKey: z.union([z.string(), z.array(z.string()), z.record(key, z.string())]).optional(),
    explanation: z.string().min(1).optional(),
    /** Ties this question to a tracked dimension for auto-assessment. */
    dimensionKey: key.optional(),
    /**
     * False for an opinion question — one with options but no correct answer
     * ("What do you know about X? A lot / Some / No clue"). It still renders as
     * a selectable MCQ and still records the choice; it just has no verdict.
     *
     * Defaults to true, so every question authored before this existed keeps
     * requiring an answer key and an explanation. Never author `false` on a
     * diagnostic question: diagnostics score dimensions against a threshold,
     * and that is enforced separately in the package cross-validation.
     *
     * The flag lives on the question rather than the block on purpose. The
     * answerKey rule is enforced in this schema's own `superRefine`, which
     * cannot see a parent block — moving the rule up to read a block-level flag
     * would relocate the check that currently protects
     * `baselineDiagnosticSchema.questions`, which shares this schema.
     */
    graded: z.boolean().default(true),
  })
  .refine(
    (q) => q.format !== "multiple_choice" || (q.options?.length ?? 0) >= 2,
    { message: "multiple_choice questions need at least 2 options", path: ["options"] },
  )
  .superRefine((q, ctx) => {
    const requireNoAnswerKeyWhenUngraded = () => {
      if (!q.graded && q.answerKey !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "an ungraded question must not declare an answerKey",
          path: ["answerKey"],
        });
      }
    };
    const requireUniqueOptions = (format: string) => {
      const options = q.options ?? [];
      const normalized = options.map(normalizeOption);
      if (new Set(normalized).size !== normalized.length) {
        ctx.addIssue({
          code: "custom",
          message: `${format} options must be unique after Unicode and whitespace normalization`,
          path: ["options"],
        });
      }
      return options;
    };

    if (q.format !== "fill_in_blank" && q.wordBank !== undefined) {
      ctx.addIssue({ code: "custom", message: "wordBank is only valid on fill_in_blank questions", path: ["wordBank"] });
    }

    if (q.format === "multiple_choice") {
      const options = requireUniqueOptions("multiple_choice");
      // Graded questions keep the original requirement, unconditionally. An
      // ungraded question must not carry a key at all — a stray one would look
      // authoritative to a later reader and to any future grader.
      if (q.graded) {
        if (typeof q.answerKey !== "string" || options.filter((o) => o === q.answerKey).length !== 1) {
          ctx.addIssue({
            code: "custom",
            message: "multiple_choice answerKey must equal exactly one raw option",
            path: ["answerKey"],
          });
        }
      } else {
        requireNoAnswerKeyWhenUngraded();
      }
      return;
    }

    // `short_answer` deliberately retains its pre-E.2 permissive schema.
    if (q.format === "short_answer") return;

    if (q.format === "fill_in_blank") {
      if (q.options !== undefined) {
        ctx.addIssue({ code: "custom", message: "fill_in_blank questions must not declare options", path: ["options"] });
      }
      if (q.matchingPrompts !== undefined) {
        ctx.addIssue({ code: "custom", message: "fill_in_blank questions must not declare matchingPrompts", path: ["matchingPrompts"] });
      }
      const accepted = typeof q.answerKey === "string"
        ? [q.answerKey]
        : Array.isArray(q.answerKey) ? q.answerKey : [];
      const normalizedAccepted = accepted.map(normalizeOption);
      if (q.graded) {
        if (accepted.length === 0 || normalizedAccepted.some((value) => value.length === 0)) {
          ctx.addIssue({ code: "custom", message: "fill_in_blank answerKey must declare at least one non-empty accepted answer", path: ["answerKey"] });
        } else if (new Set(normalizedAccepted).size !== normalizedAccepted.length) {
          ctx.addIssue({ code: "custom", message: "fill_in_blank accepted answers must be unique after Unicode and whitespace normalization", path: ["answerKey"] });
        }
      } else {
        requireNoAnswerKeyWhenUngraded();
      }
      if (q.wordBank !== undefined) {
        const normalizedBank = q.wordBank.map(normalizeOption);
        if (q.wordBank.length === 0 || normalizedBank.some((value) => value.length === 0)) {
          ctx.addIssue({ code: "custom", message: "fill_in_blank wordBank must not be empty or contain blank entries", path: ["wordBank"] });
        } else if (new Set(normalizedBank).size !== normalizedBank.length) {
          ctx.addIssue({ code: "custom", message: "fill_in_blank wordBank entries must be unique after Unicode and whitespace normalization", path: ["wordBank"] });
        } else if (q.graded && !normalizedAccepted.every((value) => normalizedBank.includes(value))) {
          // Every accepted answer must be selectable, or a learner who knows
          // the material correctly could never produce a gradeable-correct
          // answer — the bank would be quietly stricter than free text, the
          // opposite of the problem it exists to solve.
          ctx.addIssue({ code: "custom", message: "fill_in_blank wordBank must include every accepted answerKey value", path: ["wordBank"] });
        }
      }
      return;
    }

    if (q.format === "drag_to_order") {
      const options = requireUniqueOptions("drag_to_order");
      if (options.length < 2 || options.some((option) => normalizeOption(option).length === 0)) {
        ctx.addIssue({ code: "custom", message: "drag_to_order questions need at least 2 non-empty options", path: ["options"] });
      }
      if (q.matchingPrompts !== undefined) {
        ctx.addIssue({ code: "custom", message: "drag_to_order questions must not declare matchingPrompts", path: ["matchingPrompts"] });
      }
      if (q.graded) {
        const keyValues = Array.isArray(q.answerKey) ? q.answerKey : [];
        const expected = [...options].sort();
        const actual = [...keyValues].sort();
        if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
          ctx.addIssue({ code: "custom", message: "drag_to_order answerKey must be a complete, duplicate-free permutation of the raw options", path: ["answerKey"] });
        }
      } else {
        requireNoAnswerKeyWhenUngraded();
      }
      return;
    }

    const options = requireUniqueOptions("matching");
    const prompts = q.matchingPrompts ?? [];
    const promptIds = prompts.map((prompt) => prompt.id);
    const normalizedPrompts = prompts.map((prompt) => normalizeOption(prompt.text));
    if (prompts.length < 2 || options.length < 2 || prompts.length !== options.length || options.some((option) => normalizeOption(option).length === 0)) {
      ctx.addIssue({
        code: "custom",
        message: "matching questions need equal numbers of at least 2 prompts and options",
        path: ["matchingPrompts"],
      });
    }
    if (new Set(promptIds).size !== promptIds.length) {
      ctx.addIssue({ code: "custom", message: "matching prompt ids must be unique", path: ["matchingPrompts"] });
    }
    if (new Set(normalizedPrompts).size !== normalizedPrompts.length) {
      ctx.addIssue({ code: "custom", message: "matching prompts must be unique after Unicode and whitespace normalization", path: ["matchingPrompts"] });
    }
    if (q.graded) {
      const answerKey = q.answerKey && typeof q.answerKey === "object" && !Array.isArray(q.answerKey)
        ? q.answerKey
        : {};
      const answerPromptIds = Object.keys(answerKey).sort();
      const expectedPromptIds = [...promptIds].sort();
      const answerOptions = Object.values(answerKey).sort();
      const expectedOptions = [...options].sort();
      if (
        answerPromptIds.length !== expectedPromptIds.length
        || answerPromptIds.some((value, index) => value !== expectedPromptIds[index])
        || answerOptions.length !== expectedOptions.length
        || answerOptions.some((value, index) => value !== expectedOptions[index])
      ) {
        ctx.addIssue({ code: "custom", message: "matching answerKey must map every prompt id to a duplicate-free permutation of the raw options", path: ["answerKey"] });
      }
    } else {
      requireNoAnswerKeyWhenUngraded();
    }
  });

/**
 * Assessment passing criteria. Used by config.assessment.passing and
 * per-block passingOverride in gated teach_back blocks.
 */
export const passingSchema = z.object({
  dimensionKey: key, // dimension that gates completion (the "understanding" score)
  threshold: z.number(), // on that dimension's own scale
  /**
   * E.5.2 gotcha, costly enough to earn its own investigation stage — do not
   * repeat it. `checkPassCondition` (runAssessmentTurn.ts) ANDs THREE
   * independent conditions: turnCount >= minTurns, level >= threshold, AND
   * confidence >= confidenceFloor. `threshold: 0` alone does NOT produce an
   * always-pass gate — confidenceFloor still gates independently, defaults
   * to 0.5, and early-turn sensed confidence is typically 0.2 or lower. A
   * threshold-0 gate without also zeroing confidenceFloor will almost always
   * fall through to the maxTurns safety-valve backstop instead of a genuine
   * pass (bounded, not stranding — onMaxTurnsWithoutPass still resolves it —
   * but not "clean"). An ungraded/always-pass reteach_gate block needs BOTH
   * threshold: 0 AND confidenceFloor: 0 set explicitly.
   */
  confidenceFloor: z.number().min(0).max(1).optional().default(0.5),
  minTurns: z.number().int().positive().optional().default(2), // no one-sentence pass
  maxTurns: z.number().int().positive().optional().default(12), // safety valve
});

/**
 * B.2 (plan §"assessment" rescope; investigation report §5 item 12,
 * generalized past the report's package-level reading): whether a graded
 * block is a reteach-style gate or a plain graded checkpoint is authoring —
 * pedagogy — and belongs on the block, not on the course. `mode` selects
 * which behavior a block wants; every other field overrides that one
 * package-level `config.assessment` default for this block only.
 *
 * Deliberately not a 7th `lessonBlockSchema` union member: the content a
 * `web_quiz` needs is `questions[]`, which `quiz_checkpoint` already has —
 * this is governance layered on existing content, not new content. See the
 * "assessment.mode must match blockType" package-level check below for how
 * `mode` is kept honest without a discriminated union.
 *
 * Absent on every block in every package imported before this field existed
 * — append-only-safe by construction, no migration required.
 */
export const blockAssessmentOverrideSchema = z.object({
  mode: z.enum(["reteach_gate", "web_quiz"]),
  passingOverride: passingSchema.partial().optional(),
  /** Normalized 0–1 score required to complete a web quiz. */
  webQuizPassingScore: z.number().min(0).max(1).optional(),
  /**
   * Attempts before a web_quiz reveals correctAnswer/explanation and
   * auto-completes regardless of score — porting the plain quiz_checkpoint
   * path's QUIZ_ATTEMPT_LIMIT pattern (service.ts), which web_quiz never had:
   * that path has always had a 2-attempt cap with reveal-then-move-on;
   * web_quiz has always retried indefinitely with no reveal until passed.
   * Package-level default of 2 matches that existing precedent.
   */
  webQuizMaxAttempts: z.number().int().positive().optional(),
  allowRetake: z.boolean().optional(),
  showScoreToLearner: z.boolean().optional(),
});
export type BlockAssessmentOverride = z.infer<typeof blockAssessmentOverrideSchema>;

/** Discriminates each block variant. Shared by every entry in lessonBlockSchema. */
const blockBase = {
  id: key, // stable across reorders; referenced by dimensionKey ties, provenance, etc.
  order: z.number().int().positive(),
  /** Source concept keys survive conversion for sensing and provenance. */
  concepts: z.array(key).default([]),
  /** Increment intentionally to reset learner progress for this block. */
  contentVersion: z.number().int().positive().default(1),
  /**
   * A mentor line introducing this block, shown once while it is current.
   *
   * For a block that follows a conversational exchange — most usefully a
   * `quiz_checkpoint` arriving after teach blocks — the quiz otherwise just
   * materializes under the mentor's last reply. This is the authored way to
   * say so ("Now a couple of quick questions") rather than a fixed client
   * string, so a course can word its own transitions or supply none.
   *
   * Derived into the thread verbatim, the same way the teach_back prompt is:
   * authored content already has a home in the published lesson version, and
   * routing it through a model turn would return a paraphrase of it.
   */
  handoff: z.string().min(1).optional(),
  /**
   * B.2: opt this block into graded-assessment governance. Meaningful only
   * on `quiz_checkpoint` (`mode: "web_quiz"`) and `teach_back`
   * (`mode: "reteach_gate"`) — enforced by the package-level "assessment.mode
   * must match blockType" check, not by narrowing this to those two variants
   * structurally, since `blockBase` has no way to see its own `blockType`.
   */
  assessment: blockAssessmentOverrideSchema.optional(),
};

export const lessonBlockSchema = z.discriminatedUnion("blockType", [
  /**
   * "AI explains a concept + follow-up." Direct generalization of the old
   * conversationSegmentSchema. `role` is the pedagogical function, kept
   * language-neutral (see migration mapping below) — the display label for
   * each role is a prompt-layer concern, not a format concern.
   *   escenario -> scenario | explicación -> explanation | ejemplo -> example
   *   pregunta -> question  | profundización -> deepening
   */
  z.object({
    ...blockBase,
    blockType: z.literal("teach"),
    role: z.enum(["scenario", "explanation", "example", "question", "deepening"]),
    content: z.string().min(1),
    presentation: z.enum(["narrated", "rendered"]).default("narrated"),
    /**
     * This block invites the learner to type something, so its primary control
     * sends the tutor box's contents before advancing.
     *
     * ── NOT a teach_back ───────────────────────────────────────────────────
     * These two look interchangeable and are not. Reach for `teach_back` when
     * the answer is the point:
     *
     *   teach_back            graded against `dimensionKey`, runs two turns,
     *                         and gates block completion — the learner cannot
     *                         advance until the tutor has replied twice
     *   teach + expectsResponse
     *                         one shot, ungraded, and gates advancement on
     *                         *something* being typed rather than on what it
     *                         said. The tutor replies but never judges
     *
     * Use this for an invitation ("introduce yourself"), not for assessment.
     *
     * ── This blocks advancement ────────────────────────────────────────────
     * It used to be advisory: the player offered "Skip for now" and a learner
     * who typed nothing moved on. That put the control which abandoned the
     * interaction directly on the block card, where it was the most prominent
     * thing on screen and read as the way forward. The flag now means what its
     * name says. A block carrying it renders exactly one control, next to the
     * input, disabled until there is text to send.
     *
     * So do not set it on a block the learner should be able to pass without
     * answering. There is no skip, and the only way past a tutor that will not
     * respond is a fallback the player reveals after two failed sends.
     *
     * Advancing with text in the box sends it regardless of this flag — that is
     * a floor against silently discarding what someone typed.
     */
    expectsResponse: z.boolean().default(false),
  }),

  /**
   * "The AI making the user explain topics." Distinct from a `teach` question
   * segment: the AI evaluates the student's explanation against keyConcepts
   * rather than just prompting reflection, and can optionally feed a
   * dimension (e.g. comprehension) from how well the explanation lands.
   *
   * delivery: "inline" = current behavior (evaluate in main conversation).
   *           "gated_session" = drives a separate-chat gate before lesson progression.
   */
  z.object({
    ...blockBase,
    blockType: z.literal("teach_back"),
    prompt: z.string().min(1),
    evaluatesConcepts: z.array(z.string()).default([]),
    dimensionKey: key, // Required: specifies which dimension this teach_back assesses
    delivery: z.enum(["inline", "gated_session"]).default("inline"),
    passingOverride: passingSchema.partial().optional(), // per-block tweak of config.assessment.passing
  }),

  /** An inline quiz checkpoint, rendered and graded by the player with retry. */
  z.object({
    ...blockBase,
    blockType: z.literal("quiz_checkpoint"),
    title: z.string().optional(),
    questions: z.array(quizQuestionSchema).min(1),
  }),

  /** A sortable sequence graded by exact source-item permutation. */
  z.object({
    ...blockBase,
    blockType: z.literal("drag_order"),
    prompt: z.string().min(1),
    items: z.array(z.string().min(1)).min(2),
    correctOrder: z.array(z.number().int().nonnegative()).min(2),
  }).superRefine((block, ctx) => {
    const expected = Array.from({ length: block.items.length }, (_, index) => index);
    const actual = [...block.correctOrder].sort((a, b) => a - b);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
      ctx.addIssue({
        code: "custom",
        message: "correctOrder must be a complete, duplicate-free permutation of item indices",
        path: ["correctOrder"],
      });
    }
  }),

  /**
   * Visual/interactive, non-graded content (image, diagram, embedded widget).
   * `kind` is intentionally loose until the interactive runtime is designed;
   * `config` is a free-form bag for that kind's parameters.
   */
  z.object({
    ...blockBase,
    blockType: z.literal("media"),
    kind: z.string(), // e.g. "image", "diagram", "embedded_widget"
    config: z.record(z.string(), z.any()).default({}),
    caption: z.string().optional(),
  }),

  /** A reference the AI can point to: link, textbook citation, or MCP connector. */
  z.object({
    ...blockBase,
    blockType: z.literal("resource"),
    resource: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("weblink"),
        url: z.string().url(),
        label: z.string().min(1),
        description: z.string().optional(),
      }),
      z.object({
        type: z.literal("textbook_reference"),
        title: z.string().optional(),
        isbn: z.string().optional(),
        chapter: z.string().optional(),
        page: z.string().optional(),
        callout: z.string().optional(),
      }),
      z.object({
        type: z.literal("mcp_connector"),
        connector: z.string().min(1), // e.g. "web_search", "wikipedia"
        context: z.string().optional(), // when/why the AI should reach for it
      }),
    ]),
  }),

  /**
   * E.3: an authored brief for external/applied work — "go do this, come back
   * and continue." Conversational, no container, no grading: the brief renders
   * in-thread and the block completes on the learner's next chat-input
   * submission (or immediately, for a brief with nothing to submit).
   *
   * requiresSubmission: whether the learner must type something before this
   *   block completes (mirrors `teach.expectsResponse`'s gate, but ungraded).
   * blocking: whether that submission holds up lesson progression. Today this
   *   is mechanically always true when requiresSubmission is true (there is no
   *   other progression gate yet) — enforced below so the two flags can't
   *   diverge in a way nothing implements. The field is kept distinct from
   *   requiresSubmission anyway, for a real future case: a block that
   *   collects and stores a submission (to show back to the learner later)
   *   without holding up the lesson while it waits — e.g. "tell us what you
   *   did, we'll read it, but don't stop here."
   *
   * That future case (`requiresSubmission: true, blocking: false`) is
   * rejected below, not merely undocumented. The player currently sends a
   * required submission through the same shared-textarea chat path
   * `teach.expectsResponse` uses — the text lands in chat history, and
   * `BlockProgress.response` stores only `{acknowledged: true}`, not the
   * learner's text. So "stores it, shows it back later" is not actually
   * implemented yet; authoring this combination today would silently produce
   * a block that requires a submission nothing ever retrieves. Same
   * schema-gate-shut move Track E has used before (B.2 gated `reteach_gate`
   * shut on the player surface until E.1 shipped its write path, then E.4
   * removed that check): fail closed with a clear reason instead of shipping
   * a half-finished feature that looks authorable. Remove this check once
   * the submission is actually persisted somewhere retrievable.
   */
  z.object({
    ...blockBase,
    blockType: z.literal("project"),
    content: z.string().min(1),
    requiresSubmission: z.boolean().default(false),
    blocking: z.boolean().optional(),
  }).superRefine((block, ctx) => {
    if (block.blocking === true && block.requiresSubmission === false) {
      ctx.addIssue({
        code: "custom",
        message: "a project block cannot set blocking: true while requiresSubmission is false — there is no submission to block on",
        path: ["blocking"],
      });
    }
    if (block.requiresSubmission === true && block.blocking === false) {
      ctx.addIssue({
        code: "custom",
        message: "a project block cannot set requiresSubmission: true with blocking: false yet — the player does not persist a non-blocking submission anywhere retrievable, so this would silently collect nothing. Not supported until that storage ships.",
        path: ["blocking"],
      });
    }
  }),

  /**
   * E.3.5: a sequential, in-thread question flow ("what's your name," "what
   * job are you aiming for," ...), collected one answer per learner
   * submission and stored as JSON on `BlockProgress.response`, keyed by each
   * step's `field`. Deliberately separate from `config.onboarding.mode:
   * "survey"` — that mechanism has a chat-surface-only implementation
   * (`lib/onboarding/service.ts`) and is not touched by this block type. This
   * is player-surface-only, self-contained, and does not read or write
   * `config.onboarding` at all.
   *
   * Not wired to the AI prompt layer this stage — a later block's AI turn
   * cannot yet reference an earlier answer collected here. That is tracked
   * as separate, non-blocking scope (same class of gap as `project`'s
   * reserved-but-gated case).
   *
   * `steps[].prompt` is a plain string, not `localizedStringSchema` —
   * matching `teach.content`/`project.content`/`teach_back.prompt`'s
   * existing convention. Every block's in-thread content today is sent to
   * the client unresolved as part of the lesson DTO; `localizedStringSchema`
   * only appears on fields resolved server-side before the client ever sees
   * them (e.g. `metadata.introMessage`). `closingMessage` is the exception on
   * this same block: it stays `localizedStringSchema` because it is resolved
   * server-side too (`resolveOnboardingClosingMessage` in `player/service.ts`)
   * and only ever reaches the client as an already-resolved plain string,
   * inside `PlayerFeedback`.
   */
  z.object({
    ...blockBase,
    blockType: z.literal("onboarding_survey"),
    steps: z.array(z.object({ id: key, prompt: z.string().min(1), field: z.string().min(1) })).min(1),
    /** Rendered after the last step completes. `{step:<id>}` tokens are substituted with that step's stored answer. */
    closingMessage: localizedStringSchema.optional(),
  }),
]);

/**
 * E.3: `blocking` has no static schema default because it depends on a
 * sibling field's parsed value, which zod's `.default()` cannot read. Every
 * caller that needs the effective blocking behavior resolves it through this
 * function instead of reading `block.blocking` directly — same pattern as
 * `normalizeMilestoneAvailability` resolving a computed value post-parse.
 */
export function resolveProjectBlocking(block: { requiresSubmission: boolean; blocking?: boolean }): boolean {
  return block.blocking ?? block.requiresSubmission;
}

// ── Lesson ───────────────────────────────────────────────────────────────────

export const lessonSchema = z.object({
  key, // stable id; replaces the integer `lessonNumber`. Order = array order.
  title: z.string().min(1),
  category: z.string().optional(),
  keyConcepts: z.array(z.string()).default([]),
  /** Preserved as a distinct field so the current reteach block keeps working. */
  selfCheckQuestions: z.array(z.string()).default([]),
  /** The drag-and-drop timeline. Must contain at least one `teach` block. */
  blocks: z.array(lessonBlockSchema).min(1),
  exercise: z.string().optional(), // MI-specific framing -> optional for other courses
  commitment: z.string().optional(),
  provenance: provenanceSchema.optional(),
})
  .refine((l) => l.blocks.some((b) => b.blockType === "teach"), {
    message: "every lesson needs at least one 'teach' block",
    path: ["blocks"],
  });

// ── Tracked dimensions (config) ──────────────────────────────────────────────

/**
 * The per-course signals the AI senses and the rules act on. `category`
 * determines AI autonomy posture. Maps onto MetricDefinition / MetricObservation.
 * The ~5 primary-dimension soft cap is a VALIDATOR concern (it warns, it does
 * not block) and so is deliberately not enforced here.
 */
export const trackedDimensionSchema = z
  .object({
    key,
    label: z.string().min(1),
    category: z.enum(["comprehension", "emotional", "behavioral", "metric"]),
    primary: z.boolean().default(true),
    scale: z.object({ min: z.number(), max: z.number() }).default({ min: 0, max: 10 }),
    calibrationMode: z.enum(["survey", "zero_start", "assumed_baseline"]),
    assumedBaseline: z.number().optional(),
  })
  .refine(
    (d) => (d.calibrationMode === "assumed_baseline") === (d.assumedBaseline !== undefined),
    {
      message: "assumedBaseline must be set iff calibrationMode is 'assumed_baseline'",
      path: ["assumedBaseline"],
    },
  );

// ── Dashboard panels: what a mentor sees for a participant on this course ────
//
// Panels are configuration, not code. The data each one renders already flows
// through the metric pipeline, so a course declares which slices matter to it
// rather than the dashboard hardcoding one course's assumptions. A course with
// no revenue simply never declares `financial_snapshots`.
//
// Mentor tooling that is not course-specific (AI sliders, alert flags) is not
// a panel — it renders for every course.
//
// NAME COLLISION, not the same system: this is the MENTOR-facing dashboard
// (src/app/dashboard/learners/[id]), config-driven panels read by mentors
// about one participant. The LEARNER-facing lesson-sidebar dashboard
// (PlayerDashboard.tsx / lib/player/dashboard.ts's `LessonDashboard`) is a
// completely separate, code-driven system with no relationship to this
// schema — it was investigated and ruled out as a home for player-surface
// course progress precisely because of this same name. If you're building a
// learner-facing panel, this is very likely not where it belongs.

export const dashboardPanelSchema = z.discriminatedUnion("type", [
  /** Trend of one tracked dimension, read from that dimension's observations. */
  z.object({
    type: z.literal("dimension_trend"),
    dimensionKey: key,
    title: localizedStringSchema.optional(),
  }),
  /** Per-lesson gate results: score, pass state, attempts. */
  z.object({
    type: z.literal("assessment_scores"),
    title: localizedStringSchema.optional(),
  }),
  /** Lesson-by-lesson completion and understanding. */
  z.object({
    type: z.literal("lesson_progress"),
    title: localizedStringSchema.optional(),
  }),
  /** AI-generated weekly rollups. */
  z.object({
    type: z.literal("weekly_summary"),
    title: localizedStringSchema.optional(),
  }),
  /** Revenue / net profit over time. Requires a course that collects them. */
  z.object({
    type: z.literal("financial_snapshots"),
    title: localizedStringSchema.optional(),
  }),
]);
export type DashboardPanel = z.infer<typeof dashboardPanelSchema>;
export type DashboardPanelType = DashboardPanel["type"];

export const dashboardSchema = z.object({
  /**
   * Panels to render, in order. **Array order is render order** — the first
   * entry appears at the top of the dashboard's panel column. Reordering this
   * array is how an author reorders the dashboard.
   */
  panels: z.array(dashboardPanelSchema).default([]),
});
export type DashboardConfig = z.infer<typeof dashboardSchema>;

const alertRuleSchema = z.object({
  id: key,
  dimensionKey: key,
  operator: z.enum(["lt", "lte", "gt", "gte", "eq"]),
  threshold: z.number(),
  severity: z.enum(["low", "medium", "high"]),
  cooldownHours: z.number().nonnegative().default(24),
});

/** Baseline content is authored in the cartridge and graded only on the server. */
export const baselineDiagnosticSchema = z.object({
  id: key,
  title: z.string().min(1),
  description: z.string().optional(),
  threshold: z.number().min(0).max(1),
  questions: z.array(quizQuestionSchema).min(1),
  /**
   * E.5.1: whether the learner sees their diagnostic score/per-question
   * correctness. Defaults `true` — the diagnostic has shipped with scores
   * unconditionally visible since before this field existed (confirmed
   * live in `content/ai-essentials.package.json` and
   * `content/ai-essentials-1.1.2.package.json`, both `mode: "baseline_quiz"`
   * with a populated diagnostic) — defaulting to `false` would silently
   * hide scores an existing course currently shows. A course that wants the
   * diagnostic treated as a private baseline (not a judgment) sets this to
   * `false` explicitly, same opt-in shape as `config.assessment`'s sibling
   * `showScoreToLearner` field.
   *
   * `.optional().default(true)`, in that order — `.default(x).optional()`
   * types the parsed output as `boolean | undefined` even though the
   * runtime value is always a real boolean; the same ordering bug B.2
   * Stage 2 caught for `config.assessment.showScoreToLearner`.
   *
   * Gated at the `submitDiagnostic` return boundary, not baked into
   * `DiagnosticAttempt` — that table's `overallScore`/`dimensionScores`
   * have exactly one other reader anywhere in the codebase
   * (`learnerHome.ts`'s attempt `.count()`, which never touches the score
   * fields), so there is no second read layer to protect the way
   * `resolveReteachGateSignal`'s gated value later gets baked into
   * `BlockProgress.score`. The stored row stays real; only what
   * `submitDiagnostic` returns to the learner is gated.
   */
  showScoreToLearner: z.boolean().optional().default(true),
});

const projectSelectionDimensionSchema = z.enum([
  "ai_impact_adaptation",
  "how_ai_works",
  "working_with_ai",
  "model_choice",
  "tools_and_safety",
]);

const projectPresetSchema = z.object({
  key,
  family: z.enum(["routine", "messy-input", "handoff"]),
  label: z.string().min(1),
  defaultLevel: z.enum(["L1", "L2", "L3"]),
  exampleContexts: z.array(z.string().min(1)).min(1),
});

const projectInterestTopicSchema = z.object({
  key,
  label: z.string().min(1),
  dimensions: z.array(projectSelectionDimensionSchema).min(1),
  presetAffinity: z.array(key).min(1),
});

/** Authored proposal inputs. `family` is a conversation-only diversity hint. */
export const projectSelectionSchema = z.object({
  presets: z.array(projectPresetSchema).min(1),
  interestTopics: z.array(projectInterestTopicSchema).min(1),
}).superRefine((selection, ctx) => {
  const presetKeys = selection.presets.map((preset) => preset.key);
  const interestKeys = selection.interestTopics.map((interest) => interest.key);
  if (new Set(presetKeys).size !== presetKeys.length) {
    ctx.addIssue({ code: "custom", message: "projectSelection preset keys must be unique", path: ["presets"] });
  }
  if (new Set(interestKeys).size !== interestKeys.length) {
    ctx.addIssue({ code: "custom", message: "projectSelection interest topic keys must be unique", path: ["interestTopics"] });
  }
  const declaredPresets = new Set(presetKeys);
  const affinityCounts = new Map(presetKeys.map((presetKey) => [presetKey, 0]));
  selection.interestTopics.forEach((interest, interestIndex) => {
    if (new Set(interest.dimensions).size !== interest.dimensions.length) {
      ctx.addIssue({ code: "custom", message: `projectSelection interest "${interest.key}" has duplicate dimensions`, path: ["interestTopics", interestIndex, "dimensions"] });
    }
    if (new Set(interest.presetAffinity).size !== interest.presetAffinity.length) {
      ctx.addIssue({ code: "custom", message: `projectSelection interest "${interest.key}" has duplicate preset affinities`, path: ["interestTopics", interestIndex, "presetAffinity"] });
    }
    interest.presetAffinity.forEach((presetKey) => {
      if (!declaredPresets.has(presetKey)) {
        ctx.addIssue({ code: "custom", message: `projectSelection interest "${interest.key}" references unknown preset "${presetKey}"`, path: ["interestTopics", interestIndex, "presetAffinity"] });
      } else {
        affinityCounts.set(presetKey, (affinityCounts.get(presetKey) ?? 0) + 1);
      }
    });
  });
  affinityCounts.forEach((count, presetKey) => {
    if (count < 2) {
      ctx.addIssue({ code: "custom", message: `projectSelection preset "${presetKey}" requires affinity from at least two interests`, path: ["presets"] });
    }
  });
});
export type ProjectSelectionConfig = z.infer<typeof projectSelectionSchema>;

/**
 * "Request help from a human" on the delivery surface.
 *
 * Opt-in, and deliberately so. A course that turns this on is promising a
 * learner that a person will follow up, and that promise is only keepable where
 * somebody is actually reading `/dashboard/alerts` for this organization.
 * Absent config means the button does not render and the endpoint refuses —
 * which is the correct default for a course that has not made that promise.
 */
export const helpRequestSchema = z.object({
  enabled: z.boolean(),
  /**
   * Cap on the learner's optional free text. Generous: someone asking for help
   * should not be fighting a counter, and the value is stored in a Json column
   * with no width limit. The cap exists to bound the request body, not to
   * discipline the learner.
   */
  maxMessageLength: z.number().int().positive().max(4_000).default(1_000),
});

export type HelpRequestConfig = z.infer<typeof helpRequestSchema>;

/**
 * The lesson player's right-rail progress sidebar (lesson completion, the
 * whole-course lesson list, and — when the course also declares `outcome`
 * — the milestone list and capstone link). Opt-in, deliberately: this panel
 * used to piggyback on `projectSelection` (a genuinely unrelated feature,
 * the AI-guided project-selection conversation) as its gate, which meant no
 * course could ever get lesson-progress visibility without also taking on
 * project selection's mandatory pre-course conversation and 403 gate. Now
 * decoupled, but PB&J and skills-tool-calls are live courses that have never
 * shown this panel — defaulting it on for them would be a production
 * behavior and layout change (single-column to two-column) nobody asked for
 * on those courses. Absent config means no panel, matching today's look for
 * every course that doesn't explicitly turn it on.
 */
export const progressPanelSchema = z.object({
  enabled: z.boolean(),
});

export type ProgressPanelConfig = z.infer<typeof progressPanelSchema>;

// ── Config (-> ProgramVersion.config) ────────────────────────────────────────

export const configSchema = z.object({
  /** Overrides org-level defaults; omit a key to inherit. e.g. participantSingular. */
  terminology: z.record(z.string(), z.string()).optional(),
  aiBehavior: z
    .object({
      tone: z.string(),
      teachingStyle: z.string(),
      languageInstruction: z.string(),
    })
    .partial()
    .optional(),
  /** Learner-visible generation limits. Omission preserves legacy behavior. */
  responseStyle: responseStyleSchema.optional(),
  /** Optional authored inputs for per-enrollment learner project selection. */
  projectSelection: projectSelectionSchema.optional(),
  /** Learner-initiated "request help from a human". Omission leaves it off. */
  helpRequest: helpRequestSchema.optional(),
  /** Lesson-sidebar progress panel. Omission leaves it off — see progressPanelSchema's doc. */
  progressPanel: progressPanelSchema.optional(),
  onboarding: z
    .object({
      mode: z.enum(["survey", "baseline_quiz", "skip"]),
      steps: z
        .array(z.object({ id: key, promptKey: z.string(), field: z.string() }))
        .default([]),
      diagnostic: baselineDiagnosticSchema.optional(),
    })
    .optional(),
  trackedDimensions: z.array(trackedDimensionSchema).default([]),
  alertRules: z.array(alertRuleSchema).default([]),
  graduation: z
    .object({
      requiredLessonKeys: z.array(key).default([]),
      requiredDimensionKeys: z.array(key).default([]),
    })
    .optional(),
  /**
   * Assessment configuration for gated teach-back sessions.
   * Optional: packages without gated assessments don't need this.
   */
  assessment: z
    .object({
      passing: passingSchema,
      /** What the STUDENT sees. Default: just the gating dimension (their understanding score). */
      studentVisibleDimensionKeys: z.array(key).optional(),
      /** What becomes MetricObservations for mentor/flywheel. Default: all tracked dimensions. */
      recordedDimensionKeys: z.array(key).optional(),
      onMaxTurnsWithoutPass: z
        .enum(["complete_with_scores", "return_for_reteach", "flag_mentor"])
        .default("complete_with_scores"),
      allowRetake: z.boolean().default(true),
      blocking: z.boolean().default(true), // gate lesson progression while open
      autoAppendTeachBack: z.boolean().default(false), // synthesize a gated teach_back per lesson (importer, Phase C)
      /**
       * B.2 (investigation report §5 item 14): whether the learner sees their
       * raw assessment score. Distinct from `studentVisibleDimensionKeys`,
       * which is a finer-grained allowlist of which *dimension scores* surface
       * mid-session/at completion — this is a coarser, unrelated boolean
       * show/hide toggle. Default `false` preserves current behavior (no raw
       * score shown to the learner today).
       *
       * A package-level default only — a block can override it via its own
       * `assessment.showScoreToLearner` (see `blockAssessmentOverrideSchema`).
       * `mode` (reteach_gate/web_quiz) deliberately does NOT live here: it is
       * per-block (a course authors reteach-style gating in one lesson and a
       * plain graded checkpoint in another), not a one-per-course switch. See
       * `blockAssessmentOverrideSchema` and the "assessment.mode must match
       * blockType" package-level check below.
       *
       * `.optional().default(false)`, in that order: `.default(x).optional()`
       * types the output as `boolean | undefined` even though the parsed
       * value is always a real boolean at runtime — a real bug caught while
       * building B.2 Stage 2's merge helper (TS rejected the merged return
       * type). Order matters for zod's *inferred* output type here, not just
       * style.
       */
      showScoreToLearner: z.boolean().optional().default(false),
      /** Package default for web quizzes; block assessment may override it. */
      webQuizPassingScore: z.number().min(0).max(1).optional().default(1),
      /**
       * Package default for web_quiz's attempt cap; block assessment may
       * override it. See blockAssessmentOverrideSchema's webQuizMaxAttempts
       * doc for why 2 — it matches the plain quiz_checkpoint path's existing
       * QUIZ_ATTEMPT_LIMIT precedent, not an arbitrary choice.
       */
      webQuizMaxAttempts: z.number().int().positive().optional().default(2),
    })
    .optional(),
  /**
   * Which panels the mentor dashboard renders for this course, in order.
   * Optional: absent config falls back to a course-agnostic default
   * (see DEFAULT_DASHBOARD_PANELS) — never another course's panels.
   */
  dashboard: dashboardSchema.optional(),
});

// ── Outcome: the completable project (-> Program outcome) ─────────────────────

export const outcomeSchema = z.object({
  project: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    deliverables: z
      .array(z.object({ name: z.string(), description: z.string().optional() }))
      .default([]),
  }),
  milestones: z.array(milestoneSchema).default([]),
  mentorResources: z
    .array(
      z.object({
        milestoneKey: key,
        trigger: z.enum(["on_reach", "when_behind"]).default("on_reach"),
        body: z.string(),
        mentorPrompt: z.string().optional(),
      }),
    )
    .default([]),
}).superRefine((outcome, ctx) => {
  const seen = new Set<string>();
  for (const milestone of outcome.milestones) {
    if (seen.has(milestone.key)) ctx.addIssue({ code: "custom", message: `duplicate milestone key "${milestone.key}"` });
    const availability = normalizeMilestoneAvailability(milestone);
    if (availability.availability.type === "after_milestone" && !seen.has(availability.availability.milestoneKey)) {
      ctx.addIssue({ code: "custom", message: `milestone "${milestone.key}" must reference an earlier milestone, not "${availability.availability.milestoneKey}"` });
    }
    seen.add(milestone.key);
  }
});

// ── Identity & Terminology (Phase A' additions) ──────────────────────────────

/**
 * AI persona identity for this course.
 * mentorName: what the AI calls itself (default: 'Tutor')
 * displayName: org/course label in header (optional, falls back to course title)
 */
export const identitySchema = z.object({
  mentorName: z.string().default('Tutor'),
  displayName: z.string().optional(),
});
export type Identity = z.infer<typeof identitySchema>;

/**
 * Course-specific terminology. All fields are LocalizedString.
 * participant: what to call the learner (default: {en:'participant'})
 */
export const terminologySchema = z.object({
  participant: localizedStringSchema.default({ en: 'participant' }),
});
export type Terminology = z.infer<typeof terminologySchema>;

/**
 * Learner context configuration for personalization.
 * OPTIONAL: if absent, no learner-specific context is collected or used.
 */
export const learnerContextFieldSchema = z.object({
  key: z.string().min(1),
  extractionHint: z.string().optional(),
});

export const learnerContextSchema = z.object({
  label: localizedStringSchema,
  intakeQuestion: localizedStringSchema,
  personalizationInstruction: localizedStringSchema,
  fields: z.array(learnerContextFieldSchema).default([]),
});
export type LearnerContext = z.infer<typeof learnerContextSchema>;

/**
 * Onboarding flow configuration.
 * welcome: optional greeting message
 * steps: ordered list of onboarding steps (field intake)
 */
export const onboardingStepSchema = z.object({
  id: key,
  field: z.string().min(1),
  prompt: localizedStringSchema,
  required: z.boolean().default(false),
});

export const onboardingConfigSchema = z.object({
  welcome: localizedStringSchema.optional(),
  steps: z.array(onboardingStepSchema).default([]),
});
export type OnboardingConfig = z.infer<typeof onboardingConfigSchema>;

/**
 * Scheduled check-in configuration.
 * cadence: how often (daily, weekly, biweekly, monthly)
 * captureMarker: optional marker to extract from AI response
 */
export const scheduledCheckinSchema = z.object({
  id: key,
  cadence: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
  prompt: localizedStringSchema,
  captureMarker: z.string().optional(),
  enabled: z.boolean().default(false),
});
export type ScheduledCheckin = z.infer<typeof scheduledCheckinSchema>;

// ── Metadata ─────────────────────────────────────────────────────────────────

export const metadataSchema = z.object({
  packageId: key,
  title: z.string().min(1),
  description: z.string().optional(),
  /** BCP-47 tags. languages[0] is primary; all package strings are in it. */
  languages: z.array(z.string()).min(1),
  version: z.string().min(1), // content version, author-managed (e.g. "2025.1")
  author: z
    .object({ name: z.string().optional(), organizationKey: key.optional() })
    .optional(),
  // Phase A' additions - all optional for backward compatibility
  identity: identitySchema.optional(),
  terminology: terminologySchema.optional(),
  learnerContext: learnerContextSchema.optional(),
  onboarding: onboardingConfigSchema.optional(),
  scheduledCheckins: z.array(scheduledCheckinSchema).optional(),
  delivery: z
    .object({
      surface: z.enum(["chat", "player"]),
      supportedChannels: z.array(z.enum(["whatsapp", "web", "canvas"])).min(1),
    })
    .optional(),
  /**
   * D4: whether this course appears in a course-listing UI. Optional here
   * (validated packages may omit it) because the runtime default lives in
   * `resolveListed()` (`journey-package/listed.ts`), the same
   * present-but-untrusted-JSON pattern `resolveDelivery` uses for `delivery`
   * — not a Prisma column, matching how `delivery` itself is stored on
   * ProgramVersion.metadata rather than the ContentCollection row.
   */
  listed: z.boolean().optional(),
  /**
   * B.1 (Phase B, single-thread consolidation): the authored opening message
   * for the course, shown once as the thread's first `kind: "prompt"` item on
   * the learner's first lesson — derived, verbatim, never a model turn. Same
   * shape of problem `listed`/`delivery` solve: lives on `ProgramVersion.metadata`
   * (untrusted, partially-present JSON that predates this field on most rows),
   * so the runtime default (no intro message) lives in the resolver
   * (`resolveIntroMessage`, `journey-package/introMessage.ts`), not here.
   */
  introMessage: localizedStringSchema.optional(),
});

// ── Top-level package + cross-reference validation ───────────────────────────

export const journeyPackageSchema = z
  .object({
    schemaVersion: z.enum([LEGACY_SCHEMA_VERSION, V11_SCHEMA_VERSION, SCHEMA_VERSION]),
    metadata: metadataSchema,
    config: configSchema,
    curriculum: z.object({
      collectionKey: key,
      lessons: z.array(lessonSchema).min(1), // order = array order
    }),
    outcome: outcomeSchema.optional(),
  })
  .superRefine((pkg, ctx) => {
    if (pkg.curriculum.collectionKey === "ai-essentials" && pkg.schemaVersion === LEGACY_SCHEMA_VERSION) {
      ctx.addIssue({
        code: "custom",
        message: `AI Essentials requires cartridge schema ${V11_SCHEMA_VERSION} or newer`,
        path: ["schemaVersion"],
      });
    }

    if (pkg.schemaVersion === LEGACY_SCHEMA_VERSION) {
      if (pkg.metadata.delivery || pkg.config.onboarding?.diagnostic) {
        ctx.addIssue({
          code: "custom",
          message: `delivery metadata and baseline diagnostics require cartridge schema ${SCHEMA_VERSION}`,
          path: ["schemaVersion"],
        });
      }
      for (const lesson of pkg.curriculum.lessons) {
        if (lesson.blocks.some((block) => block.blockType === "drag_order")) {
          ctx.addIssue({
            code: "custom",
            message: `drag_order blocks require cartridge schema ${SCHEMA_VERSION}`,
            path: ["schemaVersion"],
          });
        }
      }
    }

    const lessonKeys = new Set<string>();
    const blockIds = new Set<string>();
    for (const l of pkg.curriculum.lessons) {
      if (lessonKeys.has(l.key)) {
        ctx.addIssue({ code: "custom", message: `duplicate lesson key "${l.key}"` });
      }
      lessonKeys.add(l.key);
      for (const b of l.blocks) {
        if (blockIds.has(b.id)) {
          ctx.addIssue({
            code: "custom",
            message: `duplicate block id "${b.id}" (lesson "${l.key}") — block ids must be unique package-wide`,
          });
        }
        blockIds.add(b.id);
      }
    }

    const dimKeys = new Set(pkg.config.trackedDimensions.map((d) => d.key));

    // dimensionKey references live inside blocks now (teach_back, quiz_checkpoint
    // questions), not in a removed top-level assessments array.
    for (const l of pkg.curriculum.lessons) {
      for (const b of l.blocks) {
        if (b.blockType === "teach_back" && b.dimensionKey && !dimKeys.has(b.dimensionKey)) {
          ctx.addIssue({
            code: "custom",
            message: `teach_back block "${b.id}" (lesson "${l.key}") references unknown dimension "${b.dimensionKey}"`,
          });
        }
        if (b.blockType === "quiz_checkpoint") {
          for (const q of b.questions) {
            // An explanation explains why an answer was right. An ungraded
            // question has no right answer, so requiring one would force the
            // author to invent the very thing `graded: false` says is absent.
            if (q.graded && pkg.schemaVersion !== LEGACY_SCHEMA_VERSION && !q.explanation) {
              ctx.addIssue({
                code: "custom",
                message: `quiz question "${q.id}" requires an explanation in schema ${SCHEMA_VERSION}`,
              });
            }
            if (q.dimensionKey && !dimKeys.has(q.dimensionKey)) {
              ctx.addIssue({
                code: "custom",
                message: `quiz question "${q.id}" (block "${b.id}", lesson "${l.key}") references unknown dimension "${q.dimensionKey}"`,
              });
            }
          }
        }
        if (b.blockType === "onboarding_survey") {
          const stepIds = b.steps.map((s) => s.id);
          if (new Set(stepIds).size !== stepIds.length) {
            ctx.addIssue({
              code: "custom",
              message: `onboarding_survey block "${b.id}" (lesson "${l.key}") has duplicate step ids`,
              path: ["steps"],
            });
          }
          const stepFields = b.steps.map((s) => s.field);
          // Each step's field becomes a JSON key on BlockProgress.response — a
          // collision would silently overwrite one step's stored answer with
          // another's.
          if (new Set(stepFields).size !== stepFields.length) {
            ctx.addIssue({
              code: "custom",
              message: `onboarding_survey block "${b.id}" (lesson "${l.key}") has duplicate step fields — each step's field must be unique since it keys the stored response`,
              path: ["steps"],
            });
          }
        }
      }
    }

    const diagnostic = pkg.config.onboarding?.diagnostic;
    if (pkg.config.onboarding?.mode === "baseline_quiz" && !diagnostic) {
      ctx.addIssue({
        code: "custom",
        message: "baseline_quiz onboarding requires diagnostic content",
        path: ["config", "onboarding", "diagnostic"],
      });
    }
    if (diagnostic) {
      for (const question of diagnostic.questions) {
        if (question.format !== "multiple_choice") {
          ctx.addIssue({
            code: "custom",
            message: `diagnostic question "${question.id}" must be multiple_choice`,
          });
        }
        // A diagnostic scores dimensions against a threshold, so an ungraded
        // question in one is meaningless. Stated here rather than left implicit
        // because `graded` lives on the shared question schema.
        if (!question.graded) {
          ctx.addIssue({
            code: "custom",
            message: `diagnostic question "${question.id}" must be graded`,
          });
        }
        if (!question.explanation) {
          ctx.addIssue({
            code: "custom",
            message: `diagnostic question "${question.id}" requires an explanation`,
          });
        }
        if (!question.dimensionKey || !dimKeys.has(question.dimensionKey)) {
          ctx.addIssue({
            code: "custom",
            message: `diagnostic question "${question.id}" references an unknown dimension`,
          });
        }
      }
    }

    for (const rule of pkg.config.alertRules) {
      if (!dimKeys.has(rule.dimensionKey)) {
        ctx.addIssue({
          code: "custom",
          message: `alertRule "${rule.id}" references unknown dimension "${rule.dimensionKey}"`,
        });
      }
    }

    for (const lk of pkg.config.graduation?.requiredLessonKeys ?? []) {
      if (!lessonKeys.has(lk)) {
        ctx.addIssue({
          code: "custom",
          message: `graduation requires unknown lesson "${lk}"`,
        });
      }
    }
    for (const dk of pkg.config.graduation?.requiredDimensionKeys ?? []) {
      if (!dimKeys.has(dk)) {
        ctx.addIssue({
          code: "custom",
          message: `graduation requires unknown dimension "${dk}"`,
        });
      }
    }

    // ── Dashboard panel validation ────────────────────────────────────────────
    const seenPanelTypes = new Set<string>();
    pkg.config.dashboard?.panels.forEach((panel, i) => {
      if (panel.type === "dimension_trend") {
        if (!dimKeys.has(panel.dimensionKey)) {
          ctx.addIssue({
            code: "custom",
            message: `dashboard.panels[${i}] charts unknown dimension "${panel.dimensionKey}" — add it to trackedDimensions`,
          });
        }
        // Two trends of the same dimension would render identical panels.
        const trendKey = `dimension_trend:${panel.dimensionKey}`;
        if (seenPanelTypes.has(trendKey)) {
          ctx.addIssue({
            code: "custom",
            message: `dashboard.panels[${i}] duplicates an earlier trend for dimension "${panel.dimensionKey}"`,
          });
        }
        seenPanelTypes.add(trendKey);
        return;
      }
      // The singleton panels each render one fixed data source.
      if (seenPanelTypes.has(panel.type)) {
        ctx.addIssue({
          code: "custom",
          message: `dashboard.panels[${i}] duplicates an earlier "${panel.type}" panel`,
        });
      }
      seenPanelTypes.add(panel.type);
    });

    // ── Assessment config validation ──────────────────────────────────────────
    if (pkg.config.assessment) {
      const { passing, studentVisibleDimensionKeys, recordedDimensionKeys } = pkg.config.assessment;

      // passing.dimensionKey must exist in trackedDimensions
      if (!dimKeys.has(passing.dimensionKey)) {
        ctx.addIssue({
          code: "custom",
          message: `assessment.passing.dimensionKey "${passing.dimensionKey}" not found in trackedDimensions`,
        });
      }

      // studentVisibleDimensionKeys must all exist
      for (const dk of studentVisibleDimensionKeys ?? []) {
        if (!dimKeys.has(dk)) {
          ctx.addIssue({
            code: "custom",
            message: `assessment.studentVisibleDimensionKeys contains unknown dimension "${dk}"`,
          });
        }
      }

      // recordedDimensionKeys must all exist
      for (const dk of recordedDimensionKeys ?? []) {
        if (!dimKeys.has(dk)) {
          ctx.addIssue({
            code: "custom",
            message: `assessment.recordedDimensionKeys contains unknown dimension "${dk}"`,
          });
        }
      }
    }

    // ── Gated teach_back validation ───────────────────────────────────────────
    for (const l of pkg.curriculum.lessons) {
      for (const b of l.blocks) {
        if (b.blockType === "teach_back" && b.delivery === "gated_session") {
          // gated_session requires config.assessment to be present
          if (!pkg.config.assessment) {
            ctx.addIssue({
              code: "custom",
              message: `teach_back block "${b.id}" (lesson "${l.key}") has delivery="gated_session" but config.assessment is missing`,
            });
          }

          // passingOverride.dimensionKey must exist if specified
          if (b.passingOverride?.dimensionKey && !dimKeys.has(b.passingOverride.dimensionKey)) {
            ctx.addIssue({
              code: "custom",
              message: `teach_back block "${b.id}" (lesson "${l.key}") passingOverride.dimensionKey "${b.passingOverride.dimensionKey}" not found in trackedDimensions`,
            });
          }
        }
      }
    }

    // ── Block-level assessment override validation (B.2) ──────────────────────
    // `assessment.mode` is authoring, not free-form: "web_quiz" only means
    // something on a quiz_checkpoint (it already carries questions[]) and
    // "reteach_gate" only means something on a teach_back (it already carries
    // the tutor-conversation gate). This is what keeps `assessment` a
    // governance layer on existing content instead of a silently-ignored
    // field on the wrong block type.
    for (const l of pkg.curriculum.lessons) {
      for (const b of l.blocks) {
        if (b.blockType === "quiz_checkpoint") {
          const richQuestion = b.questions.find((question) => (
            question.format === "fill_in_blank"
            || question.format === "drag_to_order"
            || question.format === "matching"
          ));
          if (richQuestion && b.assessment?.mode !== "web_quiz") {
            ctx.addIssue({
              code: "custom",
              message: `quiz question "${richQuestion.id}" (block "${b.id}", lesson "${l.key}") uses rich format "${richQuestion.format}" but the block is not assessment.mode="web_quiz"`,
            });
          }
        }
        if (!b.assessment) continue;

        if (b.assessment.mode === "web_quiz" && b.blockType !== "quiz_checkpoint") {
          ctx.addIssue({
            code: "custom",
            message: `block "${b.id}" (lesson "${l.key}") has assessment.mode="web_quiz" but is a "${b.blockType}" block — web_quiz only applies to quiz_checkpoint`,
          });
        }
        if (b.assessment.mode === "reteach_gate" && b.blockType !== "teach_back") {
          ctx.addIssue({
            code: "custom",
            message: `block "${b.id}" (lesson "${l.key}") has assessment.mode="reteach_gate" but is a "${b.blockType}" block — reteach_gate only applies to teach_back`,
          });
        }

        // E.4: the B.2 Stage 2 gap this check used to guard against is closed.
        // E.1 shipped a player-surface write path for reteach_gate sessions
        // (resolveOrCreateReteachGateSession + BoundedAssessmentContainer /
        // ReteachGateExperience, wired into LessonPlayer.tsx's boundedMode ===
        // "reteach_gate" branch) — completeBlock now resolves these blocks via
        // AssessmentSession.passedAt on the player surface the same way it
        // already did on chat, confirmed in completeBlockReteachGate.test.ts
        // and boundedAssessmentContainer.test.ts. The rejection here is
        // removed; a player-surface course may now author assessment.mode =
        // "reteach_gate" on a teach_back block same as chat-surface courses
        // always could.

        // Overrides merge over config.assessment defaults, so the defaults must exist.
        if (!pkg.config.assessment) {
          ctx.addIssue({
            code: "custom",
            message: `block "${b.id}" (lesson "${l.key}") declares assessment.mode="${b.assessment.mode}" but config.assessment is missing — there is nothing for its overrides to merge over`,
          });
        }

        if (b.assessment.passingOverride?.dimensionKey && !dimKeys.has(b.assessment.passingOverride.dimensionKey)) {
          ctx.addIssue({
            code: "custom",
            message: `block "${b.id}" (lesson "${l.key}") assessment.passingOverride.dimensionKey "${b.assessment.passingOverride.dimensionKey}" not found in trackedDimensions`,
          });
        }
      }
    }

    if (pkg.outcome) {
      const milestoneKeys = new Set(pkg.outcome.milestones.map((m) => m.key));
      const seenMilestones = new Set<string>();
      for (const m of pkg.outcome.milestones) {
        if (seenMilestones.has(m.key)) {
          ctx.addIssue({ code: "custom", message: `duplicate milestone key "${m.key}"` });
        }
        if (pkg.schemaVersion === SCHEMA_VERSION && m.afterLessonKey) {
          ctx.addIssue({ code: "custom", message: `milestone "${m.key}" must use availability in schema ${SCHEMA_VERSION}` });
        }
        const availability = normalizeMilestoneAvailability(m);
        if (availability.availability.type === "after_lesson" && !lessonKeys.has(availability.availability.lessonKey)) {
          ctx.addIssue({
            code: "custom",
            message: `milestone "${m.key}" placed after unknown lesson "${availability.availability.lessonKey}"`,
          });
        }
        if (availability.availability.type === "after_milestone" && !seenMilestones.has(availability.availability.milestoneKey)) {
          ctx.addIssue({
            code: "custom",
            message: `milestone "${m.key}" must reference an earlier milestone, not "${availability.availability.milestoneKey}"`,
          });
        }
        seenMilestones.add(m.key);
      }
      for (const r of pkg.outcome.mentorResources) {
        if (!milestoneKeys.has(r.milestoneKey)) {
          ctx.addIssue({
            code: "custom",
            message: `mentorResource references unknown milestone "${r.milestoneKey}"`,
          });
        }
      }
    }
  });

// ── Inferred types (replace the hand-written LessonData interface) ───────────

export type JourneyPackage = z.infer<typeof journeyPackageSchema>;
/** Input type allows optional fields with defaults to be omitted */
export type JourneyPackageInput = z.input<typeof journeyPackageSchema>;
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;
export type PassingConfig = z.infer<typeof passingSchema>;
/** Author/input shapes keep defaulted fields optional for v1.0 callers. */
export type PackageLesson = z.input<typeof lessonSchema>;
export type LessonBlock = z.input<typeof lessonBlockSchema>;
/** Canonical parsed runtime shapes have all v1.1 defaults materialized. */
export type ParsedPackageLesson = z.infer<typeof lessonSchema>;
export type ParsedLessonBlock = z.infer<typeof lessonBlockSchema>;
export type TrackedDimension = z.infer<typeof trackedDimensionSchema>;
export type PackageConfig = z.infer<typeof configSchema>;
export type PackageOutcome = z.infer<typeof outcomeSchema>;
export type PackageMetadata = z.infer<typeof metadataSchema>;
