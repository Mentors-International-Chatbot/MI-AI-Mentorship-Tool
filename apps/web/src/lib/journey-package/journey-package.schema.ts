/**
 * Journey Package Schema — course cartridge format v1.0
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

export const SCHEMA_VERSION = "1.0" as const;

// ── Shared primitives ────────────────────────────────────────────────────────

/** Stable, human-readable identifier. Used for cross-references inside a package. */
const key = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "keys are lowercase, alphanumeric + hyphens");

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

const quizQuestionSchema = z
  .object({
    id: key,
    prompt: z.string().min(1),
    format: z.enum(["multiple_choice", "short_answer"]),
    options: z.array(z.string()).optional(),
    answerKey: z.union([z.string(), z.array(z.string())]).optional(),
    /** Ties this question to a tracked dimension for auto-assessment. */
    dimensionKey: key.optional(),
  })
  .refine(
    (q) => q.format !== "multiple_choice" || (q.options?.length ?? 0) >= 2,
    { message: "multiple_choice questions need at least 2 options", path: ["options"] },
  );

/** Discriminates each block variant. Shared by every entry in lessonBlockSchema. */
const blockBase = {
  id: key, // stable across reorders; referenced by dimensionKey ties, provenance, etc.
  order: z.number().int().positive(),
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
  }),

  /**
   * "The AI making the user explain topics." Distinct from a `teach` question
   * segment: the AI evaluates the student's explanation against keyConcepts
   * rather than just prompting reflection, and can optionally feed a
   * dimension (e.g. comprehension) from how well the explanation lands.
   */
  z.object({
    ...blockBase,
    blockType: z.literal("teach_back"),
    prompt: z.string().min(1),
    evaluatesConcepts: z.array(z.string()).default([]),
    dimensionKey: key.optional(),
  }),

  /**
   * An inline quiz checkpoint. RESERVED for V2 delivery — present now so
   * cartridges are forward-compatible and authors can place/order it today;
   * the V1 runtime does not grade or gate on it yet. The validator may warn
   * that a defined quiz_checkpoint won't run until V2, but placement and
   * ordering are still meaningful and preserved on import.
   */
  z.object({
    ...blockBase,
    blockType: z.literal("quiz_checkpoint"),
    title: z.string().optional(),
    questions: z.array(quizQuestionSchema).min(1),
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
]);

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

const alertRuleSchema = z.object({
  id: key,
  dimensionKey: key,
  operator: z.enum(["lt", "lte", "gt", "gte", "eq"]),
  threshold: z.number(),
  severity: z.enum(["low", "medium", "high"]),
  cooldownHours: z.number().nonnegative().default(24),
});

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
  onboarding: z
    .object({
      mode: z.enum(["survey", "baseline_quiz", "skip"]),
      steps: z
        .array(z.object({ id: key, promptKey: z.string(), field: z.string() }))
        .default([]),
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
  milestones: z
    .array(
      z.object({
        key,
        name: z.string().min(1),
        afterLessonKey: key,
        checkDescription: z.string().optional(),
      }),
    )
    .default([]),
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
});

// ── Top-level package + cross-reference validation ───────────────────────────

export const journeyPackageSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    metadata: metadataSchema,
    config: configSchema,
    curriculum: z.object({
      collectionKey: key,
      lessons: z.array(lessonSchema).min(1), // order = array order
    }),
    outcome: outcomeSchema.optional(),
  })
  .superRefine((pkg, ctx) => {
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
            if (q.dimensionKey && !dimKeys.has(q.dimensionKey)) {
              ctx.addIssue({
                code: "custom",
                message: `quiz question "${q.id}" (block "${b.id}", lesson "${l.key}") references unknown dimension "${q.dimensionKey}"`,
              });
            }
          }
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

    if (pkg.outcome) {
      const milestoneKeys = new Set(pkg.outcome.milestones.map((m) => m.key));
      for (const m of pkg.outcome.milestones) {
        if (!lessonKeys.has(m.afterLessonKey)) {
          ctx.addIssue({
            code: "custom",
            message: `milestone "${m.key}" placed after unknown lesson "${m.afterLessonKey}"`,
          });
        }
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
export type PackageLesson = z.infer<typeof lessonSchema>;
export type LessonBlock = z.infer<typeof lessonBlockSchema>;
export type TrackedDimension = z.infer<typeof trackedDimensionSchema>;
export type PackageConfig = z.infer<typeof configSchema>;
export type PackageOutcome = z.infer<typeof outcomeSchema>;
export type PackageMetadata = z.infer<typeof metadataSchema>;
