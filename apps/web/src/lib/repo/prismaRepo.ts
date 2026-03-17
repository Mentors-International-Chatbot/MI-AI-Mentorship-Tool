import { prisma } from "@/lib/db";
import { Repo, Socio, Message, SocioProgress, StaleSocio, LessonScores, SocioFlag, LessonProgressRecord, MessageSentimentRecord, FlagSource } from "./types";
import type { ChannelType } from "@/lib/delivery/types";
import {
    Socio as PrismaSocio,
    Message as PrismaMessage,
    SocioProgress as PrismaSocioProgress,
    SocioFlag as PrismaSocioFlag,
    LessonProgress as PrismaLessonProgress,
    MessageSentiment as PrismaMessageSentiment,
} from "@prisma/client";

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
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
    };
}

function toMessage(p: PrismaMessage): Message {
    return {
        id: p.id,
        socioId: p.socioId,
        role: p.role as Message["role"],
        content: p.content,
        senderType: p.senderType,
        createdAt: p.createdAt,
    };
}

function toSocioProgress(p: PrismaSocioProgress): SocioProgress {
    return {
        id: p.id,
        socioId: p.socioId,
        currentLessonNumber: p.currentLessonNumber,
        currentMessageIndex: p.currentMessageIndex,
        completedLessons: p.completedLessons,
        weeklyUnderstanding: p.weeklyUnderstanding,
        weeklyImplementation: p.weeklyImplementation,
        lastLessonCompletedAt: p.lastLessonCompletedAt,
        remindersSent: p.remindersSent,
        lastInteractionAt: p.lastInteractionAt,
    };
}

function toSocioFlag(p: PrismaSocioFlag): SocioFlag {
    return {
        id: p.id,
        socioId: p.socioId,
        level: p.level as 'RED' | 'YELLOW',
        reason: p.reason,
        source: p.source as FlagSource,
        resolved: p.resolved,
        resolvedBy: p.resolvedBy,
        resolvedAt: p.resolvedAt,
        messageId: p.messageId,
        createdAt: p.createdAt,
    };
}

function toSentiment(p: PrismaMessageSentiment): MessageSentimentRecord {
    return {
        id: p.id,
        messageId: p.messageId,
        socioId: p.socioId,
        confusion: p.confusion,
        frustration: p.frustration,
        urgency: p.urgency,
        sentiment: p.sentiment,
        topics: p.topics,
        createdAt: p.createdAt,
    };
}

function toLessonProgress(p: PrismaLessonProgress): LessonProgressRecord {
    return {
        id: p.id,
        socioId: p.socioId,
        lessonNumber: p.lessonNumber,
        understanding: p.understanding,
        completedAt: p.completedAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
    };
}

