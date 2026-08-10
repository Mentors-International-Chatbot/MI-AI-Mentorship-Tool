/**
 * Course outcome → the conversational path
 * ═══════════════════════════════════════════════════════════════════════════
 * `outcome.project` spent its whole life validated-then-discarded: the importer
 * cross-checked every milestoneKey, pushed a warning, and dropped the block for
 * want of a table. These tests pin the read path that finally consumes it, and
 * — more importantly — pin what it does when the block is absent or malformed,
 * because the failure mode is a prompt containing a heading with nothing under
 * it, which reads as an instruction the model will try to follow.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/repo', () => ({
  tenantRepo: { getActiveProgramVersionByCollection: vi.fn() },
}));

vi.mock('@/lib/repo/tenantContext', () => ({
  createTenantContext: (organizationId: string) => ({ organizationId }),
}));

import { tenantRepo } from '@/lib/repo';
import { resolveCourseProject, clearCourseOutcomeCache } from '../courseOutcome';

const repo = tenantRepo as unknown as {
  getActiveProgramVersionByCollection: ReturnType<typeof vi.fn>;
};

const SCOPE = { organizationId: 'org-1', collectionKey: 'pbj' };

function version(outcome: unknown) {
  return { config: { outcome }, primaryLang: 'en' };
}

const FULL = {
  project: {
    title: 'A peanut butter and jelly sandwich',
    description: 'Made start to finish, unaided',
    deliverables: [
      { name: 'The sandwich', description: 'Edible' },
      { name: 'A written recipe' },
    ],
  },
  milestones: [{ key: 'assembled', name: 'Assembled', afterLessonKey: 'lesson-03' }],
  mentorResources: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  clearCourseOutcomeCache();
});

describe('resolveCourseProject', () => {
  it('reads the project from the active version config', async () => {
    repo.getActiveProgramVersionByCollection.mockResolvedValue(version(FULL));

    const p = await resolveCourseProject(SCOPE);

    expect(p).toEqual({
      title: 'A peanut butter and jelly sandwich',
      description: 'Made start to finish, unaided',
      deliverables: [
        { name: 'The sandwich', description: 'Edible' },
        { name: 'A written recipe', description: undefined },
      ],
    });
  });

  it('refuses to read another tenant when the scope has no organization', async () => {
    // resolvePromptScope returning no org means it declined to guess one.
    // Reading some other tenant's project is worse than reading none.
    const p = await resolveCourseProject({ organizationId: null, collectionKey: 'pbj' });
    expect(p).toBeNull();
    expect(repo.getActiveProgramVersionByCollection).not.toHaveBeenCalled();
  });

  it('returns null for a course with no published version', async () => {
    repo.getActiveProgramVersionByCollection.mockResolvedValue(null);
    expect(await resolveCourseProject(SCOPE)).toBeNull();
  });

  it('returns null for a version whose config has no outcome block', async () => {
    repo.getActiveProgramVersionByCollection.mockResolvedValue({ config: {}, primaryLang: 'en' });
    expect(await resolveCourseProject(SCOPE)).toBeNull();
  });

  it('rejects a project with no usable title rather than emitting an empty heading', async () => {
    // A titleless project would render "Course project: " into the prompt. An
    // empty instruction is worse than an absent one — the model will try to use it.
    for (const bad of [{ project: {} }, { project: { title: '   ' } }, { project: { title: 42 } }]) {
      repo.getActiveProgramVersionByCollection.mockResolvedValue(version(bad));
      clearCourseOutcomeCache();
      expect(await resolveCourseProject(SCOPE), JSON.stringify(bad)).toBeNull();
    }
  });

  it('survives malformed deliverables instead of throwing mid-turn', async () => {
    repo.getActiveProgramVersionByCollection.mockResolvedValue(
      version({ project: { title: 'T', deliverables: [null, 'nope', { name: '' }, { name: 'ok' }] } }),
    );
    const p = await resolveCourseProject(SCOPE);
    expect(p?.deliverables).toEqual([{ name: 'ok', description: undefined }]);
  });

  it('treats a blank description as absent', async () => {
    repo.getActiveProgramVersionByCollection.mockResolvedValue(
      version({ project: { title: 'T', description: '   ', deliverables: [] } }),
    );
    expect((await resolveCourseProject(SCOPE))?.description).toBeUndefined();
  });

  it('caches per course — a published version does not change in place', async () => {
    repo.getActiveProgramVersionByCollection.mockResolvedValue(version(FULL));

    await resolveCourseProject(SCOPE);
    await resolveCourseProject(SCOPE);

    expect(repo.getActiveProgramVersionByCollection).toHaveBeenCalledTimes(1);
  });

  it('caches the null answer too, so a course without a project costs one lookup', async () => {
    repo.getActiveProgramVersionByCollection.mockResolvedValue(null);

    await resolveCourseProject(SCOPE);
    await resolveCourseProject(SCOPE);

    expect(repo.getActiveProgramVersionByCollection).toHaveBeenCalledTimes(1);
  });

  it('keeps courses separate in the cache', async () => {
    repo.getActiveProgramVersionByCollection
      .mockResolvedValueOnce(version(FULL))
      .mockResolvedValueOnce(version({ project: { title: 'Other', deliverables: [] } }));

    const a = await resolveCourseProject(SCOPE);
    const b = await resolveCourseProject({ ...SCOPE, collectionKey: 'other' });

    expect(a?.title).not.toEqual(b?.title);
  });

  it('returns null instead of throwing when the lookup fails', async () => {
    // A conversation must continue exactly as it did before this feature.
    repo.getActiveProgramVersionByCollection.mockRejectedValue(new Error('db down'));
    await expect(resolveCourseProject(SCOPE)).resolves.toBeNull();
  });
});
