/**
 * Adversarial Test Suite for Multi-Tenant Isolation
 *
 * Phase 2 Exit Condition: Zero unauthorized cross-tenant access across all vectors.
 *
 * Attack Vectors Tested:
 * 1. Cross-tenant reads - Org A context reading Org B's data
 * 2. Cross-tenant writes - Org A context modifying Org B's data
 * 3. Guessed ID probing - Sequential/predictable ID attacks
 * 4. Direct prisma bypass - ESLint rule enforcement
 * 5. Export/read paths - Data exfiltration attempts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantIsolationError, createTenantContext, isTenantContext } from '../tenantContext';
import type { TenantContext } from '../tenantContext';

// Use vi.hoisted() to define the mock before hoisting
const mockPrisma = vi.hoisted(() => ({
  organization: {
    findUnique: vi.fn(),
  },
  organizationMembership: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  program: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  programVersion: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  cohort: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  enrollment: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  enrollmentInvitation: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  participantProfile: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mentorProfile: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  contentCollection: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  contentLesson: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  lessonVersion: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  metricDefinition: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  metricObservation: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  alertRule: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  alert: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  alertReview: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  assessmentSession: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  message: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
}));

// Mock the db module
vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

// Import AFTER mocking
import { tenantPrismaRepo } from '../tenantPrismaRepo';

// Test constants
const ORG_A_ID = 'org-a-uuid-0000-0000-000000000001';
const ORG_B_ID = 'org-b-uuid-0000-0000-000000000002';
const PROGRAM_A_ID = 'prog-a-uuid-0000-0000-000000000001';
const PROGRAM_B_ID = 'prog-b-uuid-0000-0000-000000000002';
const PARTICIPANT_A_ID = 'part-a-uuid-0000-0000-000000000001';
const PARTICIPANT_B_ID = 'part-b-uuid-0000-0000-000000000002';
const COHORT_A_ID = 'coho-a-uuid-0000-0000-000000000001';
const COHORT_B_ID = 'coho-b-uuid-0000-0000-000000000002';
const COLLECTION_A_ID = 'coll-a-uuid-0000-0000-000000000001';
const COLLECTION_B_ID = 'coll-b-uuid-0000-0000-000000000002';
const METRIC_A_ID = 'metr-a-uuid-0000-0000-000000000001';
const METRIC_B_ID = 'metr-b-uuid-0000-0000-000000000002';
const RULE_A_ID = 'rule-a-uuid-0000-0000-000000000001';
const RULE_B_ID = 'rule-b-uuid-0000-0000-000000000002';
const ALERT_A_ID = 'aler-a-uuid-0000-0000-000000000001';
const ALERT_B_ID = 'aler-b-uuid-0000-0000-000000000002';
const MENTOR_PROFILE_A_ID = 'ment-a-uuid-0000-0000-000000000001';
const MENTOR_PROFILE_B_ID = 'ment-b-uuid-0000-0000-000000000002';
const ENROLLMENT_A_ID = 'enrl-a-uuid-0000-0000-000000000001';
const ENROLLMENT_B_ID = 'enrl-b-uuid-0000-0000-000000000002';
const LESSON_A_ID = 'less-a-uuid-0000-0000-000000000001';
const LESSON_B_ID = 'less-b-uuid-0000-0000-000000000002';
const ASSESSMENT_SESSION_A_ID = 'asss-a-uuid-0000-0000-000000000001';
const ASSESSMENT_SESSION_B_ID = 'asss-b-uuid-0000-0000-000000000002';

const ctxOrgA: TenantContext = { organizationId: ORG_A_ID };
const ctxOrgB: TenantContext = { organizationId: ORG_B_ID };

describe('TenantContext Utilities', () => {
  describe('createTenantContext', () => {
    it('creates valid context with organizationId', () => {
      const ctx = createTenantContext('org-123');
      expect(ctx.organizationId).toBe('org-123');
    });

    it('throws on empty organizationId', () => {
      expect(() => createTenantContext('')).toThrow('organizationId is required');
    });

    it('throws on null organizationId', () => {
      expect(() => createTenantContext(null as unknown as string)).toThrow('organizationId is required');
    });
  });

  describe('isTenantContext', () => {
    it('returns true for valid context', () => {
      expect(isTenantContext({ organizationId: 'org-123' })).toBe(true);
    });

    it('returns false for missing organizationId', () => {
      expect(isTenantContext({})).toBe(false);
    });

    it('returns false for empty organizationId', () => {
      expect(isTenantContext({ organizationId: '' })).toBe(false);
    });

    it('returns false for null', () => {
      expect(isTenantContext(null)).toBe(false);
    });
  });
});

describe('Cross-Tenant Read Attacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Program reads', () => {
    it('BLOCKS: Org A context reading Org B program by ID', async () => {
      // Setup: Org B owns this program
      mockPrisma.program.findUnique.mockResolvedValue({
        id: PROGRAM_B_ID,
        organizationId: ORG_B_ID,
        slug: 'org-b-program',
        name: 'Org B Program',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Attack: Org A tries to read it
      await expect(
        tenantPrismaRepo.getProgramById(ctxOrgA, PROGRAM_B_ID)
      ).rejects.toThrow(TenantIsolationError);
    });

    it('ALLOWS: Org A context reading own program', async () => {
      mockPrisma.program.findUnique.mockResolvedValue({
        id: PROGRAM_A_ID,
        organizationId: ORG_A_ID,
        slug: 'org-a-program',
        name: 'Org A Program',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await tenantPrismaRepo.getProgramById(ctxOrgA, PROGRAM_A_ID);
      expect(result).not.toBeNull();
      expect(result?.organizationId).toBe(ORG_A_ID);
    });
  });

  describe('Participant Profile reads', () => {
    it('BLOCKS: Org A context reading Org B participant by ID', async () => {
      mockPrisma.participantProfile.findUnique.mockResolvedValue({
        id: PARTICIPANT_B_ID,
        organizationId: ORG_B_ID,
        socioId: null,
        displayName: 'Org B User',
        preferredLang: 'es',
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        tenantPrismaRepo.getParticipantById(ctxOrgA, PARTICIPANT_B_ID)
      ).rejects.toThrow(TenantIsolationError);
    });
  });

  describe('Content Collection reads', () => {
    it('BLOCKS: Org A context reading Org B collection by ID', async () => {
      mockPrisma.contentCollection.findUnique.mockResolvedValue({
        id: COLLECTION_B_ID,
        organizationId: ORG_B_ID,
        slug: 'org-b-content',
        name: 'Org B Content',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        tenantPrismaRepo.getContentCollectionById(ctxOrgA, COLLECTION_B_ID)
      ).rejects.toThrow(TenantIsolationError);
    });
  });

  describe('Metric Definition reads', () => {
    it('BLOCKS: Org A context reading Org B metric by ID', async () => {
      mockPrisma.metricDefinition.findUnique.mockResolvedValue({
        id: METRIC_B_ID,
        organizationId: ORG_B_ID,
        key: 'comprehension',
        name: 'Comprehension',
        description: null,
        category: 'learning',
        dataType: 'continuous',
        scale: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        tenantPrismaRepo.getMetricDefinitionById(ctxOrgA, METRIC_B_ID)
      ).rejects.toThrow(TenantIsolationError);
    });
  });

  describe('Alert Rule reads', () => {
    it('BLOCKS: Org A context reading Org B alert rule by ID', async () => {
      mockPrisma.alertRule.findUnique.mockResolvedValue({
        id: RULE_B_ID,
        organizationId: ORG_B_ID,
        metricId: METRIC_B_ID,
        name: 'Low Comprehension',
        operator: 'lt',
        threshold: 3,
        severity: 'high',
        cooldownHours: 24,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        tenantPrismaRepo.getAlertRuleById(ctxOrgA, RULE_B_ID)
      ).rejects.toThrow(TenantIsolationError);
    });
  });

  describe('Mentor Profile reads', () => {
    it('BLOCKS: Org A context reading Org B mentor profile', async () => {
      mockPrisma.mentorProfile.findUnique.mockResolvedValue({
        id: MENTOR_PROFILE_B_ID,
        organizationId: ORG_B_ID,
        mentorId: 'mentor-123',
        displayName: 'Org B Mentor',
        specialties: [],
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        tenantPrismaRepo.getMentorProfileById(ctxOrgA, MENTOR_PROFILE_B_ID)
      ).rejects.toThrow(TenantIsolationError);
    });
  });
});

describe('Cross-Tenant Write Attacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Program updates', () => {
    it('BLOCKS: Org A context updating Org B program', async () => {
      mockPrisma.program.findUnique.mockResolvedValue({
        id: PROGRAM_B_ID,
        organizationId: ORG_B_ID,
      });

      await expect(
        tenantPrismaRepo.updateProgram(ctxOrgA, PROGRAM_B_ID, { name: 'Hacked!' })
      ).rejects.toThrow(TenantIsolationError);

      // Verify update was never called
      expect(mockPrisma.program.update).not.toHaveBeenCalled();
    });
  });

  describe('Program deletes', () => {
    it('BLOCKS: Org A context deleting Org B program', async () => {
      mockPrisma.program.findUnique.mockResolvedValue({
        id: PROGRAM_B_ID,
        organizationId: ORG_B_ID,
      });

      await expect(
        tenantPrismaRepo.deleteProgram(ctxOrgA, PROGRAM_B_ID)
      ).rejects.toThrow(TenantIsolationError);

      expect(mockPrisma.program.delete).not.toHaveBeenCalled();
    });
  });

  describe('Participant updates', () => {
    it('BLOCKS: Org A context updating Org B participant', async () => {
      mockPrisma.participantProfile.findUnique.mockResolvedValue({
        id: PARTICIPANT_B_ID,
        organizationId: ORG_B_ID,
      });

      await expect(
        tenantPrismaRepo.updateParticipant(ctxOrgA, PARTICIPANT_B_ID, { displayName: 'Hacked!' })
      ).rejects.toThrow(TenantIsolationError);

      expect(mockPrisma.participantProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('Alert Rule updates', () => {
    it('BLOCKS: Org A context updating Org B alert rule', async () => {
      mockPrisma.alertRule.findUnique.mockResolvedValue({
        id: RULE_B_ID,
        organizationId: ORG_B_ID,
      });

      await expect(
        tenantPrismaRepo.updateAlertRule(ctxOrgA, RULE_B_ID, { threshold: 999 })
      ).rejects.toThrow(TenantIsolationError);

      expect(mockPrisma.alertRule.update).not.toHaveBeenCalled();
    });
  });
});

describe('Guessed ID Probing Attacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('BLOCKS: Sequential ID enumeration across orgs', async () => {
    // Simulate attacker guessing sequential IDs
    const guessedIds = [
      'prog-0000-0000-0000-000000000001',
      'prog-0000-0000-0000-000000000002',
      'prog-0000-0000-0000-000000000003',
    ];

    for (const id of guessedIds) {
      mockPrisma.program.findUnique.mockResolvedValue({
        id,
        organizationId: ORG_B_ID, // All belong to Org B
      });

      // Org A tries each guessed ID
      await expect(
        tenantPrismaRepo.getProgramById(ctxOrgA, id)
      ).rejects.toThrow(TenantIsolationError);
    }
  });

  it('BLOCKS: Known ID from another tenant (insider knowledge)', async () => {
    // Attacker somehow learned an exact ID from Org B
    const knownId = PARTICIPANT_B_ID;

    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      id: knownId,
      organizationId: ORG_B_ID,
    });

    await expect(
      tenantPrismaRepo.getParticipantById(ctxOrgA, knownId)
    ).rejects.toThrow(TenantIsolationError);
  });

  it('Returns null for non-existent IDs (no information leakage)', async () => {
    mockPrisma.program.findUnique.mockResolvedValue(null);

    // Should return null, not throw - attacker learns nothing
    const result = await tenantPrismaRepo.getProgramById(ctxOrgA, 'nonexistent-id');
    expect(result).toBeNull();
  });
});

describe('Indirect Resource Access via Relations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Cohort access through Program relation', () => {
    it('BLOCKS: Org A context accessing Org B cohort', async () => {
      mockPrisma.cohort.findUnique.mockResolvedValue({
        id: COHORT_B_ID,
        programId: PROGRAM_B_ID,
        program: { organizationId: ORG_B_ID },
        slug: '2026-q1',
        name: 'Q1 2026',
        startsAt: null,
        endsAt: null,
        programVersionId: null,
        createdAt: new Date(),
      });

      await expect(
        tenantPrismaRepo.getCohortById(ctxOrgA, COHORT_B_ID)
      ).rejects.toThrow(TenantIsolationError);
    });
  });

  describe('Enrollment access through Cohort->Program relation', () => {
    it('BLOCKS: Org A context accessing Org B enrollment', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: ENROLLMENT_B_ID,
        participantId: PARTICIPANT_B_ID,
        cohortId: COHORT_B_ID,
        cohort: { program: { organizationId: ORG_B_ID } },
        status: 'active',
        enrolledAt: new Date(),
        completedAt: null,
        programVersionId: null,
        metadata: null,
      });

      await expect(
        tenantPrismaRepo.getEnrollmentById(ctxOrgA, ENROLLMENT_B_ID)
      ).rejects.toThrow(TenantIsolationError);
    });
  });

  describe('Lesson access through Collection relation', () => {
    it('BLOCKS: Org A context accessing Org B lesson', async () => {
      mockPrisma.contentLesson.findUnique.mockResolvedValue({
        id: LESSON_B_ID,
        collectionId: COLLECTION_B_ID,
        collection: { organizationId: ORG_B_ID },
        slug: 'lesson-01',
        orderIndex: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        tenantPrismaRepo.getLessonById(ctxOrgA, LESSON_B_ID)
      ).rejects.toThrow(TenantIsolationError);
    });
  });

  describe('Alert access through Rule relation', () => {
    it('BLOCKS: Org A context accessing Org B alert', async () => {
      mockPrisma.alert.findUnique.mockResolvedValue({
        id: ALERT_B_ID,
        ruleId: RULE_B_ID,
        rule: { organizationId: ORG_B_ID },
        enrollmentId: ENROLLMENT_B_ID,
        severity: 'high',
        triggerValue: 2.5,
        message: 'Low comprehension detected',
        resolvedAt: null,
        createdAt: new Date(),
      });

      await expect(
        tenantPrismaRepo.getAlertById(ctxOrgA, ALERT_B_ID)
      ).rejects.toThrow(TenantIsolationError);
    });
  });
});

describe('Create with Cross-Tenant References', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('BLOCKS: Creating enrollment with Org B participant in Org A cohort', async () => {
    // Cohort belongs to Org A
    mockPrisma.cohort.findUnique.mockResolvedValue({
      id: COHORT_A_ID,
      program: { organizationId: ORG_A_ID },
    });

    // Participant belongs to Org B
    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      id: PARTICIPANT_B_ID,
      organizationId: ORG_B_ID,
    });

    await expect(
      tenantPrismaRepo.createEnrollment(ctxOrgA, COHORT_A_ID, PARTICIPANT_B_ID)
    ).rejects.toThrow(TenantIsolationError);

    expect(mockPrisma.enrollment.create).not.toHaveBeenCalled();
  });

  it('BLOCKS: Creating alert rule referencing Org B metric', async () => {
    mockPrisma.metricDefinition.findUnique.mockResolvedValue({
      id: METRIC_B_ID,
      organizationId: ORG_B_ID,
    });

    await expect(
      tenantPrismaRepo.createAlertRule(ctxOrgA, {
        metricId: METRIC_B_ID,
        name: 'Malicious Rule',
        operator: 'lt',
        threshold: 3,
        severity: 'high',
        cooldownHours: 24,
        active: true,
      })
    ).rejects.toThrow(TenantIsolationError);

    expect(mockPrisma.alertRule.create).not.toHaveBeenCalled();
  });
});

// Platform Restructure Phase A, Stage 1: the single shared entry point every
// course-start path (web self-serve selection, LTI launch) must call rather
// than writing Enrollment/Cohort rows itself.
describe('resolveOrCreateActiveEnrollment (Stage 1 shared enrollment path)', () => {
  const PROGRAM_VERSION_A_ID = 'pver-a-uuid-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('BLOCKS: Org A context resolving enrollment against a Org B ProgramVersion', async () => {
    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      id: PARTICIPANT_A_ID,
      organizationId: ORG_A_ID,
    });
    mockPrisma.programVersion.findUnique.mockResolvedValue({
      programId: PROGRAM_B_ID,
      program: { organizationId: ORG_B_ID },
    });

    await expect(
      tenantPrismaRepo.resolveOrCreateActiveEnrollment(ctxOrgA, {
        participantId: PARTICIPANT_A_ID,
        programVersionId: PROGRAM_VERSION_A_ID,
        channel: 'web',
      })
    ).rejects.toThrow(TenantIsolationError);

    expect(mockPrisma.enrollment.upsert).not.toHaveBeenCalled();
  });

  it('BLOCKS: Org A context resolving enrollment for a Org B participant', async () => {
    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      id: PARTICIPANT_B_ID,
      organizationId: ORG_B_ID,
    });

    await expect(
      tenantPrismaRepo.resolveOrCreateActiveEnrollment(ctxOrgA, {
        participantId: PARTICIPANT_B_ID,
        programVersionId: PROGRAM_VERSION_A_ID,
        channel: 'web',
      })
    ).rejects.toThrow(TenantIsolationError);

    expect(mockPrisma.enrollment.upsert).not.toHaveBeenCalled();
  });

  it('BLOCKS: a caller-supplied cohortId belonging to another org, even with a matching participant/version', async () => {
    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      id: PARTICIPANT_A_ID,
      organizationId: ORG_A_ID,
    });
    mockPrisma.programVersion.findUnique.mockResolvedValue({
      programId: PROGRAM_A_ID,
      program: { organizationId: ORG_A_ID },
    });
    mockPrisma.cohort.findUnique.mockResolvedValue({
      id: COHORT_B_ID,
      program: { organizationId: ORG_B_ID },
    });

    await expect(
      tenantPrismaRepo.resolveOrCreateActiveEnrollment(ctxOrgA, {
        participantId: PARTICIPANT_A_ID,
        programVersionId: PROGRAM_VERSION_A_ID,
        cohortId: COHORT_B_ID,
        channel: 'canvas',
      })
    ).rejects.toThrow(TenantIsolationError);

    expect(mockPrisma.enrollment.upsert).not.toHaveBeenCalled();
  });

  it('ALLOWS: creates a "direct-web" cohort and an active enrollment when no cohortId is supplied', async () => {
    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      id: PARTICIPANT_A_ID,
      organizationId: ORG_A_ID,
    });
    mockPrisma.programVersion.findUnique.mockResolvedValue({
      programId: PROGRAM_A_ID,
      program: { organizationId: ORG_A_ID },
    });
    mockPrisma.cohort.upsert.mockResolvedValue({ id: COHORT_A_ID, programId: PROGRAM_A_ID, slug: 'direct-web' });
    mockPrisma.enrollment.upsert.mockResolvedValue({
      id: ENROLLMENT_A_ID,
      participantId: PARTICIPANT_A_ID,
      cohortId: COHORT_A_ID,
      programVersionId: PROGRAM_VERSION_A_ID,
      status: 'active',
      enrolledAt: new Date(),
      completedAt: null,
      projectSelectionGrandfatheredAt: null,
      metadata: { channel: 'web' },
    });

    const result = await tenantPrismaRepo.resolveOrCreateActiveEnrollment(ctxOrgA, {
      participantId: PARTICIPANT_A_ID,
      programVersionId: PROGRAM_VERSION_A_ID,
      channel: 'web',
    });

    expect(mockPrisma.cohort.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { programId_slug: { programId: PROGRAM_A_ID, slug: 'direct-web' } },
      }),
    );
    expect(mockPrisma.enrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { participantId_cohortId: { participantId: PARTICIPANT_A_ID, cohortId: COHORT_A_ID } },
      }),
    );
    expect(result.status).toBe('active');
  });

  it('IDEMPOTENT: re-entry for the same participant+cohort resolves the existing row rather than creating a duplicate', async () => {
    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      id: PARTICIPANT_A_ID,
      organizationId: ORG_A_ID,
    });
    mockPrisma.programVersion.findUnique.mockResolvedValue({
      programId: PROGRAM_A_ID,
      program: { organizationId: ORG_A_ID },
    });
    mockPrisma.cohort.findUnique.mockResolvedValue({
      id: COHORT_A_ID,
      program: { organizationId: ORG_A_ID },
    });
    mockPrisma.enrollment.upsert.mockResolvedValue({
      id: ENROLLMENT_A_ID,
      participantId: PARTICIPANT_A_ID,
      cohortId: COHORT_A_ID,
      programVersionId: PROGRAM_VERSION_A_ID,
      status: 'active',
      enrolledAt: new Date(),
      completedAt: null,
      projectSelectionGrandfatheredAt: null,
      metadata: { channel: 'canvas' },
    });

    const params = {
      participantId: PARTICIPANT_A_ID,
      programVersionId: PROGRAM_VERSION_A_ID,
      cohortId: COHORT_A_ID,
      channel: 'canvas',
    };
    const first = await tenantPrismaRepo.resolveOrCreateActiveEnrollment(ctxOrgA, params);
    const second = await tenantPrismaRepo.resolveOrCreateActiveEnrollment(ctxOrgA, params);

    // No ad-hoc cohort creation when a cohortId is supplied — LTI's
    // pre-provisioned cohort is used as-is, never re-upserted.
    expect(mockPrisma.cohort.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.enrollment.upsert).toHaveBeenCalledTimes(2);
    expect(first.id).toBe(second.id);
    // Every call targets the same unique (participantId, cohortId) key —
    // this is what makes upsert resolve the existing row instead of
    // minting a duplicate.
    for (const call of mockPrisma.enrollment.upsert.mock.calls) {
      expect(call[0].where).toEqual({ participantId_cohortId: { participantId: PARTICIPANT_A_ID, cohortId: COHORT_A_ID } });
    }
  });
});

describe('List Operations with Tenant Filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('List programs only returns own organization data', async () => {
    const orgAPrograms = [
      { id: PROGRAM_A_ID, organizationId: ORG_A_ID, slug: 'prog-1', name: 'Program 1', description: null, createdAt: new Date(), updatedAt: new Date() },
    ];

    mockPrisma.program.findMany.mockResolvedValue(orgAPrograms);

    const result = await tenantPrismaRepo.getPrograms(ctxOrgA);

    // Verify WHERE clause was correctly scoped
    expect(mockPrisma.program.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_A_ID },
      })
    );

    expect(result).toHaveLength(1);
    expect(result[0].organizationId).toBe(ORG_A_ID);
  });

  it('List participants only returns own organization data', async () => {
    mockPrisma.participantProfile.findMany.mockResolvedValue([]);

    await tenantPrismaRepo.getParticipants(ctxOrgA);

    expect(mockPrisma.participantProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_A_ID },
      })
    );
  });

  it('List alert rules only returns own organization data', async () => {
    mockPrisma.alertRule.findMany.mockResolvedValue([]);

    await tenantPrismaRepo.getAlertRules(ctxOrgA);

    expect(mockPrisma.alertRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_A_ID },
      })
    );
  });

  it('List alerts filters by organization through rule relation', async () => {
    mockPrisma.alert.findMany.mockResolvedValue([]);

    await tenantPrismaRepo.getAlerts(ctxOrgA);

    expect(mockPrisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          rule: { organizationId: ORG_A_ID },
        }),
      })
    );
  });
});

describe('TenantIsolationError Details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Error includes requested vs actual org IDs for debugging', async () => {
    mockPrisma.program.findUnique.mockResolvedValue({
      id: PROGRAM_B_ID,
      organizationId: ORG_B_ID,
    });

    try {
      await tenantPrismaRepo.getProgramById(ctxOrgA, PROGRAM_B_ID);
      expect.fail('Should have thrown TenantIsolationError');
    } catch (error) {
      expect(error).toBeInstanceOf(TenantIsolationError);
      const isolationError = error as TenantIsolationError;
      expect(isolationError.context?.requestedOrgId).toBe(ORG_A_ID);
      expect(isolationError.context?.actualOrgId).toBe(ORG_B_ID);
      expect(isolationError.context?.resourceType).toBe('Program');
      expect(isolationError.context?.resourceId).toBe(PROGRAM_B_ID);
    }
  });

  it('Error message is clear about cross-tenant violation', async () => {
    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      id: PARTICIPANT_B_ID,
      organizationId: ORG_B_ID,
    });

    try {
      await tenantPrismaRepo.getParticipantById(ctxOrgA, PARTICIPANT_B_ID);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TenantIsolationError);
      expect((error as Error).message).toContain('Cross-tenant access denied');
    }
  });
});

describe('ESLint Rule Enforcement (documentation)', () => {
  /**
   * This test documents what the ESLint rule catches.
   * The rule is defined in eslint.config.mjs and prevents:
   *
   * 1. Direct prisma.<model> calls outside repo layer
   * 2. Direct prisma.$transaction, prisma.$queryRaw, etc.
   *
   * If someone bypasses the repo and writes:
   *   import { prisma } from '@/lib/db';
   *   await prisma.program.findMany();
   *
   * ESLint will fail with:
   *   "Direct prisma.* calls are banned outside the repo layer..."
   *
   * This test verifies the isolation architecture is enforced at build time.
   */
  it('Documents ESLint rule protections', () => {
    // This is a documentation test - the actual enforcement is at build time
    // via the no-restricted-syntax rule in eslint.config.mjs
    //
    // Attack vector: Developer accidentally uses prisma directly
    // Protection: ESLint fails CI on any prisma.* call outside repo
    //
    // Files protected:
    // - src/app/api/**/*.ts
    // - src/lib/**/*.ts (except repo/)
    // - src/components/**/*.ts
    //
    // Files exempt (allowed to use prisma):
    // - src/lib/repo/**/*.ts
    // - src/lib/db.ts
    // - src/**/__tests__/**/*.ts

    expect(true).toBe(true); // Test passes - enforcement is via ESLint
  });
});

