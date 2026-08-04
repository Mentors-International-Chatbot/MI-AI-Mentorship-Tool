import { Repo, Socio, Message, SocioProgress, StaleSocio, LessonScores, SocioFlag, LessonProgressRecord, MessageSentimentRecord, FlagSource, SocioContext, SocioDimensionState, SystemPrompt, Summary, FinancialSnapshot, SocioFeedback } from "./types";
import type { ChannelType } from "@/lib/delivery/types";
import { DEFAULT_LANGUAGE, type SupportedLanguage } from '@/lib/i18n/languages';

const sociosByKey = new Map<string, Socio>();
const sociosById = new Map<string, Socio>();
const messagesBySocio = new Map<string, Message[]>();
const progressBySocio = new Map<string, SocioProgress>();
const flagsBySocio = new Map<string, SocioFlag[]>();
const lessonProgressBySocio = new Map<string, Map<number, LessonProgressRecord>>();
const sentimentsByMessage = new Map<string, MessageSentimentRecord>();
const contextBySocio = new Map<string, SocioContext>();
const dimensionStateBySocio = new Map<string, Map<string, SocioDimensionState>>();
const systemPrompts = new Map<string, SystemPrompt[]>();
const summariesBySocio = new Map<string, Summary[]>();
const financialsBySocio = new Map<string, FinancialSnapshot[]>();
const feedbackBySocio = new Map<string, SocioFeedback[]>();
const mentorLanguageById = new Map<string, SupportedLanguage>();

