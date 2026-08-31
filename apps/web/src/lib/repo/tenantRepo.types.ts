import type { TenantContext } from './tenantContext';
import type { Socio } from './types';

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
  /** JourneyPackage.metadata, including the authoritative delivery surface. */
  metadata?: unknown | null;
  active: boolean;
  /**
   * The language this version's content is authored in. Distinct from a
   * learner's own language: it is what `config.aiBehavior.languageInstruction`
   * is written about, so that instruction only applies to a learner reading in
   * this language.
   */
  primaryLang: string;
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
  /**
   * Denormalized course identity (ContentCollection.slug), derived from
   * programVersionId at write time. Null only for rows whose programVersionId
   * points at a ProgramVersion with no collection (the pre-Stage-2 dangling
   * draft rows — see A.3). Kept in sync exclusively by
   * resolveOrCreateActiveEnrollment; never write it elsewhere.
   */
  collectionKey: string | null;
  status: 'active' | 'paused' | 'completed' | 'dropped';
  enrolledAt: Date;
  completedAt: Date | null;
  projectSelectionGrandfatheredAt: Date | null;
  metadata: Record<string, unknown> | null;
};

export type BlockProgress = {
  id: string;
  enrollmentId: string | null;
  lessonKey: string;
  blockId: string;
  contentVersion: number;
  startedAt: Date;
  completedAt: Date | null;
  score: number | null;
  /** The learner's submitted answer — quiz choices, drag order, survey field values, etc. */
  response: unknown;
};

export type LearnerProjectStatus = 'DRAFT' | 'ACTIVE' | 'CHANGED' | 'ABANDONED';

export type LearnerProject = {
  id: string;
  organizationId: string;
  enrollmentId: string;
  socioId: string;
  presetKey: string | null;
  title: string | null;
  oneLiner: string | null;
  context: string | null;
  automationLevel: string | null;
  interests: string[];
  status: LearnerProjectStatus;
  lifeContext: string | null;
  reframedAt: Date | null;
  automationValidatedAt: Date | null;
  createdAt: Date;
  confirmedAt: Date | null;
  updatedAt: Date;
};

export type PutLearnerProjectInput = {
  presetKey: string;
  title: string;
  oneLiner: string;
  context?: string | null;
  automationLevel: string;
  interests: string[];
  status?: LearnerProjectStatus;
};

