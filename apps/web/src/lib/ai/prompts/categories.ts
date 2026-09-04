/**
 * Prompt category registry — the single source of truth
 * ═══════════════════════════════════════════════════════════════════════════
 * Every DB-overridable prompt category, in one place, because the admin UI and
 * the code that reads prompts had drifted apart:
 *
 *   - `/admin/prompts` offered `core`, `onboarding` and `name_extraction` while
 *     the runtime never read a plain `core` row (only `core:{collectionKey}`)
 *     and never read `onboarding` at all. Two of the eight active rows in the
 *     database were doing nothing, with no way for an author to tell.
 *   - It omitted `lesson_start`, `checkin`, `reminder`, `mentor_handoff` and
 *     `post_mentor`, which the runtime does read — so the categories that
 *     worked were the ones you could not edit.
 *
 * The admin page now renders from this array rather than a literal, and
 * `categories.test.ts` asserts the registry and the real call sites match in
 * both directions. Adding a `loadActivePrompt` call for an unregistered
 * category, or registering one nothing reads, fails the build.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Who may edit a category, and how far its override reaches.
 *
 * `course`  — learner-facing teaching text. A course lead owns it, and an
 *             override applies to their course only.
 * `platform`— utility calls whose output is parsed as structured data, not
 *             shown to a learner. Editing one can break flagging or onboarding
 *             for every course at once, so they stay admin-only.
 */
export type PromptScope = 'course' | 'platform';

export type PromptCategoryMeta = {
  category: string;
  label: string;
  description: string;
  scope: PromptScope;
};

export const PROMPT_CATEGORIES: readonly PromptCategoryMeta[] = [
  {
    category: 'core',
    label: 'Core identity & safety',
    description:
      'Layer 1. Who the AI is, its absolute rules, tone, formatting, and the system markers it may emit. Sent on every turn.',
    scope: 'course',
  },
  {
    category: 'lesson_start',
    label: 'Lesson introduction',
    description: 'Opening a new lesson: framing the topic and setting expectations.',
    scope: 'course',
  },
  {
    category: 'lesson_delivery',
    label: 'Lesson delivery',
    description: 'Delivering each teaching message inside a lesson.',
    scope: 'course',
  },
  {
    category: 'freeform',
    label: 'Open questions',
    description:
      'Answering a question that is not part of the current lesson, without drifting off-curriculum.',
    scope: 'course',
  },
  {
    category: 'checkin',
    label: 'Scheduled check-in',
    description: 'Proactive check-ins, including the weekly report prompt.',
    scope: 'course',
  },
  {
    category: 'reteach',
    label: 'Re-teaching',
    description:
      'Re-explaining a concept the learner did not grasp, in a different way rather than louder.',
    scope: 'course',
  },
  {
    category: 'reminder',
    label: 'Inactivity reminder',
    description: 'Nudging a learner who has gone quiet.',
    scope: 'course',
  },
  {
    category: 'mentor_handoff',
    label: 'Mentor handoff',
    description: 'What the AI says when a human mentor is taking over.',
    scope: 'course',
  },
  {
    category: 'post_mentor',
    label: 'After mentor contact',
    description: 'Resuming the conversation once a mentor has stepped back out.',
    scope: 'course',
  },
  {
    category: 'stance_tutor',
    label: 'Tutor stance',
    description:
      "Second router axis. How the AI behaves when its job is to build knowledge — before the learner has passed their lesson's gate, or during a bounded return to teaching. Applies across every turn type.",
    scope: 'course',
  },
  {
    category: 'stance_coach',
    label: 'Coach stance',
    description:
      'Second router axis. How the AI behaves when its job is to support execution — obstacles, progress, morale, next action. The resting posture once the gate is passed, and the posture used whenever a RED distress flag is active.',
    scope: 'course',
  },
  {
    category: 'sentiment',
    label: 'Sentiment analysis',
    description:
      'Scores each learner message for confusion, frustration and urgency. Must return the exact JSON contract — a malformed override silently disables auto-flagging.',
    scope: 'platform',
  },
  {
    category: 'name_extraction',
    label: 'Name extraction',
    description:
      "Pulls a learner's name out of their first reply during onboarding. Returns a bare string, not prose.",
    scope: 'platform',
  },
  {
    category: 'mentor_assistant',
    label: 'Mentor assistant',
    description:
      "D.3 embedded assistant on a learner's dashboard page. Never shown to a learner and not course-specific, so it stays platform-wide like sentiment/name_extraction. Proposes tool calls; never executes one directly.",
    scope: 'platform',
  },
] as const;

/** Fast membership check for validation at the API boundary. */
export const PROMPT_CATEGORY_KEYS: ReadonlySet<string> = new Set(
  PROMPT_CATEGORIES.map((c) => c.category),
);

export function getPromptCategoryMeta(category: string): PromptCategoryMeta | undefined {
  return PROMPT_CATEGORIES.find((c) => c.category === category);
}

/** Categories a course lead may edit. Platform-scoped ones are admin-only. */
export function courseEditableCategories(): PromptCategoryMeta[] {
  return PROMPT_CATEGORIES.filter((c) => c.scope === 'course');
}

/**
 * Whether a category may be stored at the given scope.
 *
 * This is the rule that keeps the platform tier empty of course content, and it
 * is enforced rather than documented on purpose. The original bug was not that
 * someone scoped a prompt wrongly — it was that an unscoped row was *accepted*
 * and silently became every course's default. A `core` row written without a
 * collectionKey was one tier walk away from telling every learner on the
 * platform they were talking to Mentors International.
 *
 * So: a course-scoped category REQUIRES a collectionKey, and a platform-scoped
 * category REFUSES one. Neither mistake is expressible rather than merely
 * discouraged — the same reasoning as using `migrate diff` over `migrate dev`,
 * or the import guard refusing to overwrite a published version.
 *
 * @returns null when the pairing is valid, otherwise a message for the caller
 */
export function validateCategoryScope(
  category: string,
  collectionKey: string | null | undefined,
): string | null {
  const meta = getPromptCategoryMeta(category);
  if (!meta) return `Unknown prompt category: ${category}`;

  if (meta.scope === 'course' && !collectionKey) {
    return (
      `"${meta.label}" is course-specific and must be saved against a course. ` +
      `A prompt with no course becomes the default for every course on the platform, ` +
      `which is how one programme's content reaches another programme's learners.`
    );
  }

  if (meta.scope === 'platform' && collectionKey) {
    return (
      `"${meta.label}" is platform-wide and cannot be scoped to a single course. ` +
      `Its output is parsed as structured data, so every course must share one contract.`
    );
  }

  return null;
}
