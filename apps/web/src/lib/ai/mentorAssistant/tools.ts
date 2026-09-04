/**
 * D.3 embedded assistant — tool definitions.
 * ═══════════════════════════════════════════════════════════════════════════
 * Every tool here wraps an already-existing, already-tenant-checked mechanism
 * (see mentorAssistant/execute.ts) — this file only defines what the model may
 * ask for and the shape of its arguments. `func` is never actually invoked:
 * the route reads `AIMessage.tool_calls` off the model's response and decides
 * what to do itself (propose-then-confirm for a mutation, run-then-answer for
 * a read), rather than letting LangChain call the tool directly. That is the
 * whole mechanism behind "the door you knock on never determines what you are
 * allowed to do" applied here: the model can *propose*, never *execute*.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { FLAG_DISPOSITIONS, SNOOZE_DAYS } from '@/lib/repo/types';

// zod needs a concrete enum/union to describe valid values to the model in
// the tool's JSON schema — a runtime-only type guard would serialize as an
// unconstrained field and the model would never learn the valid values.
// Still derived from the repo's own constants, not re-typed by hand.
const FLAG_DISPOSITION_ENUM = FLAG_DISPOSITIONS as unknown as [string, ...string[]];
const SNOOZE_DAYS_LITERALS = SNOOZE_DAYS.map((d) => z.literal(d)) as [
  z.ZodLiteral<number>,
  z.ZodLiteral<number>,
  ...z.ZodLiteral<number>[],
];

/** Tool names that mutate something and therefore require the mentor's confirm click. */
export const CONFIRM_REQUIRED_TOOLS = [
  'adjust_learner_overrides',
  'resolve_flag',
  'snooze_flag',
  'draft_message_to_learner',
] as const;

/** Tools that only read data — auto-executed, still audit-logged, never a confirm card. */
export const READ_ONLY_TOOLS = ['summarize_history'] as const;

export type ConfirmRequiredTool = (typeof CONFIRM_REQUIRED_TOOLS)[number];
export type ReadOnlyTool = (typeof READ_ONLY_TOOLS)[number];
export type MentorAssistantToolName = ConfirmRequiredTool | ReadOnlyTool;

const neverInvoked = () => {
  throw new Error('Mentor assistant tools are proposal-only and must not be invoked directly.');
};

export const adjustLearnerOverridesSchema = z
  .object({
    complexity: z.number().min(0).max(1).optional(),
    warmth: z.number().min(0).max(1).optional(),
    positivity: z.number().min(0).max(1).optional(),
  })
  .refine((v) => v.complexity !== undefined || v.warmth !== undefined || v.positivity !== undefined, {
    message: 'At least one of complexity, warmth, or positivity is required.',
  });

export const resolveFlagSchema = z.object({
  flagId: z.string().min(1),
  disposition: z.enum(FLAG_DISPOSITION_ENUM),
  note: z.string().trim().optional(),
});

export const snoozeFlagSchema = z.object({
  flagId: z.string().min(1),
  days: z.union(SNOOZE_DAYS_LITERALS),
});

export const draftMessageToLearnerSchema = z.object({
  message: z.string().trim().min(1),
});

export const summarizeHistorySchema = z.object({});

export const mentorAssistantTools = [
  tool(neverInvoked, {
    name: 'adjust_learner_overrides',
    description:
      "Adjust this learner's AI tutoring style. Only include the fields the mentor actually wants changed.",
    schema: adjustLearnerOverridesSchema,
  }),
  tool(neverInvoked, {
    name: 'resolve_flag',
    description:
      'Mark one of this learner\'s open flags resolved. A RED flag requires a note explaining what was done. flagId must be one of the open flag ids given in context — never invent one.',
    schema: resolveFlagSchema,
  }),
  tool(neverInvoked, {
    name: 'snooze_flag',
    description:
      "Snooze one of this learner's open flags for 1, 3, or 7 days. flagId must be one of the open flag ids given in context.",
    schema: snoozeFlagSchema,
  }),
  tool(neverInvoked, {
    name: 'draft_message_to_learner',
    description:
      'Draft a message to send this learner directly (delivered by WhatsApp if that is their channel). The mentor reviews and can edit the draft before it sends — propose your best draft, not a placeholder.',
    schema: draftMessageToLearnerSchema,
  }),
  tool(neverInvoked, {
    name: 'summarize_history',
    description:
      "Read this learner's recent weekly summaries and current flags to answer a question about their history or progress. Takes no arguments.",
    schema: summarizeHistorySchema,
  }),
];
