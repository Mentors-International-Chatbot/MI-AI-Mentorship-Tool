import type { ChannelType } from '@/lib/delivery/types';

export type Role = "user" | "assistant" | "system" | "mentor";
export type SocioStatus = 'NEW' | 'AWAITING_LANGUAGE' | 'AWAITING_CONSENT' | 'AWAITING_NAME' | 'ACTIVE';

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
    createdAt: Date;
    updatedAt: Date;
};

export type Message = {
    id: string;
    socioId: string;
    role: Role;
    content: string;
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

export type SocioFlag = {
    id: string;
    socioId: string;
    level: 'RED' | 'YELLOW';
    reason: string;
    resolved: boolean;
    resolvedAt: Date | null;
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

export type StaleSocio = {
    socio: Socio;
    progress: SocioProgress;
};

export interface Repo {
    getSocio(channelType: ChannelType, externalId: string): Promise<Socio | null>;
    createSocio(channelType: ChannelType, externalId: string): Promise<Socio>;
    updateSocio(socioId: string, data: Partial<Socio>): Promise<Socio>;

    addMessage(data: Omit<Message, "id" | "createdAt">): Promise<Message>;
    getMessages(socioId: string, limit?: number): Promise<Message[]>;

    initProgress(socioId: string): Promise<SocioProgress>;
    getSocioProgress(socioId: string): Promise<SocioProgress>;
    advanceMessage(socioId: string): Promise<SocioProgress>;
    completeLesson(socioId: string, lessonNumber: number, scores: LessonScores): Promise<SocioProgress>;

    getStaleLessonSocios(hoursThreshold: number, maxReminders: number): Promise<StaleSocio[]>;
    recordReminder(socioId: string): Promise<SocioProgress>;
    resetReminders(socioId: string): Promise<SocioProgress>;
    touchInteraction(socioId: string): Promise<SocioProgress>;

    // Dashboard methods
    getAllSocios(): Promise<Socio[]>;
    getSocioById(socioId: string): Promise<Socio | null>;
    createFlag(socioId: string, level: 'RED' | 'YELLOW', reason: string): Promise<SocioFlag>;
    getFlags(socioId: string): Promise<SocioFlag[]>;
    upsertLessonProgress(socioId: string, lessonNumber: number, understanding: number | null, completed: boolean): Promise<LessonProgressRecord>;
    getLessonProgressAll(socioId: string): Promise<LessonProgressRecord[]>;
}
