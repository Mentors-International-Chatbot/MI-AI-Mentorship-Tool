import { prisma } from '@/lib/db';
import type { TenantContext } from './tenantContext';
import { TenantIsolationError } from './tenantContext';
import type {
  TenantRepo,
  Organization,
  OrganizationMembership,
  Program,
  ProgramVersion,
  Cohort,
  Enrollment,
  EnrollmentInvitation,
  ParticipantProfile,
  MentorProfile,
  MentoringRelationship,
  ContentCollection,
  ContentLesson,
  LessonVersion,
  MetricDefinition,
  MetricObservation,
  AlertRule,
  Alert,
  AlertReview,
  ObservationSource,
} from './tenantRepo.types';
import type {
  Organization as PrismaOrganization,
  OrganizationMembership as PrismaOrganizationMembership,
  Program as PrismaProgram,
  ProgramVersion as PrismaProgramVersion,
  Cohort as PrismaCohort,
  Enrollment as PrismaEnrollment,
  EnrollmentInvitation as PrismaEnrollmentInvitation,
  ParticipantProfile as PrismaParticipantProfile,
  MentorProfile as PrismaMentorProfile,
  MentoringRelationship as PrismaMentoringRelationship,
  ContentCollection as PrismaContentCollection,
  ContentLesson as PrismaContentLesson,
  LessonVersion as PrismaLessonVersion,
  MetricDefinition as PrismaMetricDefinition,
  MetricObservation as PrismaMetricObservation,
  AlertRule as PrismaAlertRule,
  Alert as PrismaAlert,
  AlertReview as PrismaAlertReview,
} from '@prisma/client';
import { randomBytes } from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// Mapping Functions (Prisma → App types)
// ═══════════════════════════════════════════════════════════════════════════