export type StageLearnerProjectInput = Omit<PutLearnerProjectInput, 'status' | 'title'> & {
  lifeContext: string;
  reframed: boolean;
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
  /** A.4. Null for pre-Stage-4 rows and any row whose socio has no resolvable enrollment. */
  enrollmentId: string | null;
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
   * Bootstrap method: looks up org ID from a legacy `Mentor.id` (for auth,
   * before tenant context exists).
   *
   * The legacy `Mentor` model carries no organizationId — the anchor is
   * `MentorProfile.organizationId`, linked back by the unique `mentorId`.
   * backfill-phase1 creates a profile for every mentor, so this resolves for
   * backfilled mentors; a mentor created after backfill without a profile
   * returns null. Unlike the socio chain there is no tiered fallback: it either
   * resolves authoritatively or it does not.
   */
  getOrganizationIdByMentorId(mentorId: string): Promise<string | null>;
  /**
   * Bootstrap method: every organization signal available for one mentor,
   * before any tenant context exists.
   *
   * Deliberately raw. It reports what is there — memberships, the orgs of the
   * socios assigned to them, their identity for the profile row — and decides
   * nothing. Which combination resolves, which is ambiguous, and which is a
   * refusal to guess is policy, and policy lives in
   * `src/lib/tenancy/mentorAnchor.ts` so the runtime path and the backfill
   * script share one definition instead of drifting into two.
   *
   * Returns null identity when no such mentor exists.
   */
  getMentorAnchorInputs(mentorId: string): Promise<{
    identity: { name: string; email: string; role: string } | null;
    memberships: { organizationId: string; role: string }[];
    assignedSocioCount: number;
    /** Distinct orgs of assigned socios. Shorter than assignedSocioCount when some are unanchored. */
    assignedSocioOrganizationIds: string[];
  }>;
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
  /**
   * Completed BlockProgress rows for one enrollment, oldest first. The player
   * surface (block-based courses) records most learner activity here rather
   * than as `Message` rows — see the mentor learner-detail activity strip,
   * which is this method's only reader.
   */
  getBlockProgressForEnrollment(ctx: TenantContext, enrollmentId: string): Promise<BlockProgress[]>;
  createEnrollment(ctx: TenantContext, cohortId: string, participantId: string): Promise<Enrollment>;
  updateEnrollmentStatus(ctx: TenantContext, enrollmentId: string, status: Enrollment['status']): Promise<Enrollment>;
  /**
   * The single shared entry point for beginning a course. Every live path that
   * starts a learner on a course (web self-serve selection, LTI launch, and any
   * future path) must call this rather than writing Enrollment/Cohort rows
   * itself — see Platform Restructure Phase A, Stage 1 (closes G3: chat-surface
   * and pbj-basics traffic never wrote live Enrollment rows).
   *
   * Idempotent: re-entry for the same (participantId, cohortId) resolves the
   * existing row via the unique constraint and reactivates it, never creating a
   * duplicate. When `cohortId` is omitted (self-serve web/whatsapp, which has
   * no pre-provisioned cohort the way LTI does), a per-program "direct-web"
   * cohort is found-or-created and used.
   */
  resolveOrCreateActiveEnrollment(ctx: TenantContext, input: {
    participantId: string;
    programVersionId: string;
    cohortId?: string;
    channel: string;
  }): Promise<Enrollment>;

  // ─── Learner Projects ─────────────────────────────────────────────────────
  /** The one current DRAFT/ACTIVE project for an enrollment, if any. */
  getCurrentLearnerProject(ctx: TenantContext, enrollmentId: string): Promise<LearnerProject | null>;
  /**
   * Whether this enrollment must complete project selection. A legacy exemption
   * is written once onto the enrollment and never inferred again on later reads.
   */
  learnerProjectSelectionRequired(ctx: TenantContext, enrollmentId: string, collectionKey: string): Promise<boolean>;
  saveLearnerProjectInterests(ctx: TenantContext, enrollmentId: string, interests: string[]): Promise<LearnerProject>;
  saveLearnerProjectLifeContext(ctx: TenantContext, enrollmentId: string, lifeContext: string): Promise<LearnerProject>;
  stageLearnerProject(ctx: TenantContext, enrollmentId: string, data: StageLearnerProjectInput): Promise<LearnerProject>;
  /**
   * Create or replace the enrollment's current project while enforcing the
   * status transition contract. ACTIVE → CHANGED returns the new DRAFT row.
   */
  putLearnerProject(ctx: TenantContext, enrollmentId: string, data: PutLearnerProjectInput): Promise<LearnerProject>;

  // ─── Enrollment Invitations ────────────────────────────────────────────────
  createInvitation(ctx: TenantContext, cohortId: string, channel: string, target: string, expiresAt: Date): Promise<EnrollmentInvitation>;
  getInvitationByToken(token: string): Promise<EnrollmentInvitation | null>;
  useInvitation(ctx: TenantContext, token: string): Promise<EnrollmentInvitation>;

  // ─── Participant Profiles ──────────────────────────────────────────────────
  getParticipants(ctx: TenantContext): Promise<ParticipantProfile[]>;
  getParticipantById(ctx: TenantContext, participantId: string): Promise<ParticipantProfile | null>;
  getParticipantBySocioId(ctx: TenantContext, socioId: string): Promise<ParticipantProfile | null>;
  /**
   * Create or update the profile for a socio.
   *
   * Idempotent when `data.socioId` is set: the profile is upserted on that
   * unique key, so callers on a repeatable path (course selection, seeding) can
   * run more than once without duplicating or colliding. A null `socioId` has no
   * natural key and falls back to a plain create.
   *
   * `organizationId` comes from `ctx` and is written only on creation — an
   * existing profile in a different org throws {@link TenantIsolationError}
   * rather than being re-homed.
   */
  createParticipant(ctx: TenantContext, data: Omit<ParticipantProfile, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Promise<ParticipantProfile>;
  updateParticipant(ctx: TenantContext, participantId: string, data: Partial<Pick<ParticipantProfile, 'displayName' | 'preferredLang' | 'metadata'>>): Promise<ParticipantProfile>;

  // ─── Socios (legacy model, org-scoped through ParticipantProfile) ─────────
  /**
   * Active socios belonging to one organization.
   *
   * Scoped through `participantProfile.organizationId` — the Socio row itself
   * carries no organizationId, so the profile is the tenancy anchor. Socios
   * without a ParticipantProfile are therefore NOT returned; that is deliberate,
   * an unanchored socio has no tenant and must not leak into a tenant's list.
   */
  getSociosForOrganization(organizationId: string): Promise<Socio[]>;
  /**
   * Active socios in one organization that are assigned to one mentor.
   *
   * `mentorId` alone is an ownership convention, not a tenancy boundary —
   * nothing in the schema stops `Socio.mentorId` from pointing at a mentor in a
   * different organization. Both filters are applied: the org scope is the
   * boundary, the mentor assignment narrows within it.
   */
  getSociosForMentor(organizationId: string, mentorId: string): Promise<Socio[]>;

  // ─── Mentor Profiles ───────────────────────────────────────────────────────
  getMentorProfiles(ctx: TenantContext): Promise<MentorProfile[]>;
  getMentorProfileById(ctx: TenantContext, profileId: string): Promise<MentorProfile | null>;
  getMentorProfileByMentorId(ctx: TenantContext, mentorId: string): Promise<MentorProfile | null>;
  createMentorProfile(ctx: TenantContext, data: Omit<MentorProfile, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Promise<MentorProfile>;
  updateMentorProfile(ctx: TenantContext, profileId: string, data: Partial<Pick<MentorProfile, 'displayName' | 'specialties' | 'metadata'>>): Promise<MentorProfile>;


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
      /**
       * A.4. Pass it when the caller already has it (the player surface's
       * gate does, via ValidatedPlayerContext.enrollmentId). When omitted,
       * resolved internally via the socio's curriculumCollectionKey +
       * participant lookup, preferring an ACTIVE enrollment — covers both
       * the chat-surface gate trigger and the standalone
       * /api/assessment/start retake path, neither of which carries a
       * PlayerAccess.
       */
      enrollmentId?: string;
    }
  ): Promise<AssessmentSession>;
  getAssessmentSessionById(ctx: TenantContext, sessionId: string): Promise<AssessmentSession | null>;
  getAssessmentSessionsForSocio(ctx: TenantContext, socioId: string): Promise<AssessmentSession[]>;
  /**
   * B.2 Stage 1: the tenant-isolated, enrollment-scoped twin of the legacy
   * `repo.getAssessmentSessionsForSocioLesson` (chat-surface only, socioId-
   * keyed, not tenant-isolated — see `prismaRepo.ts`, left untouched).
   *
   * Enrollment-only by design, no socioId parameter and no fallback: the
   * player surface (the only caller) always has PlayerAccess.enrollmentId in
   * hand. Precondition checked against production data before adding this
   * (2026-08-24): 0 of 9 AssessmentSession rows have enrollmentId null. Read
   * that as a green light to build, not a settled guarantee — 9 rows is the
   * entire table, not a representative sample, and all 9 are channel="web",
   * so the check did not actually exercise a non-web-channel session (the
   * one case this method must never see, being enrollment-only). If the
   * table grows, re-run the null check before assuming this still holds.
   */
  getAssessmentSessionsForSocioLesson(
    ctx: TenantContext,
    enrollmentId: string,
    lessonKey: string,
    blockId: string,
  ): Promise<AssessmentSession[]>;
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
