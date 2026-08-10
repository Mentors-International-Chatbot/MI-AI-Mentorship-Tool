/**
 * Active-prompt cache — what it must and must not memoize
 * ----------------------------------------------------------------------------
 * The point of this cache is the null result. A category with no row anywhere
 * pays the full three-tier walk on every turn and returns nothing, and most
 * categories have no row. Caching only the hits would leave the common case
 * exactly as slow as it was.
 *
 * The thing it must NOT cache is a throw. `loadActivePrompt` and `layers/core`
 * both treat a failed lookup as "use the code default", so memoizing a
 * transient DB blip would silently pin every learner to the code default for a
 * full TTL — a much worse outcome than the one extra query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = vi.hoisted(() => ({
  getActivePrompt: vi.fn(),
}));

vi.mock('@/lib/repo', () => ({ repo: mockRepo }));

import { getActivePromptCached, invalidateActivePromptCache } from '../activePromptCache';

function promptRow(content: string) {
  return {
    id: 'sp-1',
    version: '1.0',
    content,
    category: 'lesson_delivery',
    active: true,
    authorId: 'admin-1',
    organizationId: null,
    collectionKey: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateActivePromptCache();
});

describe('getActivePromptCached', () => {
  it('queries once for repeated reads of the same category and scope', async () => {
    mockRepo.getActivePrompt.mockResolvedValue(promptRow('TEXT'));

    const scope = { organizationId: 'org-1', collectionKey: 'course-a' };
    await getActivePromptCached('lesson_delivery', scope);
    await getActivePromptCached('lesson_delivery', scope);
    await getActivePromptCached('lesson_delivery', scope);

    expect(mockRepo.getActivePrompt).toHaveBeenCalledTimes(1);
  });

  it('caches the null result, which is the common case', async () => {
    mockRepo.getActivePrompt.mockResolvedValue(null);

    expect(await getActivePromptCached('reteach')).toBeNull();
    expect(await getActivePromptCached('reteach')).toBeNull();

    expect(mockRepo.getActivePrompt).toHaveBeenCalledTimes(1);
  });

  it('does not let one course read another course\'s cached prompt', async () => {
    mockRepo.getActivePrompt.mockImplementation(async (_c: string, scope?: { collectionKey?: string | null }) =>
      promptRow(scope?.collectionKey === 'course-a' ? 'A TEXT' : 'B TEXT'),
    );

    const a = await getActivePromptCached('core', { organizationId: 'org-1', collectionKey: 'course-a' });
    const b = await getActivePromptCached('core', { organizationId: 'org-1', collectionKey: 'course-b' });

    expect(a?.content).toBe('A TEXT');
    expect(b?.content).toBe('B TEXT');
    expect(mockRepo.getActivePrompt).toHaveBeenCalledTimes(2);
  });

  it('keeps categories apart within one scope', async () => {
    mockRepo.getActivePrompt.mockImplementation(async (category: string) => promptRow(`${category} TEXT`));

    const core = await getActivePromptCached('core', { collectionKey: 'course-a' });
    const task = await getActivePromptCached('lesson_delivery', { collectionKey: 'course-a' });

    expect(core?.content).toBe('core TEXT');
    expect(task?.content).toBe('lesson_delivery TEXT');
  });

  it('serves the new row after an activation busts the cache', async () => {
    mockRepo.getActivePrompt.mockResolvedValue(promptRow('OLD'));
    expect((await getActivePromptCached('core'))?.content).toBe('OLD');

    mockRepo.getActivePrompt.mockResolvedValue(promptRow('NEW'));
    expect((await getActivePromptCached('core'))?.content).toBe('OLD'); // still cached

    invalidateActivePromptCache();
    expect((await getActivePromptCached('core'))?.content).toBe('NEW');
  });

  it('re-throws a failed lookup and does not cache it', async () => {
    mockRepo.getActivePrompt.mockRejectedValueOnce(new Error('connection reset'));

    await expect(getActivePromptCached('core')).rejects.toThrow('connection reset');

    // The next read must hit the database again rather than serve a cached
    // absence — otherwise one blip downgrades everyone to the code default.
    mockRepo.getActivePrompt.mockResolvedValue(promptRow('RECOVERED'));
    expect((await getActivePromptCached('core'))?.content).toBe('RECOVERED');
    expect(mockRepo.getActivePrompt).toHaveBeenCalledTimes(2);
  });
});