function toOrganization(p: PrismaOrganization): Organization {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    settings: p.settings as Record<string, unknown> | null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toMembership(p: PrismaOrganizationMembership): OrganizationMembership {
  return {
    id: p.id,
    organizationId: p.organizationId,
    userId: p.userId,
    role: p.role as OrganizationMembership['role'],
    createdAt: p.createdAt,
  };
}

function toProgram(p: PrismaProgram): Program {
  return {
    id: p.id,
    organizationId: p.organizationId,
    slug: p.slug,
    name: p.name,
    description: p.description,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toProgramVersion(p: PrismaProgramVersion): ProgramVersion {
  return {
    id: p.id,
    programId: p.programId,
    version: p.version,
    config: p.config as Record<string, unknown>,
    active: p.active,
    publishedAt: p.publishedAt,
    createdAt: p.createdAt,
  };
}

function toCohort(p: PrismaCohort): Cohort {
  return {
    id: p.id,
    programId: p.programId,
    programVersionId: p.programVersionId,
    slug: p.slug,
    name: p.name,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    createdAt: p.createdAt,
  };
}

function toEnrollment(p: PrismaEnrollment): Enrollment {
  return {
    id: p.id,
    participantId: p.participantId,
    cohortId: p.cohortId,
    programVersionId: p.programVersionId,
    status: p.status as Enrollment['status'],
    enrolledAt: p.enrolledAt,
    completedAt: p.completedAt,
    metadata: p.metadata as Record<string, unknown> | null,
  };
}

function toInvitation(p: PrismaEnrollmentInvitation): EnrollmentInvitation {
  return {
    id: p.id,
    cohortId: p.cohortId,
    channel: p.channel,
    target: p.target,
    token: p.token,
    expiresAt: p.expiresAt,
    usedAt: p.usedAt,
    createdAt: p.createdAt,
  };
}

function toParticipantProfile(p: PrismaParticipantProfile): ParticipantProfile {
  return {
    id: p.id,
    organizationId: p.organizationId,
    socioId: p.socioId,
    displayName: p.displayName,
    preferredLang: p.preferredLang,
    metadata: p.metadata as Record<string, unknown> | null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toMentorProfile(p: PrismaMentorProfile): MentorProfile {
  return {
    id: p.id,
    organizationId: p.organizationId,
    mentorId: p.mentorId,
    displayName: p.displayName,
    specialties: p.specialties,
    metadata: p.metadata as Record<string, unknown> | null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toMentoringRelationship(p: PrismaMentoringRelationship): MentoringRelationship {
  return {
    id: p.id,
    mentorId: p.mentorId,
    participantId: p.participantId,
    role: p.role as MentoringRelationship['role'],
    activeFrom: p.activeFrom,
    activeUntil: p.activeUntil,
    createdAt: p.createdAt,
  };
}

function toContentCollection(p: PrismaContentCollection): ContentCollection {
  return {
    id: p.id,
    organizationId: p.organizationId,
    slug: p.slug,
    name: p.name,
    description: p.description,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toContentLesson(p: PrismaContentLesson): ContentLesson {
  return {
    id: p.id,
    collectionId: p.collectionId,
    slug: p.slug,
    orderIndex: p.orderIndex,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toLessonVersion(p: PrismaLessonVersion): LessonVersion {
  return {
    id: p.id,
    lessonId: p.lessonId,
    version: p.version,
    lang: p.lang,
    title: p.title,
    body: p.body as Record<string, unknown>,
    active: p.active,
    publishedAt: p.publishedAt,
    createdAt: p.createdAt,
  };
}

function toMetricDefinition(p: PrismaMetricDefinition): MetricDefinition {
  return {
    id: p.id,
    organizationId: p.organizationId,
    key: p.key,
    name: p.name,
    description: p.description,
    category: p.category,
    dataType: p.dataType,
    scale: p.scale as Record<string, unknown> | null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toMetricObservation(p: PrismaMetricObservation): MetricObservation {
  return {
    id: p.id,
    metricId: p.metricId,
    enrollmentId: p.enrollmentId,
    signalType: p.signalType,
    value: p.value,
    confidence: p.confidence,
    evidenceRefs: p.evidenceRefs as Record<string, unknown> | null,
    modelVersion: p.modelVersion,
    promptVersion: p.promptVersion,
    verificationStatus: p.verificationStatus,
    source: p.source as ObservationSource,
    observedAt: p.observedAt,
    createdAt: p.createdAt,
  };
}

function toAlertRule(p: PrismaAlertRule): AlertRule {
  return {
    id: p.id,
    organizationId: p.organizationId,
    metricId: p.metricId,
    name: p.name,
    operator: p.operator,
    threshold: p.threshold,
    severity: p.severity,
    cooldownHours: p.cooldownHours,
    active: p.active,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toAlert(p: PrismaAlert): Alert {
  return {
    id: p.id,
    ruleId: p.ruleId,
    enrollmentId: p.enrollmentId,
    severity: p.severity,
    triggerValue: p.triggerValue,
    message: p.message,
    resolvedAt: p.resolvedAt,
    createdAt: p.createdAt,
  };
}

function toAlertReview(p: PrismaAlertReview): AlertReview {
  return {
    id: p.id,
    alertId: p.alertId,
    reviewerId: p.reviewerId,
    action: p.action,
    notes: p.notes,
    createdAt: p.createdAt,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tenant Isolation Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifies that a program belongs to the tenant's organization.
 * Throws TenantIsolationError if not.
 */
async function verifyProgramOwnership(ctx: TenantContext, programId: string): Promise<void> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { organizationId: true },
  });
  if (!program) {
    throw new TenantIsolationError('Program not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'Program',
      resourceId: programId,
    });
  }
  if (program.organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: program.organizationId,
      resourceType: 'Program',
      resourceId: programId,
    });
  }
}

/**
 * Verifies that a cohort belongs to a program in the tenant's organization.
 */
async function verifyCohortOwnership(ctx: TenantContext, cohortId: string): Promise<void> {
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    select: { program: { select: { organizationId: true } } },
  });
  if (!cohort) {
    throw new TenantIsolationError('Cohort not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'Cohort',
      resourceId: cohortId,
    });
  }
  if (cohort.program.organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: cohort.program.organizationId,
      resourceType: 'Cohort',
      resourceId: cohortId,
    });
  }
}

/**
 * Verifies that a participant belongs to the tenant's organization.
 */
async function verifyParticipantOwnership(ctx: TenantContext, participantId: string): Promise<void> {
  const participant = await prisma.participantProfile.findUnique({
    where: { id: participantId },
    select: { organizationId: true },
  });
  if (!participant) {
    throw new TenantIsolationError('Participant not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'ParticipantProfile',
      resourceId: participantId,
    });
  }
  if (participant.organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: participant.organizationId,
      resourceType: 'ParticipantProfile',
      resourceId: participantId,
    });
  }
}

/**
 * Verifies that a mentor profile belongs to the tenant's organization.
 */
async function verifyMentorProfileOwnership(ctx: TenantContext, profileId: string): Promise<void> {
  const profile = await prisma.mentorProfile.findUnique({
    where: { id: profileId },
    select: { organizationId: true },
  });
  if (!profile) {
    throw new TenantIsolationError('MentorProfile not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'MentorProfile',
      resourceId: profileId,
    });
  }
  if (profile.organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: profile.organizationId,
      resourceType: 'MentorProfile',
      resourceId: profileId,
    });
  }
}

