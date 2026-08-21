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
  LearnerProject,
  LearnerProjectStatus,
  StageLearnerProjectInput,
  EnrollmentInvitation,
  ParticipantProfile,
  MentorProfile,
  ContentCollection,
  ContentLesson,
  LessonVersion,
  MetricDefinition,
  MetricObservation,
  AlertRule,
  Alert,
  AlertReview,
  ObservationSource,
  AssessmentSession,
  AssessmentSessionStatus,
  AssessmentMessage,
  ResolvedOrganization,
} from './tenantRepo.types';
import type { Socio } from './types';
import type {
  Organization as PrismaOrganization,
  OrganizationMembership as PrismaOrganizationMembership,
  Program as PrismaProgram,
  ProgramVersion as PrismaProgramVersion,
  Cohort as PrismaCohort,
  Enrollment as PrismaEnrollment,
  LearnerProject as PrismaLearnerProject,
  EnrollmentInvitation as PrismaEnrollmentInvitation,
  ParticipantProfile as PrismaParticipantProfile,
  MentorProfile as PrismaMentorProfile,
  ContentCollection as PrismaContentCollection,
  ContentLesson as PrismaContentLesson,
  LessonVersion as PrismaLessonVersion,
  MetricDefinition as PrismaMetricDefinition,
  MetricObservation as PrismaMetricObservation,
  AlertRule as PrismaAlertRule,
  Alert as PrismaAlert,
  AlertReview as PrismaAlertReview,
  AssessmentSession as PrismaAssessmentSession,
  Message as PrismaMessage,
  Socio as PrismaSocio,
} from '@prisma/client';
import { randomBytes } from 'crypto';

export class LearnerProjectTransitionError extends Error {
  constructor(
    public readonly from: LearnerProjectStatus | null,
    public readonly to: LearnerProjectStatus,
    message?: string,
  ) {
    super(message ?? `LearnerProject status cannot transition from ${from ?? 'none'} to ${to}`);
    this.name = 'LearnerProjectTransitionError';
  }
}

export function isLearnerProjectStatusTransitionAllowed(
  from: LearnerProjectStatus | null,
  to: LearnerProjectStatus,
): boolean {
  if (from === null) return to === 'DRAFT';
  if (from === 'DRAFT') return to === 'DRAFT' || to === 'ACTIVE' || to === 'ABANDONED';
  if (from === 'ACTIVE') return to === 'ACTIVE' || to === 'CHANGED' || to === 'ABANDONED';
  if (from === 'ABANDONED') return to === 'DRAFT';
  return false;
}

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
    primaryLang: p.primaryLang,
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
    projectSelectionGrandfatheredAt: p.projectSelectionGrandfatheredAt,
    metadata: p.metadata as Record<string, unknown> | null,
  };
}

