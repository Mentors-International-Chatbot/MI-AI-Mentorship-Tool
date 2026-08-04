/**
 * promptVersion resolution — traces must name what actually ran
 * ----------------------------------------------------------------------------
 * A code constant that never moves when someone edits a prompt in /admin makes
 * two grader runs look identical when they weren't. DB-backed layers therefore
 * report the active row's version, and the per-lesson content layer reports the
 * lesson it injected. The constants remain the fallback, so a deployment with no
 * DB overrides traces exactly as it did before this change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = vi.hoisted(() => ({
  getActivePrompt: vi.fn(),
}));

vi.mock('@/lib/repo', () => ({ repo: mockRepo }));

// Import AFTER mocking
import {
  loadActivePrompt,
  formatDbPromptVersion,
  type PromptVersionSink,
} from '../loadPrompt';
import { getContentIdentity } from '../layers/content';
import { InteractionMode } from '../types';
import type { RouterResult } from '../types';
import { buildLessonPromptVersion } from '@/lib/ai/service';
import { CORE_PROMPT_VERSION } from '../layers/core';
import { CONTEXT_PROMPT_VERSION } from '../layers/context';
import { TASK_PROMPT_VERSION } from '../layers/task';

const CREATED_AT = new Date('2026-07-20T09:00:00.000Z');

function promptRow(version: string) {
  return {
    id: 'sp-1',
    version,
    content: 'DB PROMPT TEXT',
    category: 'lesson_delivery',
    active: true,
    authorId: 'admin-1',
    organizationId: null,
    collectionKey: null,
    createdAt: CREATED_AT,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('formatDbPromptVersion', () => {
  it('prefixes the row version with db:', () => {
    expect(formatDbPromptVersion(promptRow('1.0'))).toBe('db:1.0');
  });

  it('keeps non-numeric version labels intact', () => {
    expect(formatDbPromptVersion(promptRow('2.1-beta'))).toBe('db:2.1-beta');
  });

  it('falls back to createdAt when the version column is blank', () => {
    expect(formatDbPromptVersion(promptRow('   '))).toBe('db:2026-07-20T09:00:00.000Z');
  });
});

describe('loadActivePrompt version sink', () => {
  it('records the DB version when an active row overrides the default', async () => {
    mockRepo.getActivePrompt.mockResolvedValue(promptRow('1.0'));
    const sink: PromptVersionSink = {};

    const text = await loadActivePrompt('lesson_delivery', 'FALLBACK', undefined, sink, 'task');

    expect(text).toBe('DB PROMPT TEXT');
    expect(sink.task).toBe('db:1.0');
  });

  it('records nothing when no active row exists', async () => {
    mockRepo.getActivePrompt.mockResolvedValue(null);
    const sink: PromptVersionSink = {};

    const text = await loadActivePrompt('lesson_delivery', 'FALLBACK', undefined, sink, 'task');

    expect(text).toBe('FALLBACK');
    expect(sink).toEqual({});
  });

  it('records nothing when the lookup throws', async () => {
    mockRepo.getActivePrompt.mockRejectedValue(new Error('db down'));
    const sink: PromptVersionSink = {};

    const text = await loadActivePrompt('lesson_delivery', 'FALLBACK', undefined, sink, 'task');

    expect(text).toBe('FALLBACK');
    expect(sink).toEqual({});
  });

  it('still works with no sink supplied (existing callers)', async () => {
    mockRepo.getActivePrompt.mockResolvedValue(promptRow('1.0'));
    await expect(loadActivePrompt('lesson_delivery', 'FALLBACK')).resolves.toBe('DB PROMPT TEXT');
  });
});

describe('getContentIdentity', () => {
  const COLLECTION = 'mi-colombia-curriculum';

  it('names the lesson for LESSON_DELIVERY', () => {
    const result = {
      mode: InteractionMode.LESSON_DELIVERY,
      lesson: { lessonNumber: 3 },
    } as RouterResult;
    expect(getContentIdentity(result, COLLECTION)).toBe('mi-colombia-curriculum/lesson-3');
  });

  it('names the lesson for LESSON_START', () => {
    const result = {
      mode: InteractionMode.LESSON_START,
      lesson: { lessonNumber: 1 },
    } as RouterResult;
    expect(getContentIdentity(result, COLLECTION)).toBe('mi-colombia-curriculum/lesson-1');
  });

  it('distinguishes a reteach of the same lesson', () => {
    const result = {
      mode: InteractionMode.RETEACH,
      reteach: { lessonNumber: 3 },
    } as RouterResult;
    expect(getContentIdentity(result, COLLECTION)).toBe('mi-colombia-curriculum/reteach-3');
  });

  it('marks the freeform reference block', () => {
    const result = { mode: InteractionMode.FREEFORM_QUESTION } as RouterResult;
    expect(getContentIdentity(result, COLLECTION)).toBe('mi-colombia-curriculum/freeform-reference');
  });

  it('returns null for modes that inject no content layer', () => {
    for (const mode of [InteractionMode.CHECKIN, InteractionMode.REMINDER, InteractionMode.MENTOR_HANDOFF, InteractionMode.POST_MENTOR]) {
      expect(getContentIdentity({ mode } as RouterResult, COLLECTION)).toBeNull();
    }
  });

  it('scopes the identity by collection so two courses never collide', () => {
    const result = {
      mode: InteractionMode.LESSON_DELIVERY,
      lesson: { lessonNumber: 3 },
    } as RouterResult;
    expect(getContentIdentity(result, 'pbj-basics')).toBe('pbj-basics/lesson-3');
  });
});

describe('buildLessonPromptVersion — the shape written to ai_invocations', () => {
  it('uses code constants when no DB override is active', () => {
    expect(
      buildLessonPromptVersion({
        dbVersions: {},
        contentIdentity: 'mi-colombia-curriculum/lesson-3',
        language: 'es',
      }),
    ).toEqual({
      core: CORE_PROMPT_VERSION,
      context: CONTEXT_PROMPT_VERSION,
      task: TASK_PROMPT_VERSION,
      content: 'mi-colombia-curriculum/lesson-3',
      language: 'es',
    });
  });

  it('reports DB versions for the layers that were overridden', () => {
    expect(
      buildLessonPromptVersion({
        dbVersions: { core: 'db:1.0', task: 'db:2.1-beta' },
        contentIdentity: 'mi-colombia-curriculum/lesson-3',
        language: 'es',
      }),
    ).toEqual({
      core: 'db:1.0',
      context: CONTEXT_PROMPT_VERSION,
      task: 'db:2.1-beta',
      content: 'mi-colombia-curriculum/lesson-3',
      language: 'es',
    });
  });

  it('mixes DB and code versions per layer', () => {
    const versions = buildLessonPromptVersion({
      dbVersions: { core: 'db:1.0' },
      contentIdentity: 'pbj-basics/lesson-1',
      language: 'en',
    });
    expect(versions.core).toBe('db:1.0');
    expect(versions.task).toBe(TASK_PROMPT_VERSION);
  });

  it('omits content entirely when no content layer was injected', () => {
    const versions = buildLessonPromptVersion({
      dbVersions: {},
      contentIdentity: null,
      language: 'es',
    });
    expect(versions).not.toHaveProperty('content');
    expect(Object.keys(versions)).toEqual(['core', 'context', 'task', 'language']);
  });

  it('records the socio language the prompt was built in', () => {
    expect(
      buildLessonPromptVersion({ dbVersions: {}, contentIdentity: null, language: 'pt' }).language,
    ).toBe('pt');
  });
});