/**
 * Verifies that a content collection belongs to the tenant's organization.
 */
async function verifyCollectionOwnership(ctx: TenantContext, collectionId: string): Promise<void> {
  const collection = await prisma.contentCollection.findUnique({
    where: { id: collectionId },
    select: { organizationId: true },
  });
  if (!collection) {
    throw new TenantIsolationError('ContentCollection not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'ContentCollection',
      resourceId: collectionId,
    });
  }
  if (collection.organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: collection.organizationId,
      resourceType: 'ContentCollection',
      resourceId: collectionId,
    });
  }
}

/**
 * Verifies that a lesson belongs to a collection in the tenant's organization.
 */
async function verifyLessonOwnership(ctx: TenantContext, lessonId: string): Promise<void> {
  const lesson = await prisma.contentLesson.findUnique({
    where: { id: lessonId },
    select: { collection: { select: { organizationId: true } } },
  });
  if (!lesson) {
    throw new TenantIsolationError('ContentLesson not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'ContentLesson',
      resourceId: lessonId,
    });
  }
  if (lesson.collection.organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: lesson.collection.organizationId,
      resourceType: 'ContentLesson',
      resourceId: lessonId,
    });
  }
}

/**
 * Verifies that a metric definition belongs to the tenant's organization.
 */
async function verifyMetricOwnership(ctx: TenantContext, metricId: string): Promise<void> {
  const metric = await prisma.metricDefinition.findUnique({
    where: { id: metricId },
    select: { organizationId: true },
  });
  if (!metric) {
    throw new TenantIsolationError('MetricDefinition not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'MetricDefinition',
      resourceId: metricId,
    });
  }
  if (metric.organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: metric.organizationId,
      resourceType: 'MetricDefinition',
      resourceId: metricId,
    });
  }
}

/**
 * Verifies that an alert rule belongs to the tenant's organization.
 */
async function verifyAlertRuleOwnership(ctx: TenantContext, ruleId: string): Promise<void> {
  const rule = await prisma.alertRule.findUnique({
    where: { id: ruleId },
    select: { organizationId: true },
  });
  if (!rule) {
    throw new TenantIsolationError('AlertRule not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'AlertRule',
      resourceId: ruleId,
    });
  }
  if (rule.organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: rule.organizationId,
      resourceType: 'AlertRule',
      resourceId: ruleId,
    });
  }
}

/**
 * Verifies that an alert belongs to a rule in the tenant's organization.
 */
async function verifyAlertOwnership(ctx: TenantContext, alertId: string): Promise<void> {
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    select: { rule: { select: { organizationId: true } } },
  });
  if (!alert) {
    throw new TenantIsolationError('Alert not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'Alert',
      resourceId: alertId,
    });
  }
  if (alert.rule.organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: alert.rule.organizationId,
      resourceType: 'Alert',
      resourceId: alertId,
    });
  }
}

/**
 * Verifies that an enrollment belongs to a cohort in the tenant's organization.
 */
async function verifyEnrollmentOwnership(ctx: TenantContext, enrollmentId: string): Promise<void> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { cohort: { select: { program: { select: { organizationId: true } } } } },
  });
  if (!enrollment) {
    throw new TenantIsolationError('Enrollment not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'Enrollment',
      resourceId: enrollmentId,
    });
  }
  if (enrollment.cohort.program.organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: enrollment.cohort.program.organizationId,
      resourceType: 'Enrollment',
      resourceId: enrollmentId,
    });
  }
}

/**
 * Verifies that a program version belongs to a program in the tenant's organization.
 */
