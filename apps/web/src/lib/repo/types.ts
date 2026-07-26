import type { ChannelType } from '@/lib/delivery/types';
import type { AssessmentSession } from './tenantRepo.types';

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

export type FlagSource = 'ai_marker' | 'sentiment_auto' | 'mentor_manual';

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
    getMessages(socioId: string, limit?: number): Promise<Message[]>;
    getMessagesWithSentiment(socioId: string, opts?: { limit?: number; since?: Date }): Promise<(Message & { sentiment?: { confusion: number; frustration: number; urgency: number; sentiment: string } })[]>;

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
    getAllSocios(): Promise<Socio[]>;
    getSociosByMentor(mentorId: string): Promise<Socio[]>;
    getSocioById(socioId: string): Promise<Socio | null>;
    createFlag(data: { socioId: string; level: string; reason: string; source?: string; messageId?: string }): Promise<SocioFlag>;
    getFlags(socioId: string): Promise<SocioFlag[]>;
    getActiveFlags(socioId: string): Promise<SocioFlag[]>;
    getAllUnresolvedFlags(): Promise<(SocioFlag & { socio: Socio })[]>;
    getUnresolvedFlagsByMentor(mentorId: string): Promise<(SocioFlag & { socio: Socio })[]>;
    resolveFlag(flagId: string, mentorId: string): Promise<SocioFlag>;
    upsertLessonProgress(socioId: string, lessonNumber: number, understanding: number | null, completed: boolean): Promise<LessonProgressRecord>;
    getLessonProgressAll(socioId: string): Promise<LessonProgressRecord[]>;

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
    getActivePrompt(category: string): Promise<SystemPrompt | null>;

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

    // Curriculum selection
    setSocioCurriculum(socioId: string, collectionKey: string): Promise<Socio>;

    // Assessment session methods (for gated teach-backs)
    getAssessmentSessionsForSocioLesson(
        socioId: string,
        lessonKey: string,
        blockId: string,
    ): Promise<AssessmentSession[]>;
}
