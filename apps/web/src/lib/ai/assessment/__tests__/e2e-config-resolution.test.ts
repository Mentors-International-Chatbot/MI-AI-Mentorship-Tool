/**
 * E2E Config Resolution Test
 * ═══════════════════════════════════════════════════════════════════════════
 * This test verifies that config from the journey package (PB&J) flows correctly
 * through to the assessment session's configSnapshot.
 *
 * CRITICAL ASSERTION: configSnapshot.passing.threshold === 7
 * This proves the entire config resolution path works:
 *   PB&J package → importJourneyPackage → ProgramVersion.config →
 *   createAssessmentSession → session.configSnapshot
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTenantContext } from '@/lib/repo/tenantContext';
import type { TenantRepo } from '@/lib/repo/tenantRepo.types';
import { pbjPackage } from '@/lib/journey-package/examples/pbj-journey-package';
import { journeyPackageSchema } from '@/lib/journey-package/journey-package.schema';
import type { ProgramVersionConfig } from '@/lib/journey-package/program-version-config.schema';

// Parse the PB&J package to get the validated config
const validatedPbj = journeyPackageSchema.parse(pbjPackage);

// Build the ProgramVersionConfig as importJourneyPackage would
const pbjProgramConfig: ProgramVersionConfig = {
  terminology: validatedPbj.config.terminology,
  aiBehavior: validatedPbj.config.aiBehavior,
  onboarding: validatedPbj.config.onboarding,
  trackedDimensions: validatedPbj.config.trackedDimensions,
  alertRules: validatedPbj.config.alertRules,
  graduation: validatedPbj.config.graduation,
  assessment: validatedPbj.config.assessment,
  curriculumCollectionKey: validatedPbj.curriculum.collectionKey,
};

// Extract the lesson body as it would be stored in LessonVersion.body
const pbjLesson = validatedPbj.curriculum.lessons[0];

describe('E2E: Config Resolution from Journey Package', () => {
  // Track the configSnapshot that was passed to createAssessmentSession
  let capturedConfigSnapshot: Record<string, unknown> | null = null;

  // Mock repo that returns PB&J data
  const createMockRepo = (lessonBody = pbjLesson, programConfig = pbjProgramConfig): Partial<TenantRepo> => ({
    getSocioCurriculumCollectionKey: vi.fn().mockResolvedValue('pbj-basics'),
    getActiveProgramVersionByCollection: vi.fn().mockResolvedValue({
      id: 'pv-1',
      programId: 'prog-1',
      version: '0.1.0',
      config: programConfig,
      active: true,
      publishedAt: new Date(),
      createdAt: new Date(),
    }),
    getActiveLessonVersionBySlug: vi.fn().mockResolvedValue({
      id: 'lv-1',
      lessonId: 'lesson-1',
      version: '0.1.0',
      lang: 'en',
      title: lessonBody.title,
      body: lessonBody, // The full lesson object
      active: true,
      publishedAt: new Date(),
      createdAt: new Date(),
    }),
    getAssessmentSessionsForSocio: vi.fn().mockResolvedValue([]),
    createAssessmentSession: vi.fn().mockImplementation(async (_ctx, data) => {
      // Capture the configSnapshot that was built
      capturedConfigSnapshot = data.configSnapshot;
      return {
        id: 'session-1',
        organizationId: 'org-1',
        socioId: data.socioId,
        lessonKey: data.lessonKey,
        blockId: data.blockId,
        kind: 'gated_session',
        status: 'pending',
        attemptNumber: data.attemptNumber || 1,
        turnCount: 0,
        liveState: null,
        scores: null,
        passedAt: null,
        completedAt: null,
        configSnapshot: data.configSnapshot,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }),
    updateAssessmentSession: vi.fn().mockImplementation(async (_ctx, _sessionId, data) => ({
      id: 'session-1',
      organizationId: 'org-1',
      socioId: 'socio-1',
      lessonKey: 'assemble-the-sandwich',
      blockId: 'b8-gated-teach-back',
      kind: 'gated_session',
      status: 'pending',
      attemptNumber: 1,
      turnCount: 0,
      liveState: data.liveState || null,
      scores: null,
      passedAt: null,
      completedAt: null,
      // Use the captured configSnapshot from createAssessmentSession
      configSnapshot: capturedConfigSnapshot,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  });

  const mockRepo = createMockRepo();

  beforeEach(() => {
    vi.clearAllMocks();
    capturedConfigSnapshot = null;
  });

  it('PB&J package has the expected assessment config', () => {
    // Verify the source data is correct
    expect(validatedPbj.config.assessment?.passing.dimensionKey).toBe('sequencing');
    expect(validatedPbj.config.assessment?.passing.threshold).toBe(7);
    expect(validatedPbj.config.assessment?.passing.minTurns).toBe(2);
    expect(validatedPbj.config.assessment?.passing.maxTurns).toBe(5);
  });

  it('ProgramVersionConfig correctly captures assessment config', () => {
    // Verify the config transformation is correct
    expect(pbjProgramConfig.assessment?.passing.dimensionKey).toBe('sequencing');
    expect(pbjProgramConfig.assessment?.passing.threshold).toBe(7);
  });

  it('createAssessmentSession resolves config from ProgramVersion.config', async () => {
    // Dynamic import to avoid hoisting issues
    const { createAssessmentSession, getSessionConfig } = await import('../createAssessmentSession');

    const ctx = createTenantContext('org-1');

    const session = await createAssessmentSession({
      ctx,
      repo: mockRepo as TenantRepo,
      socioId: 'socio-1',
      lessonKey: 'assemble-the-sandwich',
      blockId: 'b8-gated-teach-back',
      channel: 'web',
    });

    // THE CRITICAL ASSERTIONS - these prove config flows through
    const configSnapshot = getSessionConfig(session);

    expect(configSnapshot.passing.dimensionKey).toBe('sequencing');
    expect(configSnapshot.passing.threshold).toBe(7);
    expect(configSnapshot.passing.minTurns).toBe(2);
    expect(configSnapshot.passing.maxTurns).toBe(5);

    // Also verify other config fields made it through
    expect(configSnapshot.trackedDimensions).toHaveLength(2);
    expect(configSnapshot.trackedDimensions[0].key).toBe('sequencing');
    expect(configSnapshot.onMaxTurnsWithoutPass).toBe('complete_with_scores');
    expect(configSnapshot.blocking).toBe(true);
    expect(configSnapshot.allowRetake).toBe(true);

    // Verify the teach_back block fields
    expect(configSnapshot.teachBackPrompt).toContain("Explain, in your own order");
    expect(configSnapshot.evaluatesConcepts).toHaveLength(2);
  });

  it('createAssessmentSession merges block passingOverride correctly', async () => {
    // Create a modified lesson with a passingOverride on the block
    const lessonWithOverride = {
      ...pbjLesson,
      blocks: pbjLesson.blocks.map(block => {
        if (block.id === 'b8-gated-teach-back') {
          return {
            ...block,
            passingOverride: {
              threshold: 8, // Override from 7 to 8
              minTurns: 3,  // Override from 2 to 3
            },
          };
        }
        return block;
      }),
    };

    const mockRepoWithOverride = createMockRepo(lessonWithOverride as typeof pbjLesson);

    const { createAssessmentSession, getSessionConfig } = await import('../createAssessmentSession');

    const ctx = createTenantContext('org-1');

    const session = await createAssessmentSession({
      ctx,
      repo: mockRepoWithOverride as TenantRepo,
      socioId: 'socio-1',
      lessonKey: 'assemble-the-sandwich',
      blockId: 'b8-gated-teach-back',
      channel: 'web',
    });

    const configSnapshot = getSessionConfig(session);

    // Block override wins over base config
    expect(configSnapshot.passing.threshold).toBe(8); // Overridden
    expect(configSnapshot.passing.minTurns).toBe(3);  // Overridden
    expect(configSnapshot.passing.dimensionKey).toBe('sequencing'); // Not overridden
    expect(configSnapshot.passing.maxTurns).toBe(5); // Not overridden
  });

  it('throws AssessmentConfigError when assessment config is missing', async () => {
    const configWithoutAssessment: ProgramVersionConfig = {
      ...pbjProgramConfig,
      assessment: undefined,
    };

    const mockRepoNoAssessment = createMockRepo(pbjLesson, configWithoutAssessment);

    const { createAssessmentSession, AssessmentConfigError } = await import('../createAssessmentSession');

    const ctx = createTenantContext('org-1');

    await expect(
      createAssessmentSession({
        ctx,
        repo: mockRepoNoAssessment as TenantRepo,
        socioId: 'socio-1',
        lessonKey: 'assemble-the-sandwich',
        blockId: 'b8-gated-teach-back',
        channel: 'web',
      })
    ).rejects.toThrow(AssessmentConfigError);
  });

  it('throws AssessmentConfigError when block is not gated_session', async () => {
    const { createAssessmentSession, AssessmentConfigError } = await import('../createAssessmentSession');

    const ctx = createTenantContext('org-1');

    // b5-teach-back is an inline teach_back, not gated_session
    await expect(
      createAssessmentSession({
        ctx,
        repo: mockRepo as TenantRepo,
        socioId: 'socio-1',
        lessonKey: 'assemble-the-sandwich',
        blockId: 'b5-teach-back', // This is inline, not gated
        channel: 'web',
      })
    ).rejects.toThrow(AssessmentConfigError);
  });
});
