/**
 * The progress payload
 * ═══════════════════════════════════════════════════════════════════════════
 * The panel exists because a learner asked "yay! Am i done?" and nothing on
 * screen could answer. So the cases that matter are the ones where a number is
 * absent or unknowable — those must degrade to something honest rather than to
 * "Lesson 2 of 0" or an empty "Your project" heading.
 *
 * Nothing here may be hardcoded per course: the lesson count comes from the
 * learner's own collection and the milestones from its declared outcome.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socio } from '@/lib/repo/types';

const mockRepo = vi.hoisted(() => ({
  getSocioProgress: vi.fn(),
  getMilestoneProgress: vi.fn(),
  getAssessmentSessionsForSocioLesson: vi.fn(),
}));

vi.mock('@/lib/repo', () => ({ repo: mockRepo }));

vi.mock('@/lib/journey-package/course-summaries', () => ({
  getCourseSummaries: vi.fn(async () => [
    { collectionKey: 'pbj', displayName: 'Peanut Butter & Jelly', lessonCount: 3 },
  ]),
}));

vi.mock('@/lib/lessons/db-lesson-service', () => ({
  preloadCollection: vi.fn(async () => {}),
  hasLessonData: vi.fn(() => true),
  getLessonData: vi.fn(),
}));

vi.mock('@/lib/ai/prompts/resolveScope', () => ({
  resolvePromptScope: vi.fn(async () => ({ organizationId: 'org-1', collectionKey: 'pbj' })),
}));

vi.mock('@/lib/ai/prompts/courseOutcome', () => ({
  resolveCourseProject: vi.fn(async () => null),
  resolveCourseMilestones: vi.fn(async () => []),
}));

import { getCourseSummaries } from '@/lib/journey-package/course-summaries';
import { hasLessonData, getLessonData } from '@/lib/lessons/db-lesson-service';
import { resolveCourseProject, resolveCourseMilestones } from '@/lib/ai/prompts/courseOutcome';
import { buildChatProgress } from '../progress';

const mockSummaries = getCourseSummaries as ReturnType<typeof vi.fn>;
const mockHasLessonData = hasLessonData as ReturnType<typeof vi.fn>;
const mockGetLessonData = getLessonData as ReturnType<typeof vi.fn>;
const mockProject = resolveCourseProject as ReturnType<typeof vi.fn>;
const mockMilestones = resolveCourseMilestones as ReturnType<typeof vi.fn>;

const lesson = {
  lessonNumber: 2,
  lessonKey: 'lesson-02',
  titleEs: 'Spreading',
  messages: [
    { order: 1, type: 'escenario' as const, contentEs: 'a' },
    { order: 2, type: 'explicación' as const, contentEs: 'b' },
    { order: 3, type: 'explicación' as const, contentEs: 'c' },
  ],
  gates: [{ blockId: 'gate-1', afterMessageIndex: 1, prompt: 'Explain', evaluatesConcepts: [], dimensionKey: 'seq' }],
};

function socio(over: Partial<Socio> = {}): Socio {
  return {
    id: 'socio-1',
    channelType: 'web',
    externalId: 'ext-1',
    language: 'en',
    status: 'ACTIVE',
    aiPaused: false,
    curriculumCollectionKey: 'pbj',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Socio;
}

function progressRow(over: Record<string, unknown> = {}) {
  return {
    currentLessonNumber: 2,
    currentMessageIndex: 0,
    completedLessons: [1],
    weeklyUnderstanding: null,
    weeklyImplementation: null,
    remindersSent: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasLessonData.mockReturnValue(true);
  mockGetLessonData.mockReturnValue(lesson);
  mockRepo.getSocioProgress.mockResolvedValue(progressRow());
  mockRepo.getMilestoneProgress.mockResolvedValue([]);
  mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([]);
  mockProject.mockResolvedValue(null);
  mockMilestones.mockResolvedValue([]);
  mockSummaries.mockResolvedValue([
    { collectionKey: 'pbj', displayName: 'Peanut Butter & Jelly', lessonCount: 3 },
  ]);
});

describe('buildChatProgress', () => {
  it('reports lesson position from the learner\'s own collection', async () => {
    const p = await buildChatProgress(socio());

    expect(p?.lesson).toEqual({ current: 2, total: 3 });
    expect(p?.courseName).toBe('Peanut Butter & Jelly');
  });

  it('counts the part the learner is on, not the parts delivered', async () => {
    // currentMessageIndex is 0-based and counts messages delivered, so part 1
    // is index 0 — the same +1 the lesson prompt applies.
    mockRepo.getSocioProgress.mockResolvedValue(progressRow({ currentMessageIndex: 0 }));
    expect((await buildChatProgress(socio()))?.position).toEqual({ part: 1, total: 3 });

    mockRepo.getSocioProgress.mockResolvedValue(progressRow({ currentMessageIndex: 2 }));
    expect((await buildChatProgress(socio()))?.position).toEqual({ part: 3, total: 3 });
  });

  it('does not run the part counter past the end of the lesson', async () => {
    // Taught out: the index sits at messages.length and there is no part 4 of 3.
    mockRepo.getSocioProgress.mockResolvedValue(progressRow({ currentMessageIndex: 3 }));
    expect((await buildChatProgress(socio()))?.position).toEqual({ part: 3, total: 3 });
  });

  it('never reports a total of zero, which would render "lesson 2 of 0"', async () => {
    mockSummaries.mockResolvedValue([]); // collection could not be counted
    const p = await buildChatProgress(socio());
    expect(p?.lesson).toEqual({ current: 2, total: 2 });
  });

  describe('gate status', () => {
    it('says not-yet-reached before the learner gets there', async () => {
      mockRepo.getSocioProgress.mockResolvedValue(progressRow({ currentMessageIndex: 1 }));
      expect((await buildChatProgress(socio()))?.gate).toBe('not_reached');
    });

    it('says passed once a session records a pass', async () => {
      mockRepo.getSocioProgress.mockResolvedValue(progressRow({ currentMessageIndex: 2 }));
      mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([
        { id: 's1', status: 'completed', passedAt: new Date() },
      ]);
      expect((await buildChatProgress(socio()))?.gate).toBe('passed');
    });

    it('says not-passed for a finished attempt that did not pass', async () => {
      mockRepo.getSocioProgress.mockResolvedValue(progressRow({ currentMessageIndex: 2 }));
      mockRepo.getAssessmentSessionsForSocioLesson.mockResolvedValue([
        { id: 's1', status: 'completed', passedAt: null },
      ]);
      expect((await buildChatProgress(socio()))?.gate).toBe('not_passed');
    });

    it('omits the section for a lesson with no gate', async () => {
      mockGetLessonData.mockReturnValue({ ...lesson, gates: [] });
      expect((await buildChatProgress(socio()))?.gate).toBeNull();
    });
  });

  describe('project section', () => {
    it('is omitted entirely when the course declares no outcome', async () => {
      const p = await buildChatProgress(socio());
      expect(p?.project).toBeNull();
      // And nothing reads milestone_progress for a course that has none.
      expect(mockRepo.getMilestoneProgress).not.toHaveBeenCalled();
    });

    it('marks each declared milestone done or pending', async () => {
      mockProject.mockResolvedValue({ title: 'Make a sandwich', deliverables: [] });
      mockMilestones.mockResolvedValue([
        { key: 'first-slice', name: 'Cut the first slice', afterLessonKey: 'l1' },
        { key: 'first-sale', name: 'Sell one sandwich', afterLessonKey: 'l2' },
      ]);
      mockRepo.getMilestoneProgress.mockResolvedValue([{ milestoneKey: 'first-slice' }]);

      const p = await buildChatProgress(socio());

      expect(p?.project?.title).toBe('Make a sandwich');
      expect(p?.project?.milestones).toEqual([
        { key: 'first-slice', name: 'Cut the first slice', done: true },
        { key: 'first-sale', name: 'Sell one sandwich', done: false },
      ]);
    });
  });

  it('returns nothing for a socio with no course', async () => {
    const p = await buildChatProgress(socio({ curriculumCollectionKey: null }));
    expect(p).toBeNull();
  });
});
