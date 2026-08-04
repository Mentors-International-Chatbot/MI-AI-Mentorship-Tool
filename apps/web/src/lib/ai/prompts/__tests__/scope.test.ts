import { describe, it, expect, beforeEach } from 'vitest';
import { scopeTiers, scopeCacheKey } from '@/lib/ai/prompts/scope';
import { inMemoryRepo, __seedSystemPrompts } from '@/lib/repo/inMemoryRepo';
import type { SystemPrompt } from '@/lib/repo/types';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const COURSE_A = 'course-a';
const COURSE_B = 'course-b';

function prompt(overrides: Partial<SystemPrompt> & { content: string }): SystemPrompt {
  return {
    id: overrides.content,
    version: '1.0',
    category: 'core',
    active: true,
    authorId: 'test',
    organizationId: null,
    collectionKey: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('scopeTiers', () => {
  it('walks course → org → platform when both are known', () => {
    expect(scopeTiers({ organizationId: ORG_A, collectionKey: COURSE_A })).toEqual([
      { organizationId: ORG_A, collectionKey: COURSE_A },
      { organizationId: ORG_A, collectionKey: null },
      { organizationId: null, collectionKey: null },
    ]);
  });

  it('skips the course tier when only an org is known', () => {
    expect(scopeTiers({ organizationId: ORG_A })).toEqual([
      { organizationId: ORG_A, collectionKey: null },
      { organizationId: null, collectionKey: null },
    ]);
  });

  it('falls back to the platform tier alone with no scope at all', () => {
    // This is exactly what every caller did before scoping existed, which is
    // what keeps pre-scoping rows working untouched.
    expect(scopeTiers()).toEqual([{ organizationId: null, collectionKey: null }]);
    expect(scopeTiers({})).toEqual([{ organizationId: null, collectionKey: null }]);
  });

  it('ignores a collection key with no organization', () => {
    // A slug is only unique within an organization, so it cannot identify a row
    // on its own. Querying (null, collection) could match another tenant.
    expect(scopeTiers({ collectionKey: COURSE_A })).toEqual([
      { organizationId: null, collectionKey: null },
    ]);
  });

  it('always ends at the platform tier', () => {
    for (const scope of [{}, { organizationId: ORG_A }, { organizationId: ORG_A, collectionKey: COURSE_A }]) {
      const tiers = scopeTiers(scope);
      expect(tiers[tiers.length - 1]).toEqual({ organizationId: null, collectionKey: null });
    }
  });
});

describe('scopeCacheKey', () => {
  it('distinguishes an absent org from every present one', () => {
    expect(scopeCacheKey({})).not.toBe(scopeCacheKey({ organizationId: ORG_A }));
  });

  it('distinguishes scopes that differ only by course', () => {
    expect(scopeCacheKey({ organizationId: ORG_A, collectionKey: COURSE_A })).not.toBe(
      scopeCacheKey({ organizationId: ORG_A, collectionKey: COURSE_B }),
    );
  });
});

describe('getActivePrompt precedence', () => {
  beforeEach(() => {
    __seedSystemPrompts([
      prompt({ content: 'PLATFORM' }),
      prompt({ content: 'ORG_A', organizationId: ORG_A }),
      prompt({ content: 'COURSE_A', organizationId: ORG_A, collectionKey: COURSE_A }),
      prompt({ content: 'COURSE_B', organizationId: ORG_B, collectionKey: COURSE_B }),
    ]);
  });

  it('prefers the course override', async () => {
    const r = await inMemoryRepo.getActivePrompt('core', {
      organizationId: ORG_A,
      collectionKey: COURSE_A,
    });
    expect(r?.content).toBe('COURSE_A');
  });

  it('falls back to the org default when the course has no override', async () => {
    const r = await inMemoryRepo.getActivePrompt('core', {
      organizationId: ORG_A,
      collectionKey: 'course-with-no-override',
    });
    expect(r?.content).toBe('ORG_A');
  });

  it('falls back to the platform default when the org has no default', async () => {
    const r = await inMemoryRepo.getActivePrompt('core', {
      organizationId: 'org-with-nothing',
      collectionKey: 'anything',
    });
    expect(r?.content).toBe('PLATFORM');
  });

  it('never returns another organization\'s prompt', async () => {
    // Org B holds a course-scoped prompt. An org A caller must not see it, even
    // when asking for the same collection key.
    const r = await inMemoryRepo.getActivePrompt('core', {
      organizationId: ORG_A,
      collectionKey: COURSE_B,
    });
    expect(r?.content).not.toBe('COURSE_B');
    expect(r?.content).toBe('ORG_A');
  });

  it('reads the platform tier when given no scope', async () => {
    const r = await inMemoryRepo.getActivePrompt('core');
    expect(r?.content).toBe('PLATFORM');
  });

  it('ignores inactive rows at every tier', async () => {
    __seedSystemPrompts([
      prompt({ content: 'PLATFORM' }),
      prompt({ content: 'COURSE_A_OFF', organizationId: ORG_A, collectionKey: COURSE_A, active: false }),
    ]);
    const r = await inMemoryRepo.getActivePrompt('core', {
      organizationId: ORG_A,
      collectionKey: COURSE_A,
    });
    expect(r?.content).toBe('PLATFORM');
  });

  it('returns null when no tier matches, rather than throwing', async () => {
    __seedSystemPrompts([]);
    await expect(
      inMemoryRepo.getActivePrompt('core', { organizationId: ORG_A, collectionKey: COURSE_A }),
    ).resolves.toBeNull();
  });
});
