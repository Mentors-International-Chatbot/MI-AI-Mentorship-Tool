import { Repo, Socio, Message, SocioProgress, StaleSocio, LessonScores } from "./types";

const sociosByPhone = new Map<string, Socio>();
const sociosById = new Map<string, Socio>();
const messagesBySocio = new Map<string, Message[]>();
const progressBySocio = new Map<string, SocioProgress>();

function makeDefaultProgress(socioId: string): SocioProgress {
    return {
        id: Math.random().toString(36).substring(7),
        socioId,
        currentLessonNumber: 1,
        currentMessageIndex: 0,
        completedLessons: [],
        weeklyUnderstanding: null,
        weeklyImplementation: null,
        lastLessonCompletedAt: null,
        remindersSent: 0,
        lastInteractionAt: null,
    };
}

export const inMemoryRepo: Repo = {
    async getSocio(phone) {
        return sociosByPhone.get(phone) || null;
    },

    async createSocio(phone) {
        const existing = sociosByPhone.get(phone);
        if (existing) return existing;

        const id = Math.random().toString(36).substring(7);
        const socio: Socio = {
            id,
            whatsappPhoneNumber: phone,
            name: null,
            status: "NEW",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        sociosByPhone.set(phone, socio);
        sociosById.set(id, socio);
        messagesBySocio.set(id, []);

        return socio;
    },

    async updateSocio(socioId, data) {
        const socio = sociosById.get(socioId);
        if (!socio) throw new Error("Socio not found");

        const updatedSocio = { ...socio, ...data, updatedAt: new Date() };

        sociosById.set(socioId, updatedSocio);
        sociosByPhone.set(updatedSocio.whatsappPhoneNumber, updatedSocio);

        return updatedSocio;
    },

    async addMessage(data) {
        const msg: Message = {
            id: Math.random().toString(36).substring(7),
            createdAt: new Date(),
            ...data
        };
        const arr = messagesBySocio.get(data.socioId) ?? [];
        arr.push(msg);
        messagesBySocio.set(data.socioId, arr);
        return msg;
    },

    async getMessages(socioId, limit) {
        const arr = messagesBySocio.get(socioId) ?? [];
        if (limit) {
            return arr.slice(Math.max(0, arr.length - limit));
        }
        return arr;
    },

    async initProgress(socioId) {
        const progress = makeDefaultProgress(socioId);
        progressBySocio.set(socioId, progress);
        return progress;
    },

    async getSocioProgress(socioId) {
        let progress = progressBySocio.get(socioId);
        if (!progress) {
            progress = makeDefaultProgress(socioId);
            progressBySocio.set(socioId, progress);
        }
        return progress;
    },

    async advanceMessage(socioId) {
        const progress = progressBySocio.get(socioId) ?? makeDefaultProgress(socioId);
        progress.currentMessageIndex += 1;
        progressBySocio.set(socioId, progress);
        return progress;
    },

    async completeLesson(socioId, lessonNumber, scores: LessonScores) {
        const progress = progressBySocio.get(socioId) ?? makeDefaultProgress(socioId);
        if (!progress.completedLessons.includes(lessonNumber)) {
            progress.completedLessons.push(lessonNumber);
        }
        progress.currentLessonNumber = lessonNumber + 1;
        progress.currentMessageIndex = 0;
        if (scores.understanding !== undefined) progress.weeklyUnderstanding = scores.understanding;
        if (scores.implementation !== undefined) progress.weeklyImplementation = scores.implementation;
        progress.lastLessonCompletedAt = new Date();
        progress.remindersSent = 0;
        progressBySocio.set(socioId, progress);
        return progress;
    },

    async getStaleLessonSocios(hoursThreshold, maxReminders) {
        const cutoff = Date.now() - hoursThreshold * 60 * 60 * 1000;
        const results: StaleSocio[] = [];

        for (const progress of progressBySocio.values()) {
            if (
                progress.currentMessageIndex > 0 &&
                progress.remindersSent < maxReminders &&
                progress.lastInteractionAt &&
                progress.lastInteractionAt.getTime() < cutoff
            ) {
                const socio = sociosById.get(progress.socioId);
                if (socio) results.push({ socio, progress });
            }
        }
        return results;
    },

    async recordReminder(socioId) {
        const progress = progressBySocio.get(socioId) ?? makeDefaultProgress(socioId);
        progress.remindersSent += 1;
        progressBySocio.set(socioId, progress);
        return progress;
    },

    async resetReminders(socioId) {
        const progress = progressBySocio.get(socioId) ?? makeDefaultProgress(socioId);
        progress.remindersSent = 0;
        progressBySocio.set(socioId, progress);
        return progress;
    },

    async touchInteraction(socioId) {
        const progress = progressBySocio.get(socioId) ?? makeDefaultProgress(socioId);
        progress.lastInteractionAt = new Date();
        progressBySocio.set(socioId, progress);
        return progress;
    },
};