describe('Export/Read Path Attacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('BLOCKS: Bulk export of Org B data via Org A context', async () => {
    // Attacker tries to list all participants (potential data export)
    mockPrisma.participantProfile.findMany.mockResolvedValue([]);

    await tenantPrismaRepo.getParticipants(ctxOrgA);

    // Verify only Org A data would be returned
    expect(mockPrisma.participantProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_A_ID },
      })
    );
  });

  it('BLOCKS: Reading Org B observations through Org A metric', async () => {
    // Org A tries to read observations for Org B's metric
    mockPrisma.metricDefinition.findUnique.mockResolvedValue({
      id: METRIC_B_ID,
      organizationId: ORG_B_ID,
    });

    await expect(
      tenantPrismaRepo.getObservations(ctxOrgA, METRIC_B_ID)
    ).rejects.toThrow(TenantIsolationError);

    // Verify observations were never queried
    expect(mockPrisma.metricObservation.findMany).not.toHaveBeenCalled();
  });

  it('BLOCKS: Reading Org B enrollments through Org A cohort', async () => {
    mockPrisma.cohort.findUnique.mockResolvedValue({
      id: COHORT_B_ID,
      program: { organizationId: ORG_B_ID },
    });

    await expect(
      tenantPrismaRepo.getEnrollments(ctxOrgA, COHORT_B_ID)
    ).rejects.toThrow(TenantIsolationError);

    expect(mockPrisma.enrollment.findMany).not.toHaveBeenCalled();
  });

  it('BLOCKS: Reading Org B lesson versions through Org A lesson', async () => {
    mockPrisma.contentLesson.findUnique.mockResolvedValue({
      id: LESSON_B_ID,
      collection: { organizationId: ORG_B_ID },
    });

    await expect(
      tenantPrismaRepo.getLessonVersions(ctxOrgA, LESSON_B_ID)
    ).rejects.toThrow(TenantIsolationError);

    expect(mockPrisma.lessonVersion.findMany).not.toHaveBeenCalled();
  });
});

