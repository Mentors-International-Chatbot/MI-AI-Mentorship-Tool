/**
 * ProgramVersion.config Schema — canonical validated shape
 * ═══════════════════════════════════════════════════════════════════════════
 * This is the single source of truth for what goes into ProgramVersion.config.
 * It combines:
 *   - Per-course fields from journey-package.schema.ts (configSchema)
 *   - Org-level fields (branding, notifications) that journey-package doesn't own
 *
 * On import from JourneyPackage:
 *   programVersionConfig = {
 *     ...journeyPackage.config,           // per-course fields
 *     branding: org.settings.branding,    // inherited from org (or overridden)
 *     notifications: org.settings.notifications,
 *   }
 *
 * Decision log:
 *   - "trackedDimensions" wins over "metrics" (confirmed)
 *   - "curriculum" is NOT in config — it's a separate top-level in JourneyPackage
 *     that decomposes into ContentCollection + ContentLesson + LessonVersion rows
 *   - "languages" lives in metadata; primaryLang copied to ProgramVersion column
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import {
  trackedDimensionSchema,
  passingSchema,
  dashboardSchema,
  configSchema as journeyPackageConfigSchema,
} from "./journey-package.schema";

// ═══════════════════════════════════════════════════════════════════════════
// Org-Level Fields (not provided by JourneyPackage — set at org/program level)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Branding — org-level visual identity.
 * JourneyPackage doesn't provide these; they come from Organization.settings
 * or are overridden at ProgramVersion level.
 */