async function verifyProgramVersionOwnership(ctx: TenantContext, versionId: string): Promise<void> {
  const version = await prisma.programVersion.findUnique({
    where: { id: versionId },
    select: { program: { select: { organizationId: true } } },
  });
  if (!version) {
    throw new TenantIsolationError('ProgramVersion not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'ProgramVersion',
      resourceId: versionId,
    });
  }
  if (version.program.organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: version.program.organizationId,
      resourceType: 'ProgramVersion',
      resourceId: versionId,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TenantRepo Implementation
// ═══════════════════════════════════════════════════════════════════════════

export const tenantPrismaRepo: TenantRepo = {
  // ─── Organization ──────────────────────────────────────────────────────────
  async getOrganization(ctx) {
    const org = await prisma.organization.findUnique({
      where: { id: ctx.organizationId },
    });
    return org ? toOrganization(org) : null;
  },

  async getOrganizationBySlug(slug) {
    const org = await prisma.organization.findUnique({
      where: { slug },
    });
    return org ? toOrganization(org) : null;
  },

  // ─── Organization Membership ───────────────────────────────────────────────
  async getMemberships(ctx) {
    const memberships = await prisma.organizationMembership.findMany({
      where: { organizationId: ctx.organizationId },
    });
    return memberships.map(toMembership);
  },

  async getMembershipByUserId(ctx, userId) {
    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: ctx.organizationId, userId } },
    });
    return membership ? toMembership(membership) : null;
  },

  async addMembership(ctx, userId, role) {
    const membership = await prisma.organizationMembership.create({
      data: { organizationId: ctx.organizationId, userId, role },
    });
    return toMembership(membership);
  },

  async removeMembership(ctx, membershipId) {
    // Verify ownership first
    const existing = await prisma.organizationMembership.findUnique({
      where: { id: membershipId },
      select: { organizationId: true },
    });
    if (!existing) return;
    if (existing.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: existing.organizationId,
        resourceType: 'OrganizationMembership',
        resourceId: membershipId,
      });
    }
    await prisma.organizationMembership.delete({ where: { id: membershipId } });
  },

  // ─── Programs ──────────────────────────────────────────────────────────────
  async getPrograms(ctx) {
    const programs = await prisma.program.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return programs.map(toProgram);
  },

  async getProgramById(ctx, programId) {
    const program = await prisma.program.findUnique({
      where: { id: programId },
    });
    if (!program) return null;
    if (program.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: program.organizationId,
        resourceType: 'Program',
        resourceId: programId,
      });
    }
    return toProgram(program);
  },

  async getProgramBySlug(ctx, slug) {
    const program = await prisma.program.findUnique({
      where: { organizationId_slug: { organizationId: ctx.organizationId, slug } },
    });
    return program ? toProgram(program) : null;
  },

  async createProgram(ctx, data) {
    const program = await prisma.program.create({
      data: {
        organizationId: ctx.organizationId,
        slug: data.slug,
        name: data.name,
        description: data.description,
      },
    });
    return toProgram(program);
  },

  async updateProgram(ctx, programId, data) {
    await verifyProgramOwnership(ctx, programId);
    const program = await prisma.program.update({
      where: { id: programId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
      },
    });
    return toProgram(program);
  },

  async deleteProgram(ctx, programId) {
    await verifyProgramOwnership(ctx, programId);
    await prisma.program.delete({ where: { id: programId } });
  },

  // ─── Program Versions ──────────────────────────────────────────────────────
  async getProgramVersions(ctx, programId) {
    await verifyProgramOwnership(ctx, programId);
    const versions = await prisma.programVersion.findMany({
      where: { programId },
      orderBy: { createdAt: 'desc' },
    });
    return versions.map(toProgramVersion);
  },

  async getActiveProgramVersion(ctx, programId) {
    await verifyProgramOwnership(ctx, programId);
    const version = await prisma.programVersion.findFirst({
      where: { programId, active: true },
    });
    return version ? toProgramVersion(version) : null;
  },

  async createProgramVersion(ctx, programId, data) {
    await verifyProgramOwnership(ctx, programId);
    const version = await prisma.programVersion.create({
      data: {
        programId,
        version: data.version,
        config: data.config as object,
        active: data.active,
        publishedAt: data.publishedAt,
      },
    });
    return toProgramVersion(version);
  },

  async activateProgramVersion(ctx, versionId) {
    await verifyProgramVersionOwnership(ctx, versionId);
    const version = await prisma.programVersion.findUnique({
      where: { id: versionId },
      select: { programId: true },
    });
    if (!version) throw new Error('Version not found');

    // Deactivate all other versions of this program, activate this one
    await prisma.$transaction([
      prisma.programVersion.updateMany({
        where: { programId: version.programId },
        data: { active: false },
      }),
      prisma.programVersion.update({
        where: { id: versionId },
        data: { active: true, publishedAt: new Date() },
      }),
    ]);

    const updated = await prisma.programVersion.findUnique({ where: { id: versionId } });
    return toProgramVersion(updated!);
  },

  // ─── Cohorts ───────────────────────────────────────────────────────────────
  async getCohorts(ctx, programId) {
    await verifyProgramOwnership(ctx, programId);
    const cohorts = await prisma.cohort.findMany({
      where: { programId },
      orderBy: { createdAt: 'desc' },
    });
    return cohorts.map(toCohort);
  },

  async getCohortById(ctx, cohortId) {
    const cohort = await prisma.cohort.findUnique({
      where: { id: cohortId },
      include: { program: { select: { organizationId: true } } },
    });
    if (!cohort) return null;
    if (cohort.program.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: cohort.program.organizationId,
        resourceType: 'Cohort',
        resourceId: cohortId,
      });
    }
    return toCohort(cohort);
  },

  async createCohort(ctx, programId, data) {
    await verifyProgramOwnership(ctx, programId);
    const cohort = await prisma.cohort.create({
      data: {
        programId,
        programVersionId: data.programVersionId,
        slug: data.slug,
        name: data.name,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
      },
    });
    return toCohort(cohort);
  },

  async updateCohort(ctx, cohortId, data) {
    await verifyCohortOwnership(ctx, cohortId);
    const cohort = await prisma.cohort.update({
      where: { id: cohortId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.startsAt !== undefined && { startsAt: data.startsAt }),
        ...(data.endsAt !== undefined && { endsAt: data.endsAt }),
      },
    });
    return toCohort(cohort);
  },

  // ─── Enrollments ───────────────────────────────────────────────────────────
  async getEnrollments(ctx, cohortId) {
    await verifyCohortOwnership(ctx, cohortId);
    const enrollments = await prisma.enrollment.findMany({
      where: { cohortId },
      orderBy: { enrolledAt: 'desc' },
    });
    return enrollments.map(toEnrollment);
  },

  async getEnrollmentById(ctx, enrollmentId) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { cohort: { select: { program: { select: { organizationId: true } } } } },
    });
    if (!enrollment) return null;
    if (enrollment.cohort.program.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: enrollment.cohort.program.organizationId,
        resourceType: 'Enrollment',
        resourceId: enrollmentId,
      });
    }
    return toEnrollment(enrollment);
  },

  async getEnrollmentsByParticipant(ctx, participantId) {
    await verifyParticipantOwnership(ctx, participantId);
    const enrollments = await prisma.enrollment.findMany({
      where: {
        participantId,
        cohort: { program: { organizationId: ctx.organizationId } },
      },
      orderBy: { enrolledAt: 'desc' },
    });
    return enrollments.map(toEnrollment);
  },

  async createEnrollment(ctx, cohortId, participantId) {
    await verifyCohortOwnership(ctx, cohortId);
    await verifyParticipantOwnership(ctx, participantId);
    const enrollment = await prisma.enrollment.create({
      data: { cohortId, participantId },
    });
    return toEnrollment(enrollment);
  },

  async updateEnrollmentStatus(ctx, enrollmentId, status) {
    await verifyEnrollmentOwnership(ctx, enrollmentId);
    const enrollment = await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: {
        status,
        ...(status === 'completed' ? { completedAt: new Date() } : {}),
      },
    });
    return toEnrollment(enrollment);
  },

  // ─── Enrollment Invitations ────────────────────────────────────────────────
  async createInvitation(ctx, cohortId, channel, target, expiresAt) {
    await verifyCohortOwnership(ctx, cohortId);
    const token = randomBytes(32).toString('hex');
    const invitation = await prisma.enrollmentInvitation.create({
      data: { cohortId, channel, target, token, expiresAt },
    });
    return toInvitation(invitation);
  },

  async getInvitationByToken(token) {
    const invitation = await prisma.enrollmentInvitation.findUnique({
      where: { token },
    });
    return invitation ? toInvitation(invitation) : null;
  },

  async useInvitation(ctx, token) {
    const invitation = await prisma.enrollmentInvitation.findUnique({
      where: { token },
      include: { cohort: { select: { program: { select: { organizationId: true } } } } },
    });
    if (!invitation) {
      throw new TenantIsolationError('Invitation not found', { resourceType: 'EnrollmentInvitation' });
    }
    if (invitation.cohort.program.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: invitation.cohort.program.organizationId,
        resourceType: 'EnrollmentInvitation',
      });
    }
    const updated = await prisma.enrollmentInvitation.update({
      where: { token },
      data: { usedAt: new Date() },
    });
    return toInvitation(updated);
  },

  // ─── Participant Profiles ──────────────────────────────────────────────────
  async getParticipants(ctx) {
    const participants = await prisma.participantProfile.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return participants.map(toParticipantProfile);
  },

  async getParticipantById(ctx, participantId) {
    const participant = await prisma.participantProfile.findUnique({
      where: { id: participantId },
    });
    if (!participant) return null;
    if (participant.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: participant.organizationId,
        resourceType: 'ParticipantProfile',
        resourceId: participantId,
      });
    }
    return toParticipantProfile(participant);
  },

  async getParticipantBySocioId(ctx, socioId) {
    const participant = await prisma.participantProfile.findUnique({
      where: { socioId },
    });
    if (!participant) return null;
    if (participant.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: participant.organizationId,
        resourceType: 'ParticipantProfile',
      });
    }
    return toParticipantProfile(participant);
  },

  async createParticipant(ctx, data) {
    const participant = await prisma.participantProfile.create({
      data: {
        organizationId: ctx.organizationId,
        socioId: data.socioId,
        displayName: data.displayName,
        preferredLang: data.preferredLang,
        metadata: (data.metadata as object) ?? undefined,
      },
    });
    return toParticipantProfile(participant);
  },

  async updateParticipant(ctx, participantId, data) {
    await verifyParticipantOwnership(ctx, participantId);
    const participant = await prisma.participantProfile.update({
      where: { id: participantId },
      data: {
        ...(data.displayName !== undefined && { displayName: data.displayName }),
        ...(data.preferredLang !== undefined && { preferredLang: data.preferredLang }),
        ...(data.metadata !== undefined && { metadata: data.metadata as object }),
      },
    });
    return toParticipantProfile(participant);
  },

  // ─── Mentor Profiles ───────────────────────────────────────────────────────
  async getMentorProfiles(ctx) {
    const profiles = await prisma.mentorProfile.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return profiles.map(toMentorProfile);
  },

  async getMentorProfileById(ctx, profileId) {
    const profile = await prisma.mentorProfile.findUnique({
      where: { id: profileId },
    });
    if (!profile) return null;
    if (profile.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: profile.organizationId,
        resourceType: 'MentorProfile',
        resourceId: profileId,
      });
    }
    return toMentorProfile(profile);
  },

  async getMentorProfileByMentorId(ctx, mentorId) {
    const profile = await prisma.mentorProfile.findUnique({
      where: { mentorId },
    });
    if (!profile) return null;
    if (profile.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: profile.organizationId,
        resourceType: 'MentorProfile',
      });
    }
    return toMentorProfile(profile);
  },

  async createMentorProfile(ctx, data) {
    const profile = await prisma.mentorProfile.create({
      data: {
        organizationId: ctx.organizationId,
        mentorId: data.mentorId,
        displayName: data.displayName,
        specialties: data.specialties,
        metadata: (data.metadata as object) ?? undefined,
      },
    });
    return toMentorProfile(profile);
  },

  async updateMentorProfile(ctx, profileId, data) {
    await verifyMentorProfileOwnership(ctx, profileId);
    const profile = await prisma.mentorProfile.update({
      where: { id: profileId },
      data: {
        ...(data.displayName !== undefined && { displayName: data.displayName }),
        ...(data.specialties !== undefined && { specialties: data.specialties }),
        ...(data.metadata !== undefined && { metadata: data.metadata as object }),
      },
    });
    return toMentorProfile(profile);
  },

  // ─── Mentoring Relationships ───────────────────────────────────────────────
  async getMentoringRelationships(ctx, participantId) {
    await verifyParticipantOwnership(ctx, participantId);
    const relationships = await prisma.mentoringRelationship.findMany({
      where: { participantId },
      orderBy: { createdAt: 'desc' },
    });
    return relationships.map(toMentoringRelationship);
  },

  async createMentoringRelationship(ctx, mentorProfileId, participantId, role) {
    await verifyMentorProfileOwnership(ctx, mentorProfileId);
    await verifyParticipantOwnership(ctx, participantId);
    const relationship = await prisma.mentoringRelationship.create({
      data: { mentorId: mentorProfileId, participantId, role },
    });
    return toMentoringRelationship(relationship);
  },

  async endMentoringRelationship(ctx, relationshipId) {
    // Verify through participant ownership
    const relationship = await prisma.mentoringRelationship.findUnique({
      where: { id: relationshipId },
      select: { participantId: true },
    });
    if (!relationship) {
      throw new TenantIsolationError('Relationship not found', { resourceType: 'MentoringRelationship', resourceId: relationshipId });
    }
    await verifyParticipantOwnership(ctx, relationship.participantId);
    const updated = await prisma.mentoringRelationship.update({
      where: { id: relationshipId },
      data: { activeUntil: new Date() },
    });
    return toMentoringRelationship(updated);
  },

  // ─── Content Collections ───────────────────────────────────────────────────
  async getContentCollections(ctx) {
    const collections = await prisma.contentCollection.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return collections.map(toContentCollection);
  },

  async getContentCollectionById(ctx, collectionId) {
    const collection = await prisma.contentCollection.findUnique({
      where: { id: collectionId },
    });
    if (!collection) return null;
    if (collection.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: collection.organizationId,
        resourceType: 'ContentCollection',
        resourceId: collectionId,
      });
    }
    return toContentCollection(collection);
  },

  async createContentCollection(ctx, data) {
    const collection = await prisma.contentCollection.create({
      data: {
        organizationId: ctx.organizationId,
        slug: data.slug,
        name: data.name,
        description: data.description,
      },
    });
    return toContentCollection(collection);
  },

  // ─── Content Lessons ───────────────────────────────────────────────────────
  async getLessons(ctx, collectionId) {
    await verifyCollectionOwnership(ctx, collectionId);
    const lessons = await prisma.contentLesson.findMany({
      where: { collectionId },
      orderBy: { orderIndex: 'asc' },
    });
    return lessons.map(toContentLesson);
  },

  async getLessonById(ctx, lessonId) {
    const lesson = await prisma.contentLesson.findUnique({
      where: { id: lessonId },
      include: { collection: { select: { organizationId: true } } },
    });
    if (!lesson) return null;
    if (lesson.collection.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: lesson.collection.organizationId,
        resourceType: 'ContentLesson',
        resourceId: lessonId,
      });
    }
    return toContentLesson(lesson);
  },

  async createLesson(ctx, collectionId, data) {
    await verifyCollectionOwnership(ctx, collectionId);
    const lesson = await prisma.contentLesson.create({
      data: {
        collectionId,
        slug: data.slug,
        orderIndex: data.orderIndex,
      },
    });
    return toContentLesson(lesson);
  },

  // ─── Lesson Versions ───────────────────────────────────────────────────────
  async getLessonVersions(ctx, lessonId) {
    await verifyLessonOwnership(ctx, lessonId);
    const versions = await prisma.lessonVersion.findMany({
      where: { lessonId },
      orderBy: { createdAt: 'desc' },
    });
    return versions.map(toLessonVersion);
  },

  async getActiveLessonVersion(ctx, lessonId, lang = 'es') {
    await verifyLessonOwnership(ctx, lessonId);
    const version = await prisma.lessonVersion.findFirst({
      where: { lessonId, lang, active: true },
    });
    return version ? toLessonVersion(version) : null;
  },

  async createLessonVersion(ctx, lessonId, data) {
    await verifyLessonOwnership(ctx, lessonId);
    const version = await prisma.lessonVersion.create({
      data: {
        lessonId,
        version: data.version,
        lang: data.lang,
        title: data.title,
        body: data.body as object,
        active: data.active,
        publishedAt: data.publishedAt,
      },
    });
    return toLessonVersion(version);
  },

  // ─── Metric Definitions ────────────────────────────────────────────────────
  async getMetricDefinitions(ctx) {
    const metrics = await prisma.metricDefinition.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return metrics.map(toMetricDefinition);
  },

  async getMetricDefinitionById(ctx, metricId) {
    const metric = await prisma.metricDefinition.findUnique({
      where: { id: metricId },
    });
    if (!metric) return null;
    if (metric.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: metric.organizationId,
        resourceType: 'MetricDefinition',
        resourceId: metricId,
      });
    }
    return toMetricDefinition(metric);
  },

  async getMetricDefinitionByKey(ctx, key) {
    const metric = await prisma.metricDefinition.findUnique({
      where: { organizationId_key: { organizationId: ctx.organizationId, key } },
    });
    return metric ? toMetricDefinition(metric) : null;
  },

  async createMetricDefinition(ctx, data) {
    const metric = await prisma.metricDefinition.create({
      data: {
        organizationId: ctx.organizationId,
        key: data.key,
        name: data.name,
        description: data.description,
        category: data.category,
        dataType: data.dataType,
        scale: (data.scale as object) ?? undefined,
      },
    });
    return toMetricDefinition(metric);
  },

  // ─── Metric Observations ───────────────────────────────────────────────────
  async getObservations(ctx, metricId, opts) {
    await verifyMetricOwnership(ctx, metricId);
    const observations = await prisma.metricObservation.findMany({
      where: {
        metricId,
        ...(opts?.enrollmentId && { enrollmentId: opts.enrollmentId }),
        ...(opts?.since && { observedAt: { gte: opts.since } }),
      },
      orderBy: { observedAt: 'desc' },
    });
    return observations.map(toMetricObservation);
  },

  async createObservation(ctx, data) {
    await verifyMetricOwnership(ctx, data.metricId);
    if (data.enrollmentId) {
      await verifyEnrollmentOwnership(ctx, data.enrollmentId);
    }
    const observation = await prisma.metricObservation.create({
      data: {
        metricId: data.metricId,
        enrollmentId: data.enrollmentId,
        signalType: data.signalType,
        value: data.value,
        confidence: data.confidence,
        evidenceRefs: (data.evidenceRefs as object) ?? undefined,
        modelVersion: data.modelVersion,
        promptVersion: data.promptVersion,
        verificationStatus: data.verificationStatus,
        source: data.source,
        observedAt: data.observedAt,
      },
    });
    return toMetricObservation(observation);
  },

  // ─── Alert Rules ───────────────────────────────────────────────────────────
  async getAlertRules(ctx) {
    const rules = await prisma.alertRule.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rules.map(toAlertRule);
  },

  async getAlertRuleById(ctx, ruleId) {
    const rule = await prisma.alertRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule) return null;
    if (rule.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: rule.organizationId,
        resourceType: 'AlertRule',
        resourceId: ruleId,
      });
    }
    return toAlertRule(rule);
  },

  async createAlertRule(ctx, data) {
    await verifyMetricOwnership(ctx, data.metricId);
    const rule = await prisma.alertRule.create({
      data: {
        organizationId: ctx.organizationId,
        metricId: data.metricId,
        name: data.name,
        operator: data.operator,
        threshold: data.threshold,
        severity: data.severity,
        cooldownHours: data.cooldownHours,
        active: data.active,
      },
    });
    return toAlertRule(rule);
  },

  async updateAlertRule(ctx, ruleId, data) {
    await verifyAlertRuleOwnership(ctx, ruleId);
    const rule = await prisma.alertRule.update({
      where: { id: ruleId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.threshold !== undefined && { threshold: data.threshold }),
        ...(data.severity !== undefined && { severity: data.severity }),
        ...(data.active !== undefined && { active: data.active }),
      },
    });
    return toAlertRule(rule);
  },

  // ─── Alerts ────────────────────────────────────────────────────────────────
  async getAlerts(ctx, opts) {
    const alerts = await prisma.alert.findMany({
      where: {
        rule: { organizationId: ctx.organizationId },
        ...(opts?.enrollmentId && { enrollmentId: opts.enrollmentId }),
        ...(opts?.unresolved && { resolvedAt: null }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return alerts.map(toAlert);
  },

  async getAlertById(ctx, alertId) {
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      include: { rule: { select: { organizationId: true } } },
    });
    if (!alert) return null;
    if (alert.rule.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: alert.rule.organizationId,
        resourceType: 'Alert',
        resourceId: alertId,
      });
    }
    return toAlert(alert);
  },

  async createAlert(ctx, data) {
    await verifyAlertRuleOwnership(ctx, data.ruleId);
    await verifyEnrollmentOwnership(ctx, data.enrollmentId);
    const alert = await prisma.alert.create({
      data: {
        ruleId: data.ruleId,
        enrollmentId: data.enrollmentId,
        severity: data.severity,
        triggerValue: data.triggerValue,
        message: data.message,
        resolvedAt: data.resolvedAt,
      },
    });
    return toAlert(alert);
  },

  async resolveAlert(ctx, alertId) {
    await verifyAlertOwnership(ctx, alertId);
    const alert = await prisma.alert.update({
      where: { id: alertId },
      data: { resolvedAt: new Date() },
    });
    return toAlert(alert);
  },

  // ─── Alert Reviews ─────────────────────────────────────────────────────────
  async getAlertReviews(ctx, alertId) {
    await verifyAlertOwnership(ctx, alertId);
    const reviews = await prisma.alertReview.findMany({
      where: { alertId },
      orderBy: { createdAt: 'desc' },
    });
    return reviews.map(toAlertReview);
  },

  async createAlertReview(ctx, data) {
    await verifyAlertOwnership(ctx, data.alertId);
    await verifyMentorProfileOwnership(ctx, data.reviewerId);
    const review = await prisma.alertReview.create({
      data: {
        alertId: data.alertId,
        reviewerId: data.reviewerId,
        action: data.action,
        notes: data.notes,
      },
    });
    return toAlertReview(review);
  },
};