function channelKey(channelType: string, externalId: string): string {
    return `${channelType}:${externalId}`;
}

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
    async getSocio(channelType: ChannelType, externalId: string) {
        return sociosByKey.get(channelKey(channelType, externalId)) || null;
    },

    async createSocio(channelType: ChannelType, externalId: string) {
        const key = channelKey(channelType, externalId);
        const existing = sociosByKey.get(key);
        if (existing) return existing;

        const id = Math.random().toString(36).substring(7);
        const socio: Socio = {
            id,
            whatsappPhoneNumber: channelType === 'whatsapp' ? externalId : null,
            channelType,
            externalId,
            language: DEFAULT_LANGUAGE,
            name: null,
            status: "NEW",
            aiPaused: false,
            mentorId: null,
            curriculumCollectionKey: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        sociosByKey.set(key, socio);
        sociosById.set(id, socio);
        messagesBySocio.set(id, []);

        return socio;
    },

    async updateSocio(socioId, data) {
        const socio = sociosById.get(socioId);
        if (!socio) throw new Error("Socio not found");

        const updatedSocio = { ...socio, ...data, updatedAt: new Date() };

        sociosById.set(socioId, updatedSocio);
        sociosByKey.set(channelKey(updatedSocio.channelType, updatedSocio.externalId), updatedSocio);

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

    async getUserMessageDates(socioId) {
        const arr = messagesBySocio.get(socioId) ?? [];
        return arr
            .filter((m) => m.role === 'user')
            .map((m) => m.createdAt)
            .sort((a, b) => a.getTime() - b.getTime());
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

    async resetMessageIndex(socioId) {
        const progress = progressBySocio.get(socioId) ?? makeDefaultProgress(socioId);
        progress.currentMessageIndex = 0;
        progressBySocio.set(socioId, progress);
        return progress;
    },

    async getAssessmentSessionsForSocioLesson(_socioId: string, _lessonKey: string, _blockId?: string) {
        // In-memory repo doesn't track assessment sessions
        return [];
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

    /** Cross-tenant by design — platform admin only. See RepoInterface docs. */
    async getSociosAcrossAllOrganizations() {
        return Array.from(sociosById.values()).filter(s => s.status === 'ACTIVE');
    },

    async getSocioById(socioId) {
        return sociosById.get(socioId) ?? null;
    },

    async createFlag(data) {
        const flag: SocioFlag = {
            id: Math.random().toString(36).substring(7),
            socioId: data.socioId,
            level: data.level as 'RED' | 'YELLOW',
            reason: data.reason,
            source: (data.source ?? 'ai_marker') as FlagSource,
            resolved: false,
            resolvedBy: null,
            resolvedAt: null,
            messageId: data.messageId ?? null,
            createdAt: new Date(),
        };
        const arr = flagsBySocio.get(data.socioId) ?? [];
        arr.push(flag);
        flagsBySocio.set(data.socioId, arr);
        return flag;
    },

    async getFlags(socioId) {
        return flagsBySocio.get(socioId) ?? [];
    },

    async getActiveFlags(socioId) {
        return (flagsBySocio.get(socioId) ?? []).filter(f => !f.resolved);
    },

    async getAllUnresolvedFlags() {
        const result: (SocioFlag & { socio: Socio })[] = [];
        for (const [socioId, flags] of flagsBySocio) {
            const socio = sociosById.get(socioId);
            if (!socio) continue;
            for (const f of flags) {
                if (!f.resolved) result.push({ ...f, socio });
            }
        }
        return result;
    },

    async getUnresolvedFlagsByMentor(mentorId: string) {
        const result: (SocioFlag & { socio: Socio })[] = [];
        for (const [socioId, flags] of flagsBySocio) {
            const socio = sociosById.get(socioId);
            if (!socio || socio.mentorId !== mentorId) continue;
            for (const f of flags) {
                if (!f.resolved) result.push({ ...f, socio });
            }
        }
        return result;
    },

    async resolveFlag(flagId, mentorId) {
        for (const flags of flagsBySocio.values()) {
            const flag = flags.find(f => f.id === flagId);
            if (flag) {
                flag.resolved = true;
                flag.resolvedBy = mentorId;
                flag.resolvedAt = new Date();
                return flag;
            }
        }
        throw new Error(`Flag ${flagId} not found`);
    },

    async upsertLessonProgress(socioId, lessonNumber, understanding, completed) {
        const map = lessonProgressBySocio.get(socioId) ?? new Map();
        const existing = map.get(lessonNumber);
        const now = new Date();
        const record: LessonProgressRecord = {
            id: existing?.id ?? Math.random().toString(36).substring(7),
            socioId,
            lessonNumber,
            understanding,
            completedAt: completed ? now : (existing?.completedAt ?? null),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        map.set(lessonNumber, record);
        lessonProgressBySocio.set(socioId, map);
        return record;
    },

    async getLessonProgressAll(socioId) {
        const map = lessonProgressBySocio.get(socioId) ?? new Map();
        return Array.from(map.values()).sort((a, b) => a.lessonNumber - b.lessonNumber);
    },

    async saveSentiment(data) {
        const record: MessageSentimentRecord = {
            id: Math.random().toString(36).substring(7),
            ...data,
            createdAt: new Date(),
        };
        sentimentsByMessage.set(data.messageId, record);
        return record;
    },

    async getSentimentsBySocio(socioId, since?) {
        const results: MessageSentimentRecord[] = [];
        for (const r of sentimentsByMessage.values()) {
            if (r.socioId === socioId && (!since || r.createdAt >= since)) {
                results.push(r);
            }
        }
        return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    async getMentorPreferredLanguage(mentorId) {
        return mentorLanguageById.get(mentorId) ?? null;
    },

    async setMentorPreferredLanguage(mentorId, language) {
        // No mentor store in the test double, so every id is treated as valid.
        mentorLanguageById.set(mentorId, language);
        return true;
    },

    async getSocioContext(socioId) {
        return contextBySocio.get(socioId) ?? null;
    },

    async upsertSocioContext(socioId, data) {
        const existing = contextBySocio.get(socioId);
        const now = new Date();
        const ctx: SocioContext = {
            id: existing?.id ?? Math.random().toString(36).substring(7),
            socioId,
            businessType: data.businessType !== undefined ? (data.businessType ?? null) : (existing?.businessType ?? null),
            products: data.products !== undefined ? (data.products ?? null) : (existing?.products ?? null),
            monthlyRevenue: data.monthlyRevenue !== undefined ? (data.monthlyRevenue ?? null) : (existing?.monthlyRevenue ?? null),
            monthlyExpenses: data.monthlyExpenses !== undefined ? (data.monthlyExpenses ?? null) : (existing?.monthlyExpenses ?? null),
            numEmployees: data.numEmployees !== undefined ? (data.numEmployees ?? null) : (existing?.numEmployees ?? null),
            location: data.location !== undefined ? (data.location ?? null) : (existing?.location ?? null),
            challenges: data.challenges !== undefined ? (data.challenges ?? null) : (existing?.challenges ?? null),
            goals: data.goals !== undefined ? (data.goals ?? null) : (existing?.goals ?? null),
            familyContext: data.familyContext !== undefined ? (data.familyContext ?? null) : (existing?.familyContext ?? null),
            customFacts: data.customFacts !== undefined ? (data.customFacts ?? null) : (existing?.customFacts ?? null),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        contextBySocio.set(socioId, ctx);
        return ctx;
    },

    // ─── New methods ─────────────────────────────────────────────────────────────

    async getMessagesWithSentiment(socioId, opts) {
        const arr = messagesBySocio.get(socioId) ?? [];
        let filtered = arr;
        if (opts?.since) {
            filtered = arr.filter(m => m.createdAt > opts.since!);
        }
        if (opts?.limit) {
            filtered = filtered.slice(Math.max(0, filtered.length - opts.limit));
        }
        return filtered.map(m => {
            const sentiment = sentimentsByMessage.get(m.id);
            return sentiment ? { ...m, sentiment: { confusion: sentiment.confusion, frustration: sentiment.frustration, urgency: sentiment.urgency, sentiment: sentiment.sentiment } } : m;
        });
    },

    async getDimensionState(socioId, dimensionKey) {
        const map = dimensionStateBySocio.get(socioId);
        return map?.get(dimensionKey) ?? null;
    },

    async getDimensionStateMap(socioId) {
        const map = dimensionStateBySocio.get(socioId);
        return map ? Array.from(map.values()) : [];
    },

    async upsertDimensionState(socioId, state) {
        const now = new Date();
        const map = dimensionStateBySocio.get(socioId) ?? new Map();
        const existing = map.get(state.dimensionKey);
        const record: SocioDimensionState = {
            id: existing?.id ?? Math.random().toString(36).substring(7),
            socioId,
            dimensionKey: state.dimensionKey,
            level: state.level,
            trend: state.trend,
            confidence: state.confidence,
            evidence: state.evidence,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        map.set(state.dimensionKey, record);
        dimensionStateBySocio.set(socioId, map);
        return record;
    },

    async clearDimensionState(socioId) {
        dimensionStateBySocio.delete(socioId);
    },

    async getActivePrompt(category) {
        const prompts = systemPrompts.get(category) ?? [];
        const active = prompts.find(p => p.active);
        return active ?? null;
    },

    async createSummary(data) {
        const summary: Summary = {
            id: Math.random().toString(36).substring(7),
            ...data,
            createdAt: new Date(),
        };
        const arr = summariesBySocio.get(data.socioId) ?? [];
        arr.unshift(summary);
        summariesBySocio.set(data.socioId, arr);
        return summary;
    },

    async getSummaries(socioId, limit) {
        const arr = summariesBySocio.get(socioId) ?? [];
        return limit ? arr.slice(0, limit) : arr;
    },

    async upsertFinancialSnapshot(socioId, weekStartDate, data) {
        const arr = financialsBySocio.get(socioId) ?? [];
        const existing = arr.find(f => f.weekStartDate.getTime() === weekStartDate.getTime());
        if (existing) {
            existing.revenue = data.revenue;
            existing.netProfit = data.netProfit;
            existing.source = data.source ?? 'ai_marker';
            return existing;
        }
        const snapshot: FinancialSnapshot = {
            id: Math.random().toString(36).substring(7),
            socioId,
            weekStartDate,
            revenue: data.revenue,
            netProfit: data.netProfit,
            source: data.source ?? 'ai_marker',
            createdAt: new Date(),
        };
        arr.unshift(snapshot);
        financialsBySocio.set(socioId, arr);
        return snapshot;
    },

    async getFinancialSnapshots(socioId, limit) {
        const arr = financialsBySocio.get(socioId) ?? [];
        return limit ? arr.slice(0, limit) : arr;
    },

    async createFeedback(data) {
        const feedback: SocioFeedback = {
            id: Math.random().toString(36).substring(7),
            ...data,
            createdAt: new Date(),
        };
        const arr = feedbackBySocio.get(data.socioId) ?? [];
        arr.unshift(feedback);
        feedbackBySocio.set(data.socioId, arr);
        return feedback;
    },

    async getFeedback(socioId) {
        return feedbackBySocio.get(socioId) ?? [];
    },

    async getFlagById(flagId) {
        for (const flags of flagsBySocio.values()) {
            const flag = flags.find(f => f.id === flagId);
            if (flag) return flag;
        }
        return null;
    },

    async getFlagWithSocio(flagId) {
        for (const [socioId, flags] of flagsBySocio) {
            const flag = flags.find(f => f.id === flagId);
            if (flag) {
                const socio = sociosById.get(socioId);
                if (socio) return { ...flag, socio };
            }
        }
        return null;
    },

    async setSocioCurriculum(socioId, collectionKey) {
        const socio = sociosById.get(socioId);
        if (!socio) throw new Error("Socio not found");
        socio.curriculumCollectionKey = collectionKey;
        return socio;
    },
};