function toLearnerProject(p: PrismaLearnerProject): LearnerProject {
  return {
    id: p.id,
    organizationId: p.organizationId,
    enrollmentId: p.enrollmentId,
    socioId: p.socioId,
    presetKey: p.presetKey,
    title: p.title,
    oneLiner: p.oneLiner,
    context: p.context,
    automationLevel: p.automationLevel,
    interests: p.interests,
    status: p.status as LearnerProjectStatus,
    lifeContext: p.lifeContext,
    reframedAt: p.reframedAt,
    automationValidatedAt: p.automationValidatedAt,
    createdAt: p.createdAt,
    confirmedAt: p.confirmedAt,
    updatedAt: p.updatedAt,
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

function toAssessmentSession(p: PrismaAssessmentSession): AssessmentSession {
  return {
    id: p.id,
    organizationId: p.organizationId,
    socioId: p.socioId,
    lessonKey: p.lessonKey,
    blockId: p.blockId,
    kind: p.kind,
    channel: p.channel,
    status: p.status as AssessmentSessionStatus,
    attemptNumber: p.attemptNumber,
    turnCount: p.turnCount,
    liveState: p.liveState as Record<string, unknown> | null,
    scores: p.scores as Record<string, unknown> | null,
    passedAt: p.passedAt,
    completedAt: p.completedAt,
    configSnapshot: p.configSnapshot as Record<string, unknown> | null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toSocio(p: PrismaSocio): Socio {
  return {
    id: p.id,
    whatsappPhoneNumber: p.whatsappPhoneNumber,
    channelType: p.channelType,
    externalId: p.externalId,
    language: p.language,
    name: p.name,
    businessName: p.businessName,
    businessDescription: p.businessDescription,
    status: p.status,
    promptOverrides: p.promptOverrides as Record<string, unknown> | null,
    aiPaused: p.aiPaused,
    mentorId: p.mentorId,
    curriculumCollectionKey: p.curriculumCollectionKey,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toAssessmentMessage(p: PrismaMessage): AssessmentMessage {
  return {
    id: p.id,
    socioId: p.socioId,
    role: p.role,
    content: p.content,
    assessmentSessionId: p.assessmentSessionId!,
    metadata: p.metadata as Record<string, unknown> | null,
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

async function verifyLearnerProjectEnrollmentOwnership(
  ctx: TenantContext,
  enrollmentId: string,
): Promise<{
  organizationId: string;
  socioId: string;
  collectionKey: string | null;
  enrolledAt: Date;
  projectSelectionGrandfatheredAt: Date | null;
}> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      enrolledAt: true,
      projectSelectionGrandfatheredAt: true,
      participant: { select: { socioId: true } },
      cohort: { select: { program: { select: { organizationId: true } } } },
      programVersion: { select: { collection: { select: { slug: true } } } },
    },
  });
  if (!enrollment) {
    throw new TenantIsolationError('Enrollment not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'Enrollment',
      resourceId: enrollmentId,
    });
  }
  const organizationId = enrollment.cohort.program.organizationId;
  if (organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: organizationId,
      resourceType: 'Enrollment',
      resourceId: enrollmentId,
    });
  }
  if (!enrollment.participant.socioId) {
    throw new TenantIsolationError('Enrollment has no learner identity', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: organizationId,
      resourceType: 'Enrollment',
      resourceId: enrollmentId,
    });
  }
  return {
    organizationId,
    socioId: enrollment.participant.socioId,
    collectionKey: enrollment.programVersion?.collection?.slug ?? null,
    enrolledAt: enrollment.enrolledAt,
    projectSelectionGrandfatheredAt: enrollment.projectSelectionGrandfatheredAt,
  };
}

/**
 * Verifies that an assessment session belongs to the tenant's organization.
 */
async function verifyAssessmentSessionOwnership(ctx: TenantContext, sessionId: string): Promise<PrismaAssessmentSession> {
  const session = await prisma.assessmentSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    throw new TenantIsolationError('AssessmentSession not found', {
      requestedOrgId: ctx.organizationId,
      resourceType: 'AssessmentSession',
      resourceId: sessionId,
    });
  }
  if (session.organizationId !== ctx.organizationId) {
    throw new TenantIsolationError('Cross-tenant access denied', {
      requestedOrgId: ctx.organizationId,
      actualOrgId: session.organizationId,
      resourceType: 'AssessmentSession',
      resourceId: sessionId,
    });
  }
  return session;
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

/**
 * Single implementation of the socio → organization fallback chain, shared by
 * `resolveOrganizationIdForSocio` and `resolveOrganizationForSocio` so the two
 * can never drift. See the interface docs for tier semantics.
 */