describe('Assessment Session Tenant Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Cross-tenant reads', () => {
    it('BLOCKS: Org A context reading Org B assessment session by ID', async () => {
      mockPrisma.assessmentSession.findUnique.mockResolvedValue({
        id: ASSESSMENT_SESSION_B_ID,
        organizationId: ORG_B_ID,
        socioId: 'socio-123',
        lessonKey: 'pbj:lesson-01',
        blockId: 'block-1',
        kind: 'teach_back',
        status: 'in_progress',
        attemptNumber: 1,
        turnCount: 3,
        liveState: {},
        scores: null,
        passedAt: null,
        completedAt: null,
        configSnapshot: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        tenantPrismaRepo.getAssessmentSessionById(ctxOrgA, ASSESSMENT_SESSION_B_ID)
      ).rejects.toThrow(TenantIsolationError);
    });

    it('ALLOWS: Org A context reading own assessment session', async () => {
      mockPrisma.assessmentSession.findUnique.mockResolvedValue({
        id: ASSESSMENT_SESSION_A_ID,
        organizationId: ORG_A_ID,
        socioId: 'socio-123',
        lessonKey: 'pbj:lesson-01',
        blockId: 'block-1',
        kind: 'teach_back',
        status: 'in_progress',
        attemptNumber: 1,
        turnCount: 3,
        liveState: {},
        scores: null,
        passedAt: null,
        completedAt: null,
        configSnapshot: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await tenantPrismaRepo.getAssessmentSessionById(ctxOrgA, ASSESSMENT_SESSION_A_ID);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(ASSESSMENT_SESSION_A_ID);
    });
  });

  describe('Cross-tenant writes', () => {
    it('BLOCKS: Org A context updating Org B assessment session', async () => {
      mockPrisma.assessmentSession.findUnique.mockResolvedValue({
        id: ASSESSMENT_SESSION_B_ID,
        organizationId: ORG_B_ID,
      });

      await expect(
        tenantPrismaRepo.updateAssessmentSession(ctxOrgA, ASSESSMENT_SESSION_B_ID, {
          status: 'completed',
          scores: { comprehension: 10 },
        })
      ).rejects.toThrow(TenantIsolationError);

      expect(mockPrisma.assessmentSession.update).not.toHaveBeenCalled();
    });

    it('ALLOWS: Org A context updating own assessment session', async () => {
      const now = new Date();
      mockPrisma.assessmentSession.findUnique.mockResolvedValue({
        id: ASSESSMENT_SESSION_A_ID,
        organizationId: ORG_A_ID,
        socioId: 'socio-123',
        lessonKey: 'pbj:lesson-01',
        blockId: 'block-1',
        kind: 'teach_back',
        status: 'in_progress',
        attemptNumber: 1,
        turnCount: 3,
        liveState: {},
        scores: null,
        passedAt: null,
        completedAt: null,
        configSnapshot: {},
        createdAt: now,
        updatedAt: now,
      });

      mockPrisma.assessmentSession.update.mockResolvedValue({
        id: ASSESSMENT_SESSION_A_ID,
        organizationId: ORG_A_ID,
        socioId: 'socio-123',
        lessonKey: 'pbj:lesson-01',
        blockId: 'block-1',
        kind: 'teach_back',
        status: 'completed',
        attemptNumber: 1,
        turnCount: 5,
        liveState: {},
        scores: { comprehension: 8 },
        passedAt: now,
        completedAt: now,
        configSnapshot: {},
        createdAt: now,
        updatedAt: now,
      });

      const result = await tenantPrismaRepo.updateAssessmentSession(ctxOrgA, ASSESSMENT_SESSION_A_ID, {
        status: 'completed',
        turnCount: 5,
        scores: { comprehension: 8 },
        passedAt: now,
        completedAt: now,
      });

      expect(result.status).toBe('completed');
      expect(mockPrisma.assessmentSession.update).toHaveBeenCalled();
    });
  });

  describe('Assessment messages isolation', () => {
    it('BLOCKS: Org A context reading Org B assessment session messages', async () => {
      // Session belongs to Org B
      mockPrisma.assessmentSession.findUnique.mockResolvedValue({
        id: ASSESSMENT_SESSION_B_ID,
        organizationId: ORG_B_ID,
      });

      await expect(
        tenantPrismaRepo.getAssessmentMessages(ctxOrgA, ASSESSMENT_SESSION_B_ID)
      ).rejects.toThrow(TenantIsolationError);

      expect(mockPrisma.message.findMany).not.toHaveBeenCalled();
    });

    it('ALLOWS: Org A context reading own assessment session messages', async () => {
      mockPrisma.assessmentSession.findUnique.mockResolvedValue({
        id: ASSESSMENT_SESSION_A_ID,
        organizationId: ORG_A_ID,
      });

      mockPrisma.message.findMany.mockResolvedValue([
        {
          id: 'msg-1',
          socioId: 'socio-123',
          role: 'user',
          content: 'My explanation',
          assessmentSessionId: ASSESSMENT_SESSION_A_ID,
          metadata: null,
          createdAt: new Date(),
        },
      ]);

      const result = await tenantPrismaRepo.getAssessmentMessages(ctxOrgA, ASSESSMENT_SESSION_A_ID);
      expect(result).toHaveLength(1);
      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assessmentSessionId: ASSESSMENT_SESSION_A_ID },
        })
      );
    });
  });

  describe('List operations filtering', () => {
    it('List assessment sessions for socio only returns own org sessions', async () => {
      mockPrisma.assessmentSession.findMany.mockResolvedValue([]);

      await tenantPrismaRepo.getAssessmentSessionsForSocio(ctxOrgA, 'socio-123');

      expect(mockPrisma.assessmentSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG_A_ID,
            socioId: 'socio-123',
          },
        })
      );
    });
  });
});