export const prismaRepo: Repo = {
    async getSocio(channelType: ChannelType, externalId: string) {
        const socio = await prisma.socio.findUnique({
            where: {
                channelType_externalId: { channelType, externalId },
            },
        });
        if (!socio) return null;
        return toSocio(socio);
    },

    async createSocio(channelType: ChannelType, externalId: string) {
        const socio = await prisma.socio.create({
            data: {
                channelType,
                externalId,
                whatsappPhoneNumber: channelType === 'whatsapp' ? externalId : null,
            },
        });
        return toSocio(socio);
    },

    async updateSocio(socioId, data) {
        const socio = await prisma.socio.update({
            where: { id: socioId },
            data: {
                name: data.name,
                language: data.language,
                businessName: data.businessName,
                businessDescription: data.businessDescription,
                status: data.status,
                promptOverrides: data.promptOverrides !== undefined ? (data.promptOverrides as object ?? undefined) : undefined,
            },
        });
        return toSocio(socio);
    },

    async addMessage(data) {
        const msg = await prisma.message.create({
            data: {
                socioId: data.socioId,
                role: data.role,
                content: data.content,
                senderType: (data as { senderType?: string }).senderType ?? null,
            },
        });
        return toMessage(msg);
    },

    async getMessages(socioId, limit) {
        const messages = await prisma.message.findMany({
            where: { socioId },
            orderBy: { createdAt: "desc" },
            ...(limit ? { take: limit } : {}),
        });
        return messages.reverse().map(toMessage);
    },

    async initProgress(socioId) {
        const progress = await prisma.socioProgress.create({
            data: { socioId },
        });
        return toSocioProgress(progress);
    },

    async getSocioProgress(socioId) {
        const progress = await prisma.socioProgress.upsert({
            where: { socioId },
            create: { socioId },
            update: {},
        });
        return toSocioProgress(progress);
    },

    async advanceMessage(socioId) {
        const progress = await prisma.socioProgress.update({
            where: { socioId },
            data: {
                currentMessageIndex: { increment: 1 },
            },
        });
        return toSocioProgress(progress);
    },

    async completeLesson(socioId, lessonNumber, scores: LessonScores) {
        const current = await prisma.socioProgress.findUnique({
            where: { socioId },
        });
        if (!current) throw new Error(`No progress record for socio ${socioId}`);

        const updatedCompleted = current.completedLessons.includes(lessonNumber)
            ? current.completedLessons
            : [...current.completedLessons, lessonNumber];

        const progress = await prisma.socioProgress.update({
            where: { socioId },
            data: {
                completedLessons: updatedCompleted,
                currentLessonNumber: lessonNumber + 1,
                currentMessageIndex: 0,
                weeklyUnderstanding: scores.understanding ?? current.weeklyUnderstanding,
                weeklyImplementation: scores.implementation ?? current.weeklyImplementation,
                lastLessonCompletedAt: new Date(),
                remindersSent: 0,
            },
        });
        return toSocioProgress(progress);
    },

    async getStaleLessonSocios(hoursThreshold, maxReminders) {
        const cutoff = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000);

        const rows = await prisma.socioProgress.findMany({
            where: {
                currentMessageIndex: { gt: 0 },
                remindersSent: { lt: maxReminders },
                lastInteractionAt: { lt: cutoff },
            },
            include: { socio: true },
        });

        return rows.map((row): StaleSocio => ({
            socio: toSocio(row.socio),
            progress: toSocioProgress(row),
        }));
    },

    async recordReminder(socioId) {
        const progress = await prisma.socioProgress.update({
            where: { socioId },
            data: { remindersSent: { increment: 1 } },
        });
        return toSocioProgress(progress);
    },

    async resetReminders(socioId) {
        const progress = await prisma.socioProgress.update({
            where: { socioId },
            data: { remindersSent: 0 },
        });
        return toSocioProgress(progress);
    },

    async touchInteraction(socioId) {
        const progress = await prisma.socioProgress.update({
            where: { socioId },
            data: { lastInteractionAt: new Date() },
        });
        return toSocioProgress(progress);
    },

    async getAllSocios() {
        const socios = await prisma.socio.findMany({
            where: { status: 'ACTIVE' },
            orderBy: { updatedAt: 'desc' },
        });
        return socios.map(toSocio);
    },

    async getSocioById(socioId) {
        const socio = await prisma.socio.findUnique({
            where: { id: socioId },
        });
        return socio ? toSocio(socio) : null;
    },

    async createFlag(data) {
        const flag = await prisma.socioFlag.create({
            data: {
                socioId: data.socioId,
                level: data.level,
                reason: data.reason,
                source: data.source ?? 'ai_marker',
                messageId: data.messageId ?? null,
            },
        });
        return toSocioFlag(flag);
    },

    async getFlags(socioId) {
        const flags = await prisma.socioFlag.findMany({
            where: { socioId },
            orderBy: { createdAt: 'desc' },
        });
        return flags.map(toSocioFlag);
    },

    async getActiveFlags(socioId) {
        const flags = await prisma.socioFlag.findMany({
            where: { socioId, resolved: false },
            orderBy: { createdAt: 'desc' },
        });
        return flags.map(toSocioFlag);
    },

    async getAllUnresolvedFlags() {
        const flags = await prisma.socioFlag.findMany({
            where: { resolved: false },
            include: { socio: true },
            orderBy: [{ level: 'asc' }, { createdAt: 'desc' }],
        });
        return flags.map((f) => ({
            ...toSocioFlag(f),
            socio: toSocio(f.socio),
        }));
    },

    async resolveFlag(flagId, mentorId) {
        const flag = await prisma.socioFlag.update({
            where: { id: flagId },
            data: { resolved: true, resolvedBy: mentorId, resolvedAt: new Date() },
        });
        return toSocioFlag(flag);
    },

    async upsertLessonProgress(socioId, lessonNumber, understanding, completed) {
        const row = await prisma.lessonProgress.upsert({
            where: { socioId_lessonNumber: { socioId, lessonNumber } },
            create: {
                socioId,
                lessonNumber,
                understanding,
                completedAt: completed ? new Date() : null,
            },
            update: {
                understanding,
                ...(completed ? { completedAt: new Date() } : {}),
            },
        });
        return toLessonProgress(row);
    },

    async getLessonProgressAll(socioId) {
        const rows = await prisma.lessonProgress.findMany({
            where: { socioId },
            orderBy: { lessonNumber: 'asc' },
        });
        return rows.map(toLessonProgress);
    },

    async saveSentiment(data) {
        const row = await prisma.messageSentiment.create({
            data: {
                messageId: data.messageId,
                socioId: data.socioId,
                confusion: data.confusion,
                frustration: data.frustration,
                urgency: data.urgency,
                sentiment: data.sentiment,
                topics: data.topics,
            },
        });
        return toSentiment(row);
    },

    async getSentimentsBySocio(socioId, since?) {
        const rows = await prisma.messageSentiment.findMany({
            where: {
                socioId,
                ...(since ? { createdAt: { gte: since } } : {}),
            },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(toSentiment);
    },
};
