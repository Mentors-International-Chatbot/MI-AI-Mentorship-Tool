import { describe, it, expect } from 'vitest';
import {
  adjustLearnerOverridesSchema,
  resolveFlagSchema,
  snoozeFlagSchema,
  draftMessageToLearnerSchema,
  CONFIRM_REQUIRED_TOOLS,
  READ_ONLY_TOOLS,
} from '../tools';

describe('mentor assistant tool schemas', () => {
  it('adjust_learner_overrides requires at least one field', () => {
    expect(adjustLearnerOverridesSchema.safeParse({}).success).toBe(false);
    expect(adjustLearnerOverridesSchema.safeParse({ warmth: 0.5 }).success).toBe(true);
  });

  it('adjust_learner_overrides rejects out-of-range values', () => {
    expect(adjustLearnerOverridesSchema.safeParse({ complexity: 1.5 }).success).toBe(false);
    expect(adjustLearnerOverridesSchema.safeParse({ complexity: -0.1 }).success).toBe(false);
  });

  it('resolve_flag accepts only a real disposition', () => {
    expect(
      resolveFlagSchema.safeParse({ flagId: 'f1', disposition: 'monitoring' }).success,
    ).toBe(true);
    expect(
      resolveFlagSchema.safeParse({ flagId: 'f1', disposition: 'made_up_value' }).success,
    ).toBe(false);
  });

  it('snooze_flag accepts only 1, 3, or 7 days', () => {
    expect(snoozeFlagSchema.safeParse({ flagId: 'f1', days: 3 }).success).toBe(true);
    expect(snoozeFlagSchema.safeParse({ flagId: 'f1', days: 2 }).success).toBe(false);
  });

  it('draft_message_to_learner rejects an empty message', () => {
    expect(draftMessageToLearnerSchema.safeParse({ message: '' }).success).toBe(false);
    expect(draftMessageToLearnerSchema.safeParse({ message: 'hi' }).success).toBe(true);
  });

  it('every confirm-required and read-only tool name is pairwise distinct', () => {
    const all = [...CONFIRM_REQUIRED_TOOLS, ...READ_ONLY_TOOLS];
    expect(new Set(all).size).toBe(all.length);
  });
});
