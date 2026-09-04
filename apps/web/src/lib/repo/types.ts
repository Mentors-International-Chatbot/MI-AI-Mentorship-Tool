import type { ChannelType } from '@/lib/delivery/types';
import type { SupportedLanguage } from '@/lib/i18n/languages';
import type { AssessmentSession } from './tenantRepo.types';
import type { ConfigScope } from '@/lib/ai/prompts/scope';

export type Role = "user" | "assistant" | "system" | "mentor";
export type SocioStatus =
    | 'NEW'
    | 'AWAITING_LANGUAGE'
    | 'AWAITING_CONSENT'
    | 'AWAITING_NAME'
    | 'AWAITING_BUSINESS'
    | 'ACTIVE';

export type Socio = {
    id: string;
    whatsappPhoneNumber?: string | null;
    channelType: string;
    externalId: string;
    language: string;
    name?: string | null;
    businessName?: string | null;
    businessDescription?: string | null;
    status: SocioStatus;
    promptOverrides?: Record<string, unknown> | null;
    aiPaused: boolean;
    mentorId?: string | null;
    curriculumCollectionKey?: string | null;
    /** Soft-archive marker (A.3). Non-null = archived; see the Prisma model's doc comment. */
    archivedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

export type Message = {
    id: string;
    socioId: string;
    role: Role;
    content: string;
    senderType?: string | null;
    assessmentSessionId?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt: Date;
};

export type SocioProgress = {
    id: string;
    socioId: string;
    currentLessonNumber: number;
    currentMessageIndex: number;
    completedLessons: number[];
    weeklyUnderstanding: number | null;
    weeklyImplementation: number | null;
    lastLessonCompletedAt: Date | null;
    remindersSent: number;
    lastInteractionAt: Date | null;
};

export interface LessonScores {
    understanding?: number;
    implementation?: number;
}

/**
 * Who or what wrote the flag row.
 *
 * `learner_request` is the only one that is not an inference. The other three
 * are a model or a threshold deciding something *about* a learner; this one is
 * the learner pressing a button and saying it. That distinction is why it gets
 * its own zone on `/dashboard/alerts` rather than competing with sentiment.
 */
export type FlagSource = 'ai_marker' | 'sentiment_auto' | 'mentor_manual' | 'learner_request';

export type FlagStatus =
    | 'OPEN'
    | 'ACKNOWLEDGED'
    | 'SNOOZED'
    | 'RESOLVED'
    | 'REOPENED'
    | 'AUTO_CLOSED';

/** The snooze durations the dashboard offers. */
export type SnoozeDays = 1 | 3 | 7;

export const SNOOZE_DAYS: readonly SnoozeDays[] = [1, 3, 7];

export function isSnoozeDays(v: unknown): v is SnoozeDays {
    return v === 1 || v === 3 || v === 7;
}

export type FlagDisposition =
    | 'addressed_in_conversation'
    | 'contacted_directly'
    | 'escalated'
    | 'monitoring'
    | 'false_positive';

export const FLAG_DISPOSITIONS: readonly FlagDisposition[] = [
    'addressed_in_conversation',
    'contacted_directly',
    'escalated',
    'monitoring',
    'false_positive',
];

export function isFlagDisposition(v: unknown): v is FlagDisposition {
    return typeof v === 'string' && (FLAG_DISPOSITIONS as readonly string[]).includes(v);
}

/**
 * Structured, language-free identity of *why* a flag fired. The rendered
 * sentence lives in the dashboard i18n table, not in the database, so a flag
 * reads in the mentor's language rather than the one it was written in.
 */
export type FlagReasonCode =
    | 'sentiment.urgency_high'
    | 'sentiment.distressed'
    | 'sentiment.confusion_elevated'
    | 'sentiment.frustration_elevated'
    | 'escalation.requested'
    /**
     * The learner pressed "request help from a human" on the player. Distinct
     * from `escalation.requested`, which is the *model* deciding that something
     * a learner typed in chat prose amounted to asking for a mentor.
     */
    | 'help.requested';

/**
 * Payload stored in `SocioFlag.reasonParams`. Every field is optional: which
 * ones are present depends on the reasonCode, and old rows have none of them.
 * `topics` is omitted entirely when the analyzer returned nothing useful.
 */
export type FlagReasonParams = {
    /** sentiment.urgency_high / sentiment.distressed */
    urgency?: number;
    sentiment?: string;
    /** sentiment.confusion_elevated / sentiment.frustration_elevated */
    value?: number;
    /** The configured threshold the signal crossed. Stored for audit, not rendered. */
    threshold?: number;
    topics?: string[];
    /**
     * escalation.requested / help.requested — the socio's own words, verbatim
     * and untranslated. Optional on `help.requested`: pressing the button with
     * an empty box is a complete request, and an absent reason renders as the
     * bare "asked to talk to a human" line rather than an empty quotation.
     */
    requestReason?: string;
    /**
     * help.requested — where the learner was standing when they asked.
     *
     * `SocioFlag` has no course column, so `collectionKey` is also what makes
     * "one open request per learner per course" expressible; see
     * `findOpenHelpRequest`. The rest is context a mentor needs before calling
     * back, captured at press time because none of it is recoverable later.
     */
    collectionKey?: string;
    lessonKey?: string;
    blockId?: string;
    projectTitle?: string;
};

export type MilestoneProgressRecord = {
    id: string;
    socioId: string;
    organizationId: string;
    collectionKey: string;
    milestoneKey: string;
    reachedAt: Date;
    source: string;
    evidence: string | null;
    /** A.4. Null for pre-Stage-4 rows and any row whose socio has no resolvable enrollment for collectionKey. */
    enrollmentId: string | null;
};

export type SocioFlag = {
    id: string;
    socioId: string;
    level: 'RED' | 'YELLOW';
    reason: string;
    source: FlagSource;
    resolved: boolean;
    resolvedBy: string | null;
    resolvedAt: Date | null;
    messageId: string | null;
    createdAt: Date;
    /** Lifecycle fields. `resolved` remains the source of truth; `status` is written but not yet read. */
    reasonCode: string | null;
    reasonParams: Record<string, unknown> | null;
    status: FlagStatus;
    disposition: FlagDisposition | null;
    snoozedUntil: Date | null;
    occurrenceCount: number;
    lastOccurredAt: Date | null;
};

export type FlagEventActorType = 'mentor' | 'ai' | 'system';

export type FlagEvent = {
    id: string;
    flagId: string;
    actorId: string | null;
    actorType: FlagEventActorType;
    eventType: string;
    disposition: FlagDisposition | null;
    note: string | null;
    linkedMessageId: string | null;
    createdAt: Date;
};

export type MessageSentimentRecord = {
    id: string;
    messageId: string;
    socioId: string;
    confusion: number;
    frustration: number;
    urgency: number;
    sentiment: string;
    topics: string[];
    createdAt: Date;
};

export type LessonProgressRecord = {
    id: string;
    socioId: string;
    lessonNumber: number;
    understanding: number | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

export type SocioContext = {
    id: string;
    socioId: string;
    businessType: string | null;
    products: string | null;
    monthlyRevenue: string | null;
    monthlyExpenses: string | null;
    numEmployees: string | null;
    location: string | null;
    challenges: string | null;
    goals: string | null;
    familyContext: string | null;
    customFacts: string | null;
    updatedAt: Date;
    createdAt: Date;
};

export type StaleSocio = {
    socio: Socio;
    progress: SocioProgress;
};

export type SocioDimensionState = {
    id: string;
    socioId: string;
    dimensionKey: string;
    level: number;
    trend: string;
    confidence: number;
    evidence: string | null;
    updatedAt: Date;
    createdAt: Date;
};

export type SystemPrompt = {
    id: string;
    version: string;
    content: string;
    category: string;
    active: boolean;
    authorId: string;
    /** Null means the row applies beyond one organization. See ConfigScope. */
    organizationId: string | null;
    /** ContentCollection.slug. Null means the row applies beyond one course. */
    collectionKey: string | null;
    createdAt: Date;
};

export type Summary = {
    id: string;
    socioId: string;
    weekStartDate: Date;
    content: string;
    flags: unknown | null;
    metrics: unknown | null;
    createdAt: Date;
};

export type FinancialSnapshot = {
    id: string;
    socioId: string;
    weekStartDate: Date;
    revenue: number;
    netProfit: number;
    source: string;
    createdAt: Date;
};

export type SocioFeedback = {
    id: string;
    socioId: string;
    lessonNum: number;
    rating: number | null;
    comment: string | null;
    createdAt: Date;
};

export interface Repo {
    getSocio(channelType: ChannelType, externalId: string): Promise<Socio | null>;
    createSocio(channelType: ChannelType, externalId: string): Promise<Socio>;
    updateSocio(socioId: string, data: Partial<Socio>): Promise<Socio>;

    addMessage(data: Omit<Message, "id" | "createdAt">): Promise<Message>;
    /**
     * `includeAssessment` defaults false, excluding reteach_gate/assessment-session
     * turns — that default is what makes this safe to hand the model as "the
     * conversation so far" (see `getLastAssistantMessageAt` below). A human
     * looking at the whole relationship, not just what the model can see —
     * the mentor dashboard's use case — passes `includeAssessment: true`.
     */
    getMessages(socioId: string, limit?: number, opts?: { includeAssessment?: boolean }): Promise<Message[]>;
    /**
     * When the AI (or a mentor) last spoke in the main thread, or null if never.
     *
     * The reference point for "did this happen since the AI last had a chance
     * to mention it" — see `prompts/gateRecency.ts`. Assessment messages are
     * excluded for the same reason `getMessages` excludes them: they are not
     * part of the conversation the model can see.
     */
    getLastAssistantMessageAt(socioId: string): Promise<Date | null>;
    getMessagesWithSentiment(socioId: string, opts?: { limit?: number; since?: Date; includeAssessment?: boolean }): Promise<(Message & { sentiment?: { confusion: number; frustration: number; urgency: number; sentiment: string } })[]>;
    /**
     * Timestamps of the socio's own messages, ascending. Deliberately narrow:
     * the quiet-return signal only needs to find gaps between messages, and
     * `getMessages` would pull every message body to do it.
     */
    getUserMessageDates(socioId: string): Promise<Date[]>;

    initProgress(socioId: string): Promise<SocioProgress>;
    getSocioProgress(socioId: string): Promise<SocioProgress>;
    advanceMessage(socioId: string): Promise<SocioProgress>;
    /** Resets message index to 0, used for return_for_reteach */
    resetMessageIndex(socioId: string): Promise<SocioProgress>;
    completeLesson(socioId: string, lessonNumber: number, scores: LessonScores): Promise<SocioProgress>;

    getStaleLessonSocios(hoursThreshold: number, maxReminders: number): Promise<StaleSocio[]>;
    recordReminder(socioId: string): Promise<SocioProgress>;
    resetReminders(socioId: string): Promise<SocioProgress>;
    touchInteraction(socioId: string): Promise<SocioProgress>;

    // Dashboard methods
    /**
     * Every active socio on the platform, across every organization.
     *
     * Deliberately NOT tenant-scoped, and platform-admin-only. This is the one
     * legitimate cross-tenant socio read: platform admin needs the whole-fleet
     * view, and scoping it would hide exactly the rows that view exists for.
     * Same posture as GET /api/feedback.
     *
     * Anything acting on behalf of a single organization — mentors, and
     * org-level admins once they ship — must use
     * `tenantRepo.getSociosForOrganization` / `getSociosForMentor` instead.
     */
    getSociosAcrossAllOrganizations(): Promise<Socio[]>;
    getSocioById(socioId: string): Promise<Socio | null>;
    createFlag(data: { socioId: string; level: string; reason: string; source?: string; messageId?: string; reasonCode?: FlagReasonCode; reasonParams?: FlagReasonParams }): Promise<SocioFlag>;
    getFlags(socioId: string): Promise<SocioFlag[]>;
    getActiveFlags(socioId: string): Promise<SocioFlag[]>;
    /**
     * Records that an already-open flag fired again: `occurrenceCount += 1` and
     * `lastOccurredAt = now`. Does not touch status, level or reason.
     *
     * These two columns shipped with the flag lifecycle and nothing wrote them
     * until this method — every row read `occurrenceCount: 1, lastOccurredAt:
     * null` regardless of how many times the underlying thing happened. Four
     * presses of "I need help" is a materially stronger signal than one, and
     * collapsing them to a single undated row threw that away.
     */
    recordFlagOccurrence(flagId: string, at?: Date): Promise<SocioFlag>;
    getAllUnresolvedFlags(): Promise<(SocioFlag & { socio: Socio })[]>;
    getUnresolvedFlagsByMentor(mentorId: string): Promise<(SocioFlag & { socio: Socio })[]>;
    /**
     * Always sets resolved/resolvedBy/resolvedAt. When `outcome` is present it also
     * writes status='RESOLVED' plus the disposition, and appends a FlagEvent.
     */
    resolveFlag(
        flagId: string,
        mentorId: string,
        outcome?: { disposition: FlagDisposition; note?: string; linkedMessageId?: string },
    ): Promise<SocioFlag>;

    /**
     * status='ACKNOWLEDGED' + a FlagEvent. Deliberately does NOT set `resolved`:
     * seeing an alert is not the same as dealing with it, and health still counts it.
     */
    acknowledgeFlag(flagId: string, mentorId: string, note?: string): Promise<SocioFlag>;
    /** status='SNOOZED' + snoozedUntil `days` out + a FlagEvent. Leaves `resolved` alone. */
    snoozeFlag(flagId: string, mentorId: string, days: SnoozeDays, note?: string): Promise<SocioFlag>;

    // Flag lifecycle audit trail (append-only)
    appendFlagEvent(data: {
        flagId: string;
        actorId?: string | null;
        actorType: FlagEventActorType;
        eventType: string;
        disposition?: FlagDisposition;
        note?: string;
        linkedMessageId?: string;
    }): Promise<FlagEvent>;
    getFlagEvents(flagId: string): Promise<FlagEvent[]>;
    upsertLessonProgress(socioId: string, lessonNumber: number, understanding: number | null, completed: boolean): Promise<LessonProgressRecord>;
    getLessonProgressAll(socioId: string): Promise<LessonProgressRecord[]>;

    // Mentor/admin UI preferences
    /** Returns null when the mentor is unknown or the stored value is not a supported language. */
    getMentorPreferredLanguage(mentorId: string): Promise<SupportedLanguage | null>;
    /** Display names for the given mentor ids, keyed by id. Unknown ids are omitted. */
    getMentorNames(mentorIds: string[]): Promise<Record<string, string>>;
    /** Returns false when no mentor row matched. */
    setMentorPreferredLanguage(mentorId: string, language: SupportedLanguage): Promise<boolean>;

    // Sentiment methods
    saveSentiment(data: Omit<MessageSentimentRecord, 'id' | 'createdAt'>): Promise<MessageSentimentRecord>;
    getSentimentsBySocio(socioId: string, since?: Date): Promise<MessageSentimentRecord[]>;

    // Context memory methods
    getSocioContext(socioId: string): Promise<SocioContext | null>;
    upsertSocioContext(socioId: string, data: Partial<SocioContext>): Promise<SocioContext>;

    // Dimension state methods (sensing/steering)
    getDimensionState(socioId: string, dimensionKey: string): Promise<SocioDimensionState | null>;
    getDimensionStateMap(socioId: string): Promise<SocioDimensionState[]>;
    upsertDimensionState(socioId: string, state: Omit<SocioDimensionState, 'id' | 'socioId' | 'createdAt' | 'updatedAt'>): Promise<SocioDimensionState>;
    clearDimensionState(socioId: string): Promise<void>;

    // System prompt methods
    /**
     * Most specific active prompt for `category` within `scope`, walking
     * (org, collection) → (org, null) → (null, null). Omitting `scope` reads
     * the platform tier only, which is what every pre-scoping caller did.
     */
    getActivePrompt(category: string, scope?: ConfigScope): Promise<SystemPrompt | null>;

    // Summary methods
    createSummary(data: Omit<Summary, 'id' | 'createdAt'>): Promise<Summary>;
    getSummaries(socioId: string, limit?: number): Promise<Summary[]>;

    // Financial snapshot methods
    upsertFinancialSnapshot(socioId: string, weekStartDate: Date, data: { revenue: number; netProfit: number; source?: string }): Promise<FinancialSnapshot>;
    getFinancialSnapshots(socioId: string, limit?: number): Promise<FinancialSnapshot[]>;

    // Feedback methods
    createFeedback(data: Omit<SocioFeedback, 'id' | 'createdAt'>): Promise<SocioFeedback>;
    getFeedback(socioId: string): Promise<SocioFeedback[]>;

    // Flag by ID
    getFlagById(flagId: string): Promise<SocioFlag | null>;
    getFlagWithSocio(flagId: string): Promise<(SocioFlag & { socio: Socio }) | null>;

    /**
     * The single write path for `AuditLog`, so a `/dashboard/*` route can
     * record one without the `no-restricted-syntax` prisma ban forcing it to
     * either skip the log or become an `/admin/*`-only exemption. Fire-and-
     * write semantics are the caller's choice, not this method's — it does
     * not swallow errors.
     */
    createAuditLog(entry: {
        actorId: string;
        action: string;
        targetType: string;
        targetId?: string;
        metadata?: Record<string, unknown>;
    }): Promise<void>;

    // Curriculum selection
    setSocioCurriculum(socioId: string, collectionKey: string): Promise<Socio>;

    /**
     * Soft-archive (A.3). Sets archivedAt, never deletes. Idempotent —
     * archiving an already-archived socio does not overwrite the original
     * archivedAt timestamp, so the record of *when* it was archived survives
     * a repeat call.
     */
    archiveSocio(socioId: string): Promise<Socio>;

    // ─── Milestone progress ────────────────────────────────────────────────
    /**
     * Records that a participant reached a milestone. Idempotent on
     * (enrollmentId, milestoneKey) as of A.6.1 — the AI can emit the same
     * marker twice within one enrollment and the first `reachedAt` is the
     * true one, so a repeat must never move it. A second enrollment reaching
     * the same milestone gets its own fresh row rather than colliding with
     * the first enrollment's.
     */
    recordMilestoneReached(data: {
        socioId: string;
        organizationId: string;
        collectionKey: string;
        milestoneKey: string;
        source?: string;
        evidence?: string;
        /**
         * A.4. Pass it when the caller already has it (the player surface
         * does, via ValidatedPlayerContext.enrollmentId). When omitted (the
         * chat-surface case — there is no PlayerAccess/context to carry one),
         * the repo resolves it via participant + collectionKey, preferring an
         * ACTIVE enrollment. Never overwritten on the repeat-marker no-op
         * update.
         */
        enrollmentId?: string;
    }): Promise<MilestoneProgressRecord>;
    /** Milestones this participant has reached on this course, oldest first. */
    getMilestoneProgress(socioId: string, collectionKey: string): Promise<MilestoneProgressRecord[]>;

    // Assessment session methods (for gated teach-backs)
    getAssessmentSessionsForSocioLesson(
        socioId: string,
        lessonKey: string,
        blockId: string,
    ): Promise<AssessmentSession[]>;
}
