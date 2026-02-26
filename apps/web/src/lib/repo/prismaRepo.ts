import { prisma } from "@/lib/db";
import { Repo, Socio, Message, SocioProgress, StaleSocio, LessonScores } from "./types";
import {
    Socio as PrismaSocio,
    Message as PrismaMessage,
    SocioProgress as PrismaSocioProgress,
} from "@prisma/client";

function toSocio(p: PrismaSocio): Socio {
    return {
        id: p.id,
        whatsappPhoneNumber: p.whatsappPhoneNumber,
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

export const prismaRepo: Repo = {
    async getSocio(phone) {
        const socio = await prisma.socio.findUnique({
            where: { whatsappPhoneNumber: phone },
        });
        if (!socio) return null;
        return toSocio(socio);
    },

    async createSocio(phone) {
        const socio = await prisma.socio.create({
            data: { whatsappPhoneNumber: phone },
        });
        return toSocio(socio);
    },

    async updateSocio(socioId, data) {
        const socio = await prisma.socio.update({
            where: { id: socioId },
            data: {
                name: data.name,
                businessName: data.businessName,
                businessDescription: data.businessDescription,
                status: data.status,
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
        let progress = await prisma.socioProgress.findUnique({
            where: { socioId },
        });
        if (!progress) {
            progress = await prisma.socioProgress.create({
                data: { socioId },
            });
        }
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
};