export const brandingSchema = z
  .object({
    logoUrl: z.string().url().optional(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    displayName: z.string().optional(),
  })
  .optional();

/**
 * Notifications — org-level escalation and digest settings.
 * JourneyPackage doesn't provide these; they come from Organization.settings.
 */
export const notificationsSchema = z
  .object({
    /** Channels for mentor alerts (e.g., email, slack webhook, in-app). */
    escalationChannels: z
      .array(
        z.object({
          type: z.enum(["email", "slack", "in_app"]),
          target: z.string(), // email address, webhook URL, or user ID
          severities: z.array(z.enum(["low", "medium", "high", "critical"])).default(["high", "critical"]),
        })
      )
      .default([]),
    /** Weekly digest settings. */
    weeklyDigest: z
      .object({
        enabled: z.boolean().default(true),
        dayOfWeek: z.number().int().min(0).max(6).default(1), // 0=Sun, 1=Mon
        recipients: z.array(z.string()).default([]), // email addresses or user IDs
      })
      .optional(),
    /** Inactivity reminder settings. */
    inactivityReminder: z
      .object({
        enabled: z.boolean().default(true),
        daysThreshold: z.number().int().positive().default(7),
      })
      .optional(),
  })
  .optional();

// ═══════════════════════════════════════════════════════════════════════════
// ProgramVersion.config — Full Schema
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The complete ProgramVersion.config schema.
 *
 * Combines per-course fields from JourneyPackage.config with org-level fields.
 * On JourneyPackage import, per-course fields come from the package;
 * org-level fields are inherited from Organization.settings or set explicitly.
 */
export const programVersionConfigSchema = z.object({
  // ─── Per-Course Fields (from JourneyPackage.config) ─────────────────────────
  /** Terminology overrides (e.g., participantSingular: "socio"). */
  terminology: z.record(z.string(), z.string()).optional(),

  /** AI behavior tuning for this program. */
  aiBehavior: z
    .object({
      tone: z.string(),
      teachingStyle: z.string(),
      languageInstruction: z.string(),
    })
    .partial()
    .optional(),

  /** Onboarding flow configuration. */
  onboarding: z
    .object({
      mode: z.enum(["survey", "baseline_quiz", "skip"]),
      steps: z
        .array(
          z.object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
            promptKey: z.string(),
            field: z.string(),
          })
        )
        .default([]),
    })
    .optional(),

  /** The signals the AI senses and rules act on. Maps to MetricDefinition. */
  trackedDimensions: z.array(trackedDimensionSchema).default([]),

  /** Alert rules that trigger when dimensions cross thresholds. */
  alertRules: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
        dimensionKey: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
        operator: z.enum(["lt", "lte", "gt", "gte", "eq"]),
        threshold: z.number(),
        severity: z.enum(["low", "medium", "high"]),
        cooldownHours: z.number().nonnegative().default(24),
      })
    )
    .default([]),

  /** Graduation criteria. */
  graduation: z
    .object({
      requiredLessonKeys: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)).default([]),
      requiredDimensionKeys: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)).default([]),
    })
    .optional(),

  /** Assessment configuration for gated teach-back sessions. */
  assessment: z
    .object({
      passing: passingSchema,
      studentVisibleDimensionKeys: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)).optional(),
      recordedDimensionKeys: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)).optional(),
      onMaxTurnsWithoutPass: z.enum(["complete_with_scores", "return_for_reteach", "flag_mentor"]).default("complete_with_scores"),
      allowRetake: z.boolean().default(true),
      blocking: z.boolean().default(true),
    })
    .optional(),

  /**
   * Mentor-dashboard panels for this course, in render order.
   * Absent → the course-agnostic default set, never another course's panels.
   */
  dashboard: dashboardSchema.optional(),

  /**
   * The completable project this course builds toward — what a participant is
   * trying to DO, as distinct from what they are learning.
   *
   * Carried here rather than in dedicated Outcome/Milestone tables, and that is
   * a deliberate split rather than a shortcut:
   *
   *   authored content   what the project IS, per published version — belongs
   *                      with every other authored block, which is here
   *   per-learner state  which milestones THIS participant has reached —
   *                      genuinely needs tables, and has no writer today
   *
   * Building the tables now would add three models whose per-learner half
   * nothing writes, which is the exact shape `writePathAudit.test.ts` exists to
   * catch. So the content lands here, milestone *tracking* stays unbuilt, and
   * the difference is stated instead of blurred.
   *
   * `milestones` and `mentorResources` are stored even though nothing reads
   * them yet: they are authored alongside the project and dropping them on
   * import is what made `outcome` invisible in the first place.
   */
  outcome: z
    .object({
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
            key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
            name: z.string().min(1),
            afterLessonKey: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
            checkDescription: z.string().optional(),
          }),
        )
        .default([]),
      mentorResources: z
        .array(
          z.object({
            milestoneKey: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
            trigger: z.enum(["on_reach", "when_behind"]).default("on_reach"),
            body: z.string(),
            mentorPrompt: z.string().optional(),
          }),
        )
        .default([]),
    })
    .optional(),

  // ─── Org-Level Fields (not from JourneyPackage) ─────────────────────────────
  /** Visual branding (logo, colors). Inherited from org or overridden. */
  branding: brandingSchema,

  /** Notification/escalation settings. Inherited from org or overridden. */
  notifications: notificationsSchema,

  // ─── Reference to Curriculum ────────────────────────────────────────────────
  /**
   * The collectionKey linking this ProgramVersion to its ContentCollection.
   * Set on import from JourneyPackage.curriculum.collectionKey.
   * The actual lessons live in ContentLesson/LessonVersion rows.
   */
  curriculumCollectionKey: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// Type Exports
// ═══════════════════════════════════════════════════════════════════════════

export type ProgramVersionConfig = z.infer<typeof programVersionConfigSchema>;
export type Branding = z.infer<typeof brandingSchema>;
export type Notifications = z.infer<typeof notificationsSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// Validation Helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validates a ProgramVersion.config JSON blob.
 * Returns the parsed config or throws on validation failure.
 */
export function validateProgramVersionConfig(config: unknown): ProgramVersionConfig {
  return programVersionConfigSchema.parse(config);
}

/**
 * Safe validation that returns a result object.
 */
export function safeParseProgramVersionConfig(config: unknown) {
  return programVersionConfigSchema.safeParse(config);
}
