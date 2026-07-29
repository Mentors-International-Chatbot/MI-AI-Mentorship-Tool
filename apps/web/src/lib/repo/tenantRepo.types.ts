import type { TenantContext } from './tenantContext';

// ═══════════════════════════════════════════════════════════════════════════
// Tenant-Scoped Entity Types (matching Prisma models from Phase 1)
// ═══════════════════════════════════════════════════════════════════════════

export type Organization = {
  id: string;
  slug: string;
  name: string;
  settings: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OrganizationMembership = {
  id: string;
  organizationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: Date;
};

export type Program = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProgramVersion = {
  id: string;
  programId: string;
  version: string;
  config: Record<string, unknown>;
  active: boolean;
  publishedAt: Date | null;
  createdAt: Date;
};

export type Cohort = {
  id: string;
  programId: string;
  programVersionId: string | null;
  slug: string;
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
};

export type Enrollment = {
  id: string;
  participantId: string;
  cohortId: string;
  programVersionId: string | null;
  status: 'active' | 'paused' | 'completed' | 'dropped';
  enrolledAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown> | null;
};

export type EnrollmentInvitation = {
  id: string;
  cohortId: string;
  channel: string;
  target: string;
  token: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type ParticipantProfile = {
  id: string;
  organizationId: string;
  socioId: string | null;
  displayName: string | null;
  preferredLang: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MentorProfile = {
  id: string;
  organizationId: string;
  mentorId: string | null;
  displayName: string | null;
  specialties: string[];
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MentoringRelationship = {
  id: string;
  mentorId: string;
  participantId: string;
  role: 'primary' | 'backup' | 'observer';
  activeFrom: Date;
  activeUntil: Date | null;
  createdAt: Date;
};

export type ContentCollection = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ContentLesson = {
  id: string;
  collectionId: string;
  slug: string;
  orderIndex: number;
  createdAt: Date;
  updatedAt: Date;
};

export type LessonVersion = {
  id: string;
  lessonId: string;
  version: string;
  lang: string;
  title: string;
  body: Record<string, unknown>;
  active: boolean;
  publishedAt: Date | null;
  createdAt: Date;
};

export type MetricDefinition = {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  dataType: string;
  scale: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ObservationSource = 'self_reported' | 'human_recorded' | 'system_observed' | 'calculated' | 'ai_inferred';

export type MetricObservation = {
  id: string;
  metricId: string;
  enrollmentId: string | null;
  signalType: string;
  value: number;
  confidence: number | null;
  evidenceRefs: Record<string, unknown> | null;
  modelVersion: string | null;
  promptVersion: string | null;
  verificationStatus: string | null;
  source: ObservationSource;
  observedAt: Date;
  createdAt: Date;
};

export type AlertRule = {
  id: string;
  organizationId: string;
  metricId: string;
  name: string;
  operator: string;
  threshold: number;
  severity: string;
  cooldownHours: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type Alert = {
  id: string;
  ruleId: string;
  enrollmentId: string;
  severity: string;
  triggerValue: number;
  message: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

export type AlertReview = {
  id: string;
  alertId: string;
  reviewerId: string;
  action: string;
  notes: string | null;
  createdAt: Date;
};

export type AssessmentSessionStatus = 'pending' | 'in_progress' | 'completed';

export type AssessmentSession = {
  id: string;
  organizationId: string;
  socioId: string;
  lessonKey: string;
  blockId: string | null;
  kind: string;
  channel: string; // delivery channel at session creation (whatsapp/web)
  status: AssessmentSessionStatus;
  attemptNumber: number;
  turnCount: number;
  liveState: Record<string, unknown> | null;
  scores: Record<string, unknown> | null;
  passedAt: Date | null;
  completedAt: Date | null;
  configSnapshot: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AssessmentMessage = {
  id: string;
  socioId: string;
  role: string;
  content: string;
  assessmentSessionId: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

// ═══════════════════════════════════════════════════════════════════════════
// TenantRepo Interface - All methods REQUIRE TenantContext as first param
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tenant-scoped repository interface.
 *
 * CRITICAL: Every method that touches tenant-owned data MUST have TenantContext
 * as its first parameter. This is a compile-time enforcement mechanism.
 *
 * The implementation MUST:
 * 1. Include organizationId in WHERE clauses for reads
 * 2. Set organizationId on creates
 * 3. Verify ownership before updates/deletes
 * 4. Throw TenantIsolationError on cross-tenant access attempts
 */
/** Which tier of the socio → organization fallback chain produced the answer. */
export type OrgResolutionSource =
  /** Tier 1 — the socio's ParticipantProfile. Authoritative. */
  | 'participant_profile'
  /** Tier 2 — the socio's curriculum collection. Authoritative. */
  | 'collection_key'
  /** Tier 3 — DEFAULT_ORGANIZATION_ID. A guess, not a tenant identification. */
  | 'default';

export type ResolvedOrganization = {
  organizationId: string;
  source: OrgResolutionSource;
};

export interface TenantRepo {
  // ─── Organization ──────────────────────────────────────────────────────────
  getOrganization(ctx: TenantContext): Promise<Organization | null>;
  getOrganizationBySlug(slug: string): Promise<Organization | null>;
  /** Bootstrap method: looks up org ID from socioId (for auth, before tenant context exists) */
  getOrganizationIdBySocioId(socioId: string): Promise<string | null>;
  /**
   * Resolve organizationId for a socio with fallback chain (never returns null):
   * 1. ParticipantProfile path (enrolled socios)
   * 2. Curriculum collection → organization (course-based resolution)
   * 3. Default MI organization (platform fallback)
   */
  resolveOrganizationIdForSocio(socioId: string): Promise<string>;
  /**
   * Same resolution as {@link resolveOrganizationIdForSocio}, but reports which
   * tier answered.
   *
   * Tiers 1 and 2 identify a real tenant. Tier 3 (`"default"`) is a guess — the
   * socio is an orphan and lands in whatever `DEFAULT_ORGANIZATION_ID` names.
   * Callers that go on to read tenant-owned data by a non-unique key (a
   * collection slug, say) must treat `"default"` as "unresolved" and decline,
   * or they will read a different tenant's rows.
   */
  resolveOrganizationForSocio(socioId: string): Promise<ResolvedOrganization>;

  // ─── Organization Membership ───────────────────────────────────────────────
  getMemberships(ctx: TenantContext): Promise<OrganizationMembership[]>;
  getMembershipByUserId(ctx: TenantContext, userId: string): Promise<OrganizationMembership | null>;
  addMembership(ctx: TenantContext, userId: string, role: OrganizationMembership['role']): Promise<OrganizationMembership>;
  removeMembership(ctx: TenantContext, membershipId: string): Promise<void>;

  // ─── Programs ──────────────────────────────────────────────────────────────
  getPrograms(ctx: TenantContext): Promise<Program[]>;
  getProgramById(ctx: TenantContext, programId: string): Promise<Program | null>;
  getProgramBySlug(ctx: TenantContext, slug: string): Promise<Program | null>;
  createProgram(ctx: TenantContext, data: Omit<Program, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Promise<Program>;
  updateProgram(ctx: TenantContext, programId: string, data: Partial<Pick<Program, 'name' | 'description'>>): Promise<Program>;
  deleteProgram(ctx: TenantContext, programId: string): Promise<void>;

  // ─── Program Versions ──────────────────────────────────────────────────────
  getProgramVersions(ctx: TenantContext, programId: string): Promise<ProgramVersion[]>;
  getActiveProgramVersion(ctx: TenantContext, programId: string): Promise<ProgramVersion | null>;
  createProgramVersion(ctx: TenantContext, programId: string, data: Omit<ProgramVersion, 'id' | 'programId' | 'createdAt'>): Promise<ProgramVersion>;
  activateProgramVersion(ctx: TenantContext, versionId: string): Promise<ProgramVersion>;

  // ─── Cohorts ───────────────────────────────────────────────────────────────
  getCohorts(ctx: TenantContext, programId: string): Promise<Cohort[]>;
  getCohortById(ctx: TenantContext, cohortId: string): Promise<Cohort | null>;
  createCohort(ctx: TenantContext, programId: string, data: Omit<Cohort, 'id' | 'programId' | 'createdAt'>): Promise<Cohort>;
  updateCohort(ctx: TenantContext, cohortId: string, data: Partial<Pick<Cohort, 'name' | 'startsAt' | 'endsAt'>>): Promise<Cohort>;

  // ─── Enrollments ───────────────────────────────────────────────────────────
  getEnrollments(ctx: TenantContext, cohortId: string): Promise<Enrollment[]>;
  getEnrollmentById(ctx: TenantContext, enrollmentId: string): Promise<Enrollment | null>;
  getEnrollmentsByParticipant(ctx: TenantContext, participantId: string): Promise<Enrollment[]>;
  createEnrollment(ctx: TenantContext, cohortId: string, participantId: string): Promise<Enrollment>;
  updateEnrollmentStatus(ctx: TenantContext, enrollmentId: string, status: Enrollment['status']): Promise<Enrollment>;

  // ─── Enrollment Invitations ────────────────────────────────────────────────
  createInvitation(ctx: TenantContext, cohortId: string, channel: string, target: string, expiresAt: Date): Promise<EnrollmentInvitation>;
  getInvitationByToken(token: string): Promise<EnrollmentInvitation | null>;
  useInvitation(ctx: TenantContext, token: string): Promise<EnrollmentInvitation>;

  // ─── Participant Profiles ──────────────────────────────────────────────────
  getParticipants(ctx: TenantContext): Promise<ParticipantProfile[]>;
  getParticipantById(ctx: TenantContext, participantId: string): Promise<ParticipantProfile | null>;
  getParticipantBySocioId(ctx: TenantContext, socioId: string): Promise<ParticipantProfile | null>;
  createParticipant(ctx: TenantContext, data: Omit<ParticipantProfile, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Promise<ParticipantProfile>;
  updateParticipant(ctx: TenantContext, participantId: string, data: Partial<Pick<ParticipantProfile, 'displayName' | 'preferredLang' | 'metadata'>>): Promise<ParticipantProfile>;

  // ─── Mentor Profiles ───────────────────────────────────────────────────────
  getMentorProfiles(ctx: TenantContext): Promise<MentorProfile[]>;
  getMentorProfileById(ctx: TenantContext, profileId: string): Promise<MentorProfile | null>;
  getMentorProfileByMentorId(ctx: TenantContext, mentorId: string): Promise<MentorProfile | null>;
  createMentorProfile(ctx: TenantContext, data: Omit<MentorProfile, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Promise<MentorProfile>;
  updateMentorProfile(ctx: TenantContext, profileId: string, data: Partial<Pick<MentorProfile, 'displayName' | 'specialties' | 'metadata'>>): Promise<MentorProfile>;

  // ─── Mentoring Relationships ───────────────────────────────────────────────
  getMentoringRelationships(ctx: TenantContext, participantId: string): Promise<MentoringRelationship[]>;
  createMentoringRelationship(ctx: TenantContext, mentorProfileId: string, participantId: string, role: MentoringRelationship['role']): Promise<MentoringRelationship>;
  endMentoringRelationship(ctx: TenantContext, relationshipId: string): Promise<MentoringRelationship>;

  // ─── Content Collections ───────────────────────────────────────────────────
  getContentCollections(ctx: TenantContext): Promise<ContentCollection[]>;
  getContentCollectionById(ctx: TenantContext, collectionId: string): Promise<ContentCollection | null>;
  createContentCollection(ctx: TenantContext, data: Omit<ContentCollection, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Promise<ContentCollection>;

  // ─── Content Lessons ───────────────────────────────────────────────────────
  getLessons(ctx: TenantContext, collectionId: string): Promise<ContentLesson[]>;
  getLessonById(ctx: TenantContext, lessonId: string): Promise<ContentLesson | null>;
  createLesson(ctx: TenantContext, collectionId: string, data: Omit<ContentLesson, 'id' | 'collectionId' | 'createdAt' | 'updatedAt'>): Promise<ContentLesson>;

  // ─── Lesson Versions ───────────────────────────────────────────────────────
  getLessonVersions(ctx: TenantContext, lessonId: string): Promise<LessonVersion[]>;
  getActiveLessonVersion(ctx: TenantContext, lessonId: string, lang?: string): Promise<LessonVersion | null>;
  createLessonVersion(ctx: TenantContext, lessonId: string, data: Omit<LessonVersion, 'id' | 'lessonId' | 'createdAt'>): Promise<LessonVersion>;

  // ─── Metric Definitions ────────────────────────────────────────────────────
  getMetricDefinitions(ctx: TenantContext): Promise<MetricDefinition[]>;
  getMetricDefinitionById(ctx: TenantContext, metricId: string): Promise<MetricDefinition | null>;
  getMetricDefinitionByKey(ctx: TenantContext, key: string): Promise<MetricDefinition | null>;
  createMetricDefinition(ctx: TenantContext, data: Omit<MetricDefinition, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Promise<MetricDefinition>;

  // ─── Metric Observations ───────────────────────────────────────────────────
  getObservations(ctx: TenantContext, metricId: string, opts?: { enrollmentId?: string; since?: Date }): Promise<MetricObservation[]>;
  createObservation(ctx: TenantContext, data: Omit<MetricObservation, 'id' | 'createdAt'>): Promise<MetricObservation>;

  // ─── Alert Rules ───────────────────────────────────────────────────────────
  getAlertRules(ctx: TenantContext): Promise<AlertRule[]>;
  getAlertRuleById(ctx: TenantContext, ruleId: string): Promise<AlertRule | null>;
  createAlertRule(ctx: TenantContext, data: Omit<AlertRule, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Promise<AlertRule>;
  updateAlertRule(ctx: TenantContext, ruleId: string, data: Partial<Pick<AlertRule, 'name' | 'threshold' | 'severity' | 'active'>>): Promise<AlertRule>;

  // ─── Alerts ────────────────────────────────────────────────────────────────
  getAlerts(ctx: TenantContext, opts?: { enrollmentId?: string; unresolved?: boolean }): Promise<Alert[]>;
  getAlertById(ctx: TenantContext, alertId: string): Promise<Alert | null>;
  createAlert(ctx: TenantContext, data: Omit<Alert, 'id' | 'createdAt'>): Promise<Alert>;
  resolveAlert(ctx: TenantContext, alertId: string): Promise<Alert>;

  // ─── Alert Reviews ─────────────────────────────────────────────────────────
  getAlertReviews(ctx: TenantContext, alertId: string): Promise<AlertReview[]>;
  createAlertReview(ctx: TenantContext, data: Omit<AlertReview, 'id' | 'createdAt'>): Promise<AlertReview>;

  // ─── Config Resolution (for assessment sessions) ──────────────────────────
  /** Get the curriculumCollectionKey for a socio */
  getSocioCurriculumCollectionKey(socioId: string): Promise<string | null>;
  /** Find active program version for an org that references a specific collection */
  getActiveProgramVersionByCollection(ctx: TenantContext, collectionSlug: string): Promise<ProgramVersion | null>;
  /** Find active lesson version by lesson slug and collection slug */
  getActiveLessonVersionBySlug(ctx: TenantContext, collectionSlug: string, lessonSlug: string): Promise<LessonVersion | null>;

  // ─── Assessment Sessions ──────────────────────────────────────────────────
  createAssessmentSession(
    ctx: TenantContext,
    data: {
      socioId: string;
      lessonKey: string;
      blockId?: string;
      channel: string; // delivery channel (whatsapp/web)
      configSnapshot: Record<string, unknown>;
      attemptNumber?: number;
    }
  ): Promise<AssessmentSession>;
  getAssessmentSessionById(ctx: TenantContext, sessionId: string): Promise<AssessmentSession | null>;
  getAssessmentSessionsForSocio(ctx: TenantContext, socioId: string): Promise<AssessmentSession[]>;
  updateAssessmentSession(
    ctx: TenantContext,
    sessionId: string,
    data: {
      status?: AssessmentSessionStatus;
      turnCount?: number;
      liveState?: Record<string, unknown>;
      scores?: Record<string, unknown>;
      passedAt?: Date;
      completedAt?: Date;
    }
  ): Promise<AssessmentSession>;
  getAssessmentMessages(ctx: TenantContext, sessionId: string): Promise<AssessmentMessage[]>;
  addAssessmentMessage(
    ctx: TenantContext,
    sessionId: string,
    data: { role: string; content: string }
  ): Promise<AssessmentMessage>;
}
