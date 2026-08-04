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