async function resolveOrgWithSource(socioId: string): Promise<ResolvedOrganization> {
  const DEFAULT_ORG_ID = process.env.DEFAULT_ORGANIZATION_ID;

  // 1. Try ParticipantProfile path (works for seeded/enrolled socios)
  const participant = await prisma.participantProfile.findUnique({
    where: { socioId },
    select: { organizationId: true },
  });
  if (participant?.organizationId) {
    return { organizationId: participant.organizationId, source: 'participant_profile' };
  }

  // 2. Try curriculum_collection_key → content_collections → organization_id
  const socio = await prisma.socio.findUnique({
    where: { id: socioId },
    select: { curriculumCollectionKey: true },
  });
  if (socio?.curriculumCollectionKey) {
    // Slugs are unique per organization, not globally. If two tenants hold the
    // same slug there is no way to tell which one owns this socio, so an
    // ambiguous match is not a resolution — fall through to tier 3 rather than
    // stamping an arbitrary row as authoritative.
    const candidates = await prisma.contentCollection.findMany({
      where: { slug: socio.curriculumCollectionKey },
      select: { organizationId: true },
    });

    if (candidates.length === 1) {
      return { organizationId: candidates[0].organizationId, source: 'collection_key' };
    }

    if (candidates.length > 1) {
      console.warn(
        `[TenantResolve] WARN curriculum slug "${socio.curriculumCollectionKey}" is held by ` +
          `${candidates.length} organizations (${candidates.map((c) => c.organizationId).join(', ')}) — ` +
          `cannot resolve socio ${socioId} by curriculum. Two tenants collide on this slug; ` +
          `falling through to the default organization.`,
      );
    }
  }

  // 3. Fall back to the env-configured default organization.
  // Reaching here means the socio has no ParticipantProfile and no resolvable
  // curriculum — it is an orphan, and assigning it to ANY tenant is a guess.
  if (!DEFAULT_ORG_ID) {
    console.error(
      `[TenantResolve] ERROR socio ${socioId} has no ParticipantProfile and no ` +
        `resolvable curriculum, and DEFAULT_ORGANIZATION_ID is not set. Refusing ` +
        `to guess a tenant. Set DEFAULT_ORGANIZATION_ID or fix this socio's assignment.`,
    );
    throw new Error(
      `Cannot resolve organization for socio ${socioId}: no profile, no curriculum, ` +
        `and DEFAULT_ORGANIZATION_ID is unset.`,
    );
  }

  console.warn(
    `[TenantResolve] WARN socio ${socioId} resolved to DEFAULT org ${DEFAULT_ORG_ID} — ` +
      `no profile or curriculum. This is a fallback; verify tenant assignment.`,
  );
  return { organizationId: DEFAULT_ORG_ID, source: 'default' };
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

  async getOrganizationIdBySocioId(socioId) {
    const participant = await prisma.participantProfile.findUnique({
      where: { socioId },
      select: { organizationId: true },
    });
    return participant?.organizationId ?? null;
  },

  async getOrganizationIdByMentorId(mentorId) {
    const profile = await prisma.mentorProfile.findUnique({
      where: { mentorId },
      select: { organizationId: true },
    });
    return profile?.organizationId ?? null;
  },

  async getMentorAnchorInputs(mentorId) {
    const [mentor, memberships, socios] = await Promise.all([
      prisma.mentor.findUnique({
        where: { id: mentorId },
        select: { name: true, email: true, role: true },
      }),
      prisma.organizationMembership.findMany({
        where: { userId: mentorId },
        select: { organizationId: true, role: true },
      }),
      prisma.socio.findMany({
        where: { mentorId },
        select: { participantProfile: { select: { organizationId: true } } },
      }),
    ]);

    return {
      identity: mentor,
      memberships,
      assignedSocioCount: socios.length,
      assignedSocioOrganizationIds: [
        ...new Set(
          socios
            .map((s) => s.participantProfile?.organizationId)
            .filter((o): o is string => typeof o === 'string'),
        ),
      ],
    };
  },

  /**
   * Resolve organizationId for a socio with fallback chain:
   * 1. ParticipantProfile path (enrolled socios)
   * 2. Curriculum collection → organization (course-based resolution)
   * 3. Env-configured default organization (platform fallback, logged loudly)
   *
   * Tier 3 exists so org resolution never walls off a socio mid-flow, but it is
   * a cross-tenant hazard: an orphaned socio lands in whatever tenant is
   * configured. It is therefore configuration-driven (never a hardcoded tenant)
   * and every hit is warned about so mis-assignment is visible rather than silent.
   */
  async resolveOrganizationIdForSocio(socioId: string): Promise<string> {
    const { organizationId } = await resolveOrgWithSource(socioId);
    return organizationId;
  },

  async resolveOrganizationForSocio(socioId: string): Promise<ResolvedOrganization> {
    return resolveOrgWithSource(socioId);
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

  async resolveOrCreateActiveEnrollment(ctx, { participantId, programVersionId, cohortId, channel }) {
    await verifyParticipantOwnership(ctx, participantId);

    const version = await prisma.programVersion.findUnique({
      where: { id: programVersionId },
      select: { programId: true, program: { select: { organizationId: true } } },
    });
    if (!version) {
      throw new TenantIsolationError('ProgramVersion not found', {
        requestedOrgId: ctx.organizationId,
        resourceType: 'ProgramVersion',
        resourceId: programVersionId,
      });
    }
    if (version.program.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: version.program.organizationId,
        resourceType: 'ProgramVersion',
        resourceId: programVersionId,
      });
    }

    let resolvedCohortId = cohortId;
    if (resolvedCohortId) {
      await verifyCohortOwnership(ctx, resolvedCohortId);
    } else {
      // Self-serve web/WhatsApp course selection has no pre-provisioned
      // cohort the way an LTI launch does (context.cohortId). One
      // find-or-create cohort per program holds every self-serve learner,
      // matching the convention `POST /api/auth/curriculum` used before this
      // method existed.
      const cohort = await prisma.cohort.upsert({
        where: { programId_slug: { programId: version.programId, slug: 'direct-web' } },
        create: { programId: version.programId, programVersionId, slug: 'direct-web', name: 'Direct enrollment' },
        update: { programVersionId },
      });
      resolvedCohortId = cohort.id;
    }

    // Upsert on the (participantId, cohortId) unique constraint is what makes
    // this idempotent: re-entry for the same learner+cohort always resolves
    // the same row and reactivates it rather than minting a duplicate.
    const enrollment = await prisma.enrollment.upsert({
      where: { participantId_cohortId: { participantId, cohortId: resolvedCohortId } },
      create: { participantId, cohortId: resolvedCohortId, programVersionId, status: 'active', metadata: { channel } },
      update: { programVersionId, status: 'active' },
    });
    return toEnrollment(enrollment);
  },

  // ─── Learner Projects ─────────────────────────────────────────────────────
  async getCurrentLearnerProject(ctx, enrollmentId) {
    const owner = await verifyLearnerProjectEnrollmentOwnership(ctx, enrollmentId);
    const project = await prisma.learnerProject.findFirst({
      where: { enrollmentId, status: { in: ['DRAFT', 'ACTIVE'] } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!project) return null;
    if (project.organizationId !== owner.organizationId || project.socioId !== owner.socioId) {
      throw new TenantIsolationError('LearnerProject ownership does not match its enrollment', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: project.organizationId,
        resourceType: 'LearnerProject',
        resourceId: project.id,
      });
    }
    return toLearnerProject(project);
  },

  async learnerProjectSelectionRequired(ctx, enrollmentId, collectionKey) {
    const owner = await verifyLearnerProjectEnrollmentOwnership(ctx, enrollmentId);
    if (owner.collectionKey !== collectionKey) {
      throw new TenantIsolationError('Enrollment course does not match project selection course', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: owner.organizationId,
        resourceType: 'Enrollment',
        resourceId: enrollmentId,
      });
    }

    const active = await prisma.learnerProject.findFirst({
      where: { enrollmentId, status: { in: ['ACTIVE'] } },
      select: { id: true },
    });
    if (active) return false;

    // Any project history means this learner entered the new flow. DRAFT and
    // ABANDONED must resume setup; CHANGED cannot become a legacy exemption.
    const history = await prisma.learnerProject.findFirst({
      where: { enrollmentId },
      select: { id: true },
    });
    if (history) return true;
    if (owner.projectSelectionGrandfatheredAt) return false;

    const legacyProgress = await prisma.blockProgress.findFirst({
      where: { socioId: owner.socioId, collectionKey, completedAt: { gte: owner.enrolledAt } },
      select: { id: true },
    });
    if (!legacyProgress) return true;

    // The collection-scoped progress is consulted only while granting. The
    // durable decision is enrollment-scoped, so later retakes do not inherit it.
    await prisma.enrollment.updateMany({
      where: { id: enrollmentId, projectSelectionGrandfatheredAt: null },
      data: { projectSelectionGrandfatheredAt: new Date() },
    });
    return false;
  },

  async saveLearnerProjectInterests(ctx, enrollmentId, interests) {
    const owner = await verifyLearnerProjectEnrollmentOwnership(ctx, enrollmentId);
    const current = await prisma.learnerProject.findFirst({
      where: { enrollmentId, status: { in: ['DRAFT', 'ACTIVE'] } },
      orderBy: { updatedAt: 'desc' },
    });
    if (current?.status === 'ACTIVE') throw new LearnerProjectTransitionError('ACTIVE', 'DRAFT');
    if (current && (current.organizationId !== owner.organizationId || current.socioId !== owner.socioId)) {
      throw new TenantIsolationError('LearnerProject ownership does not match its enrollment', {
        requestedOrgId: ctx.organizationId, actualOrgId: current.organizationId,
        resourceType: 'LearnerProject', resourceId: current.id,
      });
    }
    const reset = {
      interests,
      presetKey: null,
      title: null,
      oneLiner: null,
      context: null,
      automationLevel: null,
      lifeContext: null,
      reframedAt: null,
      automationValidatedAt: null,
      confirmedAt: null,
      status: 'DRAFT' as const,
    };
    if (current) {
      return toLearnerProject(await prisma.learnerProject.update({ where: { id: current.id }, data: reset }));
    }
    const latest = await prisma.learnerProject.findFirst({ where: { enrollmentId }, orderBy: { updatedAt: 'desc' } });
    if (latest && (latest.organizationId !== owner.organizationId || latest.socioId !== owner.socioId)) {
      throw new TenantIsolationError('LearnerProject ownership does not match its enrollment', {
        requestedOrgId: ctx.organizationId, actualOrgId: latest.organizationId,
        resourceType: 'LearnerProject', resourceId: latest.id,
      });
    }
    if (latest?.status === 'ABANDONED') {
      return toLearnerProject(await prisma.learnerProject.update({ where: { id: latest.id }, data: reset }));
    }
    return toLearnerProject(await prisma.learnerProject.create({
      data: {
        organizationId: owner.organizationId,
        enrollmentId,
        socioId: owner.socioId,
        ...reset,
      },
    }));
  },

  async saveLearnerProjectLifeContext(ctx, enrollmentId, lifeContext) {
    const owner = await verifyLearnerProjectEnrollmentOwnership(ctx, enrollmentId);
    const current = await prisma.learnerProject.findFirst({
      where: { enrollmentId, status: { in: ['DRAFT', 'ACTIVE'] } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!current || current.status !== 'DRAFT') throw new LearnerProjectTransitionError(current?.status as LearnerProjectStatus | undefined ?? null, 'DRAFT');
    if (current.organizationId !== owner.organizationId || current.socioId !== owner.socioId) {
      throw new TenantIsolationError('LearnerProject ownership does not match its enrollment', {
        requestedOrgId: ctx.organizationId, actualOrgId: current.organizationId,
        resourceType: 'LearnerProject', resourceId: current.id,
      });
    }
    return toLearnerProject(await prisma.learnerProject.update({
      where: { id: current.id }, data: { lifeContext },
    }));
  },

  async stageLearnerProject(ctx, enrollmentId, data: StageLearnerProjectInput) {
    const owner = await verifyLearnerProjectEnrollmentOwnership(ctx, enrollmentId);
    const current = await prisma.learnerProject.findFirst({
      where: { enrollmentId, status: { in: ['DRAFT', 'ACTIVE'] } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!current || current.status !== 'DRAFT') throw new LearnerProjectTransitionError(current?.status as LearnerProjectStatus | undefined ?? null, 'DRAFT');
    if (current.organizationId !== owner.organizationId || current.socioId !== owner.socioId) {
      throw new TenantIsolationError('LearnerProject ownership does not match its enrollment', {
        requestedOrgId: ctx.organizationId, actualOrgId: current.organizationId,
        resourceType: 'LearnerProject', resourceId: current.id,
      });
    }
    const now = new Date();
    return toLearnerProject(await prisma.learnerProject.update({
      where: { id: current.id },
      data: {
        presetKey: data.presetKey,
        title: null,
        oneLiner: data.oneLiner,
        context: data.context ?? null,
        automationLevel: data.automationLevel,
        interests: data.interests,
        lifeContext: data.lifeContext,
        automationValidatedAt: now,
        ...(data.reframed ? { reframedAt: current.reframedAt ?? now } : {}),
      },
    }));
  },

  async putLearnerProject(ctx, enrollmentId, data) {
    const owner = await verifyLearnerProjectEnrollmentOwnership(ctx, enrollmentId);
    const current = await prisma.learnerProject.findFirst({
      where: { enrollmentId, status: { in: ['DRAFT', 'ACTIVE'] } },
      orderBy: { updatedAt: 'desc' },
    });
    if (current && (current.organizationId !== owner.organizationId || current.socioId !== owner.socioId)) {
      throw new TenantIsolationError('LearnerProject ownership does not match its enrollment', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: current.organizationId,
        resourceType: 'LearnerProject',
        resourceId: current.id,
      });
    }

    const latest = current ?? await prisma.learnerProject.findFirst({
      where: { enrollmentId },
      orderBy: { updatedAt: 'desc' },
    });
    if (latest && (latest.organizationId !== owner.organizationId || latest.socioId !== owner.socioId)) {
      throw new TenantIsolationError('LearnerProject ownership does not match its enrollment', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: latest.organizationId,
        resourceType: 'LearnerProject',
        resourceId: latest.id,
      });
    }

    const from = current?.status as LearnerProjectStatus | undefined
      ?? (latest?.status === 'ABANDONED' ? 'ABANDONED' : null);
    const to = data.status ?? (current?.status as LearnerProjectStatus | undefined) ?? 'DRAFT';
    if (!isLearnerProjectStatusTransitionAllowed(from, to)) {
      throw new LearnerProjectTransitionError(from, to);
    }
    if (to === 'ACTIVE' && !current?.automationValidatedAt) {
      throw new LearnerProjectTransitionError(from, to, 'LearnerProject must pass the automation gate before confirmation');
    }
    if (current?.status === 'DRAFT' && to === 'ACTIVE') {
      const stagedInterests = [...current.interests].sort();
      const submittedInterests = [...data.interests].sort();
      const changesValidatedProject = current.presetKey !== data.presetKey
        || current.oneLiner !== data.oneLiner
        || current.context !== (data.context ?? null)
        || current.automationLevel !== data.automationLevel
        || JSON.stringify(stagedInterests) !== JSON.stringify(submittedInterests);
      if (changesValidatedProject) {
        throw new LearnerProjectTransitionError(from, to, 'Confirmation must preserve the project that passed the automation gate');
      }
    }

    const fields = {
      organizationId: owner.organizationId,
      enrollmentId,
      socioId: owner.socioId,
      presetKey: data.presetKey,
      title: data.title,
      oneLiner: data.oneLiner,
      context: data.context ?? null,
      automationLevel: data.automationLevel,
      interests: data.interests,
    };

    if (!current) {
      if (latest?.status === 'ABANDONED') {
        const reopened = await prisma.learnerProject.update({
          where: { id: latest.id },
          data: { ...fields, status: 'DRAFT', confirmedAt: null },
        });
        return toLearnerProject(reopened);
      }
      const created = await prisma.learnerProject.create({
        data: { ...fields, status: 'DRAFT', confirmedAt: null },
      });
      return toLearnerProject(created);
    }

    if (current.status === 'ACTIVE' && to === 'CHANGED') {
      const [, replacement] = await prisma.$transaction([
        prisma.learnerProject.update({
          where: { id: current.id },
          data: { status: 'CHANGED' },
        }),
        prisma.learnerProject.create({
          data: { ...fields, status: 'DRAFT', confirmedAt: null },
        }),
      ]);
      return toLearnerProject(replacement);
    }

    const confirmedAt = to === 'ACTIVE'
      ? current.confirmedAt ?? new Date()
      : to === 'DRAFT' ? null : current.confirmedAt;
    const updated = await prisma.learnerProject.update({
      where: { id: current.id },
      data: { ...fields, status: to, confirmedAt },
    });
    return toLearnerProject(updated);
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
    // `socioId` is the natural key (unique, nullable). When present, upsert on
    // it so repeated calls for the same socio are idempotent — course selection
    // can run more than once and must never produce a duplicate or a P2002.
    // With no socioId there is nothing to key on, so a plain create is all that
    // is available.
    if (data.socioId === null) {
      const participant = await prisma.participantProfile.create({
        data: {
          organizationId: ctx.organizationId,
          socioId: null,
          displayName: data.displayName,
          preferredLang: data.preferredLang,
          metadata: (data.metadata as object) ?? undefined,
        },
      });
      return toParticipantProfile(participant);
    }

    // A profile already anchored to another tenant is not ours to re-home.
    // Silently rewriting organizationId would move a participant across tenants,
    // so refuse the same way every other cross-tenant access here does.
    const existing = await prisma.participantProfile.findUnique({
      where: { socioId: data.socioId },
      select: { id: true, organizationId: true },
    });
    if (existing && existing.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: existing.organizationId,
        resourceType: 'ParticipantProfile',
        resourceId: existing.id,
      });
    }

    const participant = await prisma.participantProfile.upsert({
      where: { socioId: data.socioId },
      create: {
        organizationId: ctx.organizationId,
        socioId: data.socioId,
        displayName: data.displayName,
        preferredLang: data.preferredLang,
        metadata: (data.metadata as object) ?? undefined,
      },
      // organizationId is deliberately absent: the tenant anchor is set once at
      // creation and the cross-tenant guard above has already established that
      // any existing row is in this org.
      // Nullable fields are written only when the caller actually supplies one,
      // so a re-run that knows less than the original create cannot blank out
      // what is already there. preferredLang is non-nullable and always known.
      update: {
        ...(data.displayName !== null && { displayName: data.displayName }),
        preferredLang: data.preferredLang,
        ...(data.metadata !== null && { metadata: data.metadata as object }),
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

  // ─── Socios (legacy model, org-scoped through ParticipantProfile) ─────────
  async getSociosForOrganization(organizationId) {
    const socios = await prisma.socio.findMany({
      where: {
        status: 'ACTIVE',
        participantProfile: { organizationId },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return socios.map(toSocio);
  },

  async getSociosForMentor(organizationId, mentorId) {
    const socios = await prisma.socio.findMany({
      where: {
        status: 'ACTIVE',
        mentorId,
        participantProfile: { organizationId },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return socios.map(toSocio);
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
    // Same shape and same reasoning as createParticipant: `mentorId` is a
    // unique nullable natural key, so when it is present this must upsert.
    // Anchoring now runs from two concurrent-capable triggers (admin create,
    // first socio assignment) plus the backfill, and a plain create would turn
    // a second one into a P2002 that fails the admin's action.
    if (data.mentorId === null) {
      const profile = await prisma.mentorProfile.create({
        data: {
          organizationId: ctx.organizationId,
          mentorId: null,
          displayName: data.displayName,
          specialties: data.specialties,
          metadata: (data.metadata as object) ?? undefined,
        },
      });
      return toMentorProfile(profile);
    }

    // A profile already anchored to another tenant is not ours to re-home.
    const existing = await prisma.mentorProfile.findUnique({
      where: { mentorId: data.mentorId },
      select: { id: true, organizationId: true },
    });
    if (existing && existing.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: existing.organizationId,
        resourceType: 'MentorProfile',
        resourceId: existing.id,
      });
    }

    const profile = await prisma.mentorProfile.upsert({
      where: { mentorId: data.mentorId },
      create: {
        organizationId: ctx.organizationId,
        mentorId: data.mentorId,
        displayName: data.displayName,
        specialties: data.specialties,
        metadata: (data.metadata as object) ?? undefined,
      },
      // organizationId is deliberately absent: the tenant anchor is set once at
      // creation, and the guard above has established any existing row is ours.
      update: {
        ...(data.displayName !== null && { displayName: data.displayName }),
        ...(data.specialties.length > 0 && { specialties: data.specialties }),
        ...(data.metadata !== null && { metadata: data.metadata as object }),
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

  // ─── Config Resolution (for assessment sessions) ──────────────────────────
  async getSocioCurriculumCollectionKey(socioId) {
    const socio = await prisma.socio.findUnique({
      where: { id: socioId },
      select: { curriculumCollectionKey: true },
    });
    return socio?.curriculumCollectionKey ?? null;
  },

  async getActiveProgramVersionByCollection(ctx, collectionSlug) {
    const programVersion = await prisma.programVersion.findFirst({
      where: {
        active: true,
        program: { organizationId: ctx.organizationId },
        collection: { slug: collectionSlug },
      },
      orderBy: { createdAt: 'desc' },
    });
    return programVersion ? toProgramVersion(programVersion) : null;
  },

  async getActiveLessonVersionBySlug(ctx, collectionSlug, lessonSlug) {
    const lessonVersion = await prisma.lessonVersion.findFirst({
      where: {
        active: true,
        lesson: {
          slug: lessonSlug,
          collection: {
            slug: collectionSlug,
            organizationId: ctx.organizationId,
          },
        },
      },
    });
    return lessonVersion ? toLessonVersion(lessonVersion) : null;
  },

  // ─── Assessment Sessions ──────────────────────────────────────────────────
  async createAssessmentSession(ctx, data) {
    // Calculate attempt number if not provided
    let attemptNumber = data.attemptNumber ?? 1;
    if (!data.attemptNumber) {
      const existingSessions = await prisma.assessmentSession.findMany({
        where: {
          organizationId: ctx.organizationId,
          socioId: data.socioId,
          lessonKey: data.lessonKey,
        },
        orderBy: { attemptNumber: 'desc' },
        take: 1,
      });
      if (existingSessions.length > 0) {
        attemptNumber = existingSessions[0].attemptNumber + 1;
      }
    }

    const session = await prisma.assessmentSession.create({
      data: {
        organizationId: ctx.organizationId,
        socioId: data.socioId,
        lessonKey: data.lessonKey,
        blockId: data.blockId,
        channel: data.channel,
        attemptNumber,
        configSnapshot: data.configSnapshot as object,
      },
    });
    return toAssessmentSession(session);
  },

  async getAssessmentSessionById(ctx, sessionId) {
    const session = await prisma.assessmentSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return null;
    if (session.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: session.organizationId,
        resourceType: 'AssessmentSession',
        resourceId: sessionId,
      });
    }
    return toAssessmentSession(session);
  },

  async getAssessmentSessionsForSocio(ctx, socioId) {
    const sessions = await prisma.assessmentSession.findMany({
      where: {
        organizationId: ctx.organizationId,
        socioId,
      },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map(toAssessmentSession);
  },

  async updateAssessmentSession(ctx, sessionId, data) {
    await verifyAssessmentSessionOwnership(ctx, sessionId);
    const session = await prisma.assessmentSession.update({
      where: { id: sessionId },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.turnCount !== undefined && { turnCount: data.turnCount }),
        ...(data.liveState !== undefined && { liveState: data.liveState as object }),
        ...(data.scores !== undefined && { scores: data.scores as object }),
        ...(data.passedAt !== undefined && { passedAt: data.passedAt }),
        ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
      },
    });
    return toAssessmentSession(session);
  },

  async getAssessmentMessages(ctx, sessionId) {
    await verifyAssessmentSessionOwnership(ctx, sessionId);
    const messages = await prisma.message.findMany({
      where: { assessmentSessionId: sessionId },
      orderBy: { createdAt: 'asc' },
    });
    return messages.map(toAssessmentMessage);
  },

  async addAssessmentMessage(ctx, sessionId, data) {
    // Verify ownership and get session for socioId
    const session = await prisma.assessmentSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new TenantIsolationError('Session not found', {
        resourceType: 'AssessmentSession',
        resourceId: sessionId,
      });
    }
    if (session.organizationId !== ctx.organizationId) {
      throw new TenantIsolationError('Cross-tenant access denied', {
        requestedOrgId: ctx.organizationId,
        actualOrgId: session.organizationId,
        resourceType: 'AssessmentSession',
        resourceId: sessionId,
      });
    }

    const message = await prisma.message.create({
      data: {
        socioId: session.socioId,
        role: data.role,
        content: data.content,
        assessmentSessionId: sessionId,
      },
    });
    return toAssessmentMessage(message);
  },
};
