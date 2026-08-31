import { prisma } from "@/lib/db";
import { Repo, Socio, Message, SocioProgress, StaleSocio, LessonScores, SocioFlag, LessonProgressRecord, MessageSentimentRecord, FlagSource, FlagStatus, FlagDisposition, FlagEvent, FlagEventActorType, SocioContext, SocioDimensionState, SystemPrompt, Summary, FinancialSnapshot, SocioFeedback } from "./types";
import type { ChannelType } from "@/lib/delivery/types";
import { scopeTiers } from "@/lib/ai/prompts/scope";
import { activeFlagWhere } from "@/lib/flags/active";
import { DEFAULT_LANGUAGE, isSupportedLanguage } from "@/lib/i18n/languages";
import {
    Prisma,
    OnboardingStatus,
    Socio as PrismaSocio,
    Message as PrismaMessage,
    SocioProgress as PrismaSocioProgress,
    SocioFlag as PrismaSocioFlag,
    FlagEvent as PrismaFlagEvent,
    LessonProgress as PrismaLessonProgress,
    MessageSentiment as PrismaMessageSentiment,
    SocioContext as PrismaSocioContext,
    SocioDimensionState as PrismaSocioDimensionState,
    SystemPrompt as PrismaSystemPrompt,
    Summary as PrismaSummary,
    FinancialSnapshot as PrismaFinancialSnapshot,
    SocioFeedback as PrismaSocioFeedback,
} from "@prisma/client";

/** Race-safe: concurrent create/upsert paths can hit P2002 on socio_id; retry read after conflict. */
async function ensureSocioProgressRow(socioId: string): Promise<PrismaSocioProgress> {
    const existing = await prisma.socioProgress.findUnique({
        where: { socioId },
    });
    if (existing) return existing;

    try {
        return await prisma.socioProgress.create({
            data: { socioId },
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            const row = await prisma.socioProgress.findUnique({
                where: { socioId },
            });
            if (row) return row;
        }
        throw e;
    }
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
        archivedAt: p.archivedAt,
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
        assessmentSessionId: p.assessmentSessionId,
        metadata: p.metadata as Record<string, unknown> | null,
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
        reasonCode: p.reasonCode,
        reasonParams: p.reasonParams as Record<string, unknown> | null,
        status: p.status as FlagStatus,
        disposition: p.disposition as FlagDisposition | null,
        snoozedUntil: p.snoozedUntil,
        occurrenceCount: p.occurrenceCount,
        lastOccurredAt: p.lastOccurredAt,
    };
}

function toFlagEvent(p: PrismaFlagEvent): FlagEvent {
    return {
        id: p.id,
        flagId: p.flagId,
        actorId: p.actorId,
        actorType: p.actorType as FlagEventActorType,
        eventType: p.eventType,
        disposition: p.disposition as FlagDisposition | null,
        note: p.note,
        linkedMessageId: p.linkedMessageId,
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

function toSocioContext(p: PrismaSocioContext): SocioContext {
    return {
        id: p.id,
        socioId: p.socioId,
        businessType: p.businessType,
        products: p.products,
        monthlyRevenue: p.monthlyRevenue,
        monthlyExpenses: p.monthlyExpenses,
        numEmployees: p.numEmployees,
        location: p.location,
        challenges: p.challenges,
        goals: p.goals,
        familyContext: p.familyContext,
        customFacts: p.customFacts,
        updatedAt: p.updatedAt,
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

function toDimensionState(p: PrismaSocioDimensionState): SocioDimensionState {
    return {
        id: p.id,
        socioId: p.socioId,
        dimensionKey: p.dimensionKey,
        level: p.level,
        trend: p.trend,
        confidence: p.confidence,
        evidence: p.evidence,
        updatedAt: p.updatedAt,
        createdAt: p.createdAt,
    };
}

function toSystemPrompt(p: PrismaSystemPrompt): SystemPrompt {
    return {
        id: p.id,
        version: p.version,
        content: p.content,
        category: p.category,
        active: p.active,
        authorId: p.authorId,
        organizationId: p.organizationId,
        collectionKey: p.collectionKey,
        createdAt: p.createdAt,
    };
}

function toSummary(p: PrismaSummary): Summary {
    return {
        id: p.id,
        socioId: p.socioId,
        weekStartDate: p.weekStartDate,
        content: p.content,
        flags: p.flags,
        metrics: p.metrics,
        createdAt: p.createdAt,
    };
}

function toFinancialSnapshot(p: PrismaFinancialSnapshot): FinancialSnapshot {
    return {
        id: p.id,
        socioId: p.socioId,
        weekStartDate: p.weekStartDate,
        revenue: p.revenue,
        netProfit: p.netProfit,
        source: p.source,
        createdAt: p.createdAt,
    };
}

function toFeedback(p: PrismaSocioFeedback): SocioFeedback {
    return {
        id: p.id,
        socioId: p.socioId,
        lessonNum: p.lessonNum,
        rating: p.rating,
        comment: p.comment,
        createdAt: p.createdAt,
    };
}

export const prismaRepo: Repo = {
    async getSocio(channelType: ChannelType, externalId: string) {
        let socio = await prisma.socio.findUnique({
            where: {
                channelType_externalId: { channelType, externalId },
            },
        });

        // Web chat passes session.userId (socio UUID) as externalId; match by id when
        // the row was created with a different externalId (e.g. legacy phone-based).
        if (!socio && channelType === "web") {
            socio = await prisma.socio.findUnique({
                where: { id: externalId },
            });
        }

        // Fallback: if not found by externalId, try matching by whatsappPhoneNumber
        // (happens when the socio signed up via web before messaging on WhatsApp)
        if (!socio && channelType === 'whatsapp') {
            socio = await prisma.socio.findUnique({
                where: { whatsappPhoneNumber: externalId },
            });
            if (socio) {
                // Sync the externalId so future lookups work
                socio = await prisma.socio.update({
                    where: { id: socio.id },
                    data: { externalId },
                });
            }
        }

        if (!socio) return null;
        return toSocio(socio);
    },

    async createSocio(channelType: ChannelType, externalId: string) {
        const socio = await prisma.socio.create({
            data: {
                channelType,
                externalId,
                whatsappPhoneNumber: channelType === 'whatsapp' ? externalId : null,
                // Set explicitly rather than relying on the DB column default,
                // which is still "es" (changing it needs a migration).
                language: DEFAULT_LANGUAGE,
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
                status: data.status as OnboardingStatus | undefined,
                promptOverrides: data.promptOverrides !== undefined ? (data.promptOverrides as object ?? undefined) : undefined,
                aiPaused: data.aiPaused,
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
                assessmentSessionId: (data as { assessmentSessionId?: string }).assessmentSessionId ?? null,
                metadata: ((data as { metadata?: Record<string, unknown> }).metadata as object) ?? undefined,
            },
        });
        return toMessage(msg);
    },

    async getMessages(socioId, limit, opts) {
        const messages = await prisma.message.findMany({
            where: { socioId, ...(opts?.includeAssessment ? {} : { assessmentSessionId: null }) },
            orderBy: { createdAt: "desc" },
            ...(limit ? { take: limit } : {}),
        });
        return messages.reverse().map(toMessage);
    },

    async getLastAssistantMessageAt(socioId) {
        const row = await prisma.message.findFirst({
            where: {
                socioId,
                assessmentSessionId: null,
                role: { in: ['assistant', 'mentor'] },
            },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
        });
        return row?.createdAt ?? null;
    },

    async getUserMessageDates(socioId) {
        const rows = await prisma.message.findMany({
            where: { socioId, role: 'user', assessmentSessionId: null },
            select: { createdAt: true },
            orderBy: { createdAt: 'asc' },
        });
        return rows.map((r) => r.createdAt);
    },

    async getMessagesWithSentiment(socioId, opts) {
        const messages = await prisma.message.findMany({
            where: {
                socioId,
                ...(opts?.includeAssessment ? {} : { assessmentSessionId: null }),
                ...(opts?.since ? { createdAt: { gt: opts.since } } : {}),
            },
            orderBy: { createdAt: "desc" },
            ...(opts?.limit ? { take: opts.limit } : {}),
            include: {
                sentiment: {
                    select: {
                        confusion: true,
                        frustration: true,
                        urgency: true,
                        sentiment: true,
                    },
                },
            },
        });
        return messages.reverse().map((m) => ({
            ...toMessage(m),
            sentiment: m.sentiment ?? undefined,
        }));
    },

    async initProgress(socioId) {
        const progress = await ensureSocioProgressRow(socioId);
        return toSocioProgress(progress);
    },

    async getSocioProgress(socioId) {
        const progress = await ensureSocioProgressRow(socioId);
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

    async resetMessageIndex(socioId) {
        const progress = await prisma.socioProgress.update({
            where: { socioId },
            data: {
                currentMessageIndex: 0,
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
                socio: { archivedAt: null }, // A.3: never remind an archived socio
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
        // Upsert, not update. A learner who signed up and joined a player
        // course has no SocioProgress row yet — that row is created lazily by
        // `getSocioProgress`, and this call runs before anything reaches it. A
        // bare `update` threw P2025 and turned every first tutor turn into a
        // 500, which is exactly what a fresh focus-group account looks like.
        const progress = await prisma.socioProgress.upsert({
            where: { socioId },
            create: { socioId, lastInteractionAt: new Date() },
            update: { lastInteractionAt: new Date() },
        });
        return toSocioProgress(progress);
    },

    /** Cross-tenant by design — platform admin only. See RepoInterface docs. */
    async getSociosAcrossAllOrganizations() {
        const socios = await prisma.socio.findMany({
            where: { status: 'ACTIVE', archivedAt: null }, // A.3: archived socios (status stays ACTIVE) excluded
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
                reasonCode: data.reasonCode ?? null,
                reasonParams: (data.reasonParams as object) ?? undefined,
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
            where: { socioId, ...activeFlagWhere() },
            orderBy: { createdAt: 'desc' },
        });
        return flags.map(toSocioFlag);
    },

    async recordFlagOccurrence(flagId, at = new Date()) {
        const flag = await prisma.socioFlag.update({
            where: { id: flagId },
            data: {
                occurrenceCount: { increment: 1 },
                lastOccurredAt: at,
            },
        });
        return toSocioFlag(flag);
    },

    async getAllUnresolvedFlags() {
        const flags = await prisma.socioFlag.findMany({
            where: activeFlagWhere(),
            include: { socio: true },
            orderBy: [{ level: 'asc' }, { createdAt: 'desc' }],
        });
        return flags.map((f) => ({
            ...toSocioFlag(f),
            socio: toSocio(f.socio),
        }));
    },

    async getUnresolvedFlagsByMentor(mentorId: string) {
        const flags = await prisma.socioFlag.findMany({
            where: {
                ...activeFlagWhere(),
                socio: { mentorId },
            },
            include: { socio: true },
            orderBy: [{ level: 'asc' }, { createdAt: 'desc' }],
        });
        return flags.map((f) => ({
            ...toSocioFlag(f),
            socio: toSocio(f.socio),
        }));
    },

    async resolveFlag(flagId, mentorId, outcome) {
        const flag = await prisma.socioFlag.update({
            where: { id: flagId },
            data: {
                resolved: true,
                resolvedBy: mentorId,
                resolvedAt: new Date(),
                ...(outcome ? { status: 'RESOLVED', disposition: outcome.disposition } : {}),
            },
        });
        if (outcome) {
            await prisma.flagEvent.create({
                data: {
                    flagId,
                    actorId: mentorId,
                    actorType: 'mentor',
                    eventType: 'resolved',
                    disposition: outcome.disposition,
                    note: outcome.note ?? null,
                    linkedMessageId: outcome.linkedMessageId ?? null,
                },
            });
        }
        return toSocioFlag(flag);
    },

    async acknowledgeFlag(flagId, mentorId, note) {
        const flag = await prisma.socioFlag.update({
            where: { id: flagId },
            data: { status: 'ACKNOWLEDGED' },
        });
        await prisma.flagEvent.create({
            data: {
                flagId,
                actorId: mentorId,
                actorType: 'mentor',
                eventType: 'acknowledged',
                note: note ?? null,
            },
        });
        return toSocioFlag(flag);
    },

    async snoozeFlag(flagId, mentorId, days, note) {
        const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        const flag = await prisma.socioFlag.update({
            where: { id: flagId },
            data: { status: 'SNOOZED', snoozedUntil },
        });
        await prisma.flagEvent.create({
            data: {
                flagId,
                actorId: mentorId,
                actorType: 'mentor',
                eventType: 'snoozed',
                note: note ?? null,
            },
        });
        return toSocioFlag(flag);
    },

    async appendFlagEvent(data) {
        const event = await prisma.flagEvent.create({
            data: {
                flagId: data.flagId,
                actorId: data.actorId ?? null,
                actorType: data.actorType,
                eventType: data.eventType,
                disposition: data.disposition ?? null,
                note: data.note ?? null,
                linkedMessageId: data.linkedMessageId ?? null,
            },
        });
        return toFlagEvent(event);
    },

    async getFlagEvents(flagId) {
        const events = await prisma.flagEvent.findMany({
            where: { flagId },
            orderBy: { createdAt: 'asc' },
        });
        return events.map(toFlagEvent);
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

    async getMentorPreferredLanguage(mentorId) {
        const mentor = await prisma.mentor.findUnique({
            where: { id: mentorId },
            select: { preferredLanguage: true },
        });
        if (!mentor) return null;
        return isSupportedLanguage(mentor.preferredLanguage)
            ? mentor.preferredLanguage
            : null;
    },

    async getMentorNames(mentorIds) {
        if (mentorIds.length === 0) return {};
        const mentors = await prisma.mentor.findMany({
            where: { id: { in: mentorIds } },
            select: { id: true, name: true },
        });
        return Object.fromEntries(mentors.map((m) => [m.id, m.name]));
    },

    async setMentorPreferredLanguage(mentorId, language) {
        // updateMany so a missing mentor reports false instead of throwing.
        const result = await prisma.mentor.updateMany({
            where: { id: mentorId },
            data: { preferredLanguage: language },
        });
        return result.count > 0;
    },

    async getSocioContext(socioId) {
        const ctx = await prisma.socioContext.findUnique({
            where: { socioId },
        });
        return ctx ? toSocioContext(ctx) : null;
    },

    async upsertSocioContext(socioId, data) {
        const ctx = await prisma.socioContext.upsert({
            where: { socioId },
            create: {
                socioId,
                businessType: data.businessType ?? null,
                products: data.products ?? null,
                monthlyRevenue: data.monthlyRevenue ?? null,
                monthlyExpenses: data.monthlyExpenses ?? null,
                numEmployees: data.numEmployees ?? null,
                location: data.location ?? null,
                challenges: data.challenges ?? null,
                goals: data.goals ?? null,
                familyContext: data.familyContext ?? null,
                customFacts: data.customFacts ?? null,
            },
            update: {
                ...(data.businessType !== undefined && { businessType: data.businessType }),
                ...(data.products !== undefined && { products: data.products }),
                ...(data.monthlyRevenue !== undefined && { monthlyRevenue: data.monthlyRevenue }),
                ...(data.monthlyExpenses !== undefined && { monthlyExpenses: data.monthlyExpenses }),
                ...(data.numEmployees !== undefined && { numEmployees: data.numEmployees }),
                ...(data.location !== undefined && { location: data.location }),
                ...(data.challenges !== undefined && { challenges: data.challenges }),
                ...(data.goals !== undefined && { goals: data.goals }),
                ...(data.familyContext !== undefined && { familyContext: data.familyContext }),
                ...(data.customFacts !== undefined && { customFacts: data.customFacts }),
            },
        });
        return toSocioContext(ctx);
    },

    // ─── Dimension State Methods ─────────────────────────────────────────────────

    async getDimensionState(socioId, dimensionKey) {
        const state = await prisma.socioDimensionState.findUnique({
            where: { socioId_dimensionKey: { socioId, dimensionKey } },
        });
        return state ? toDimensionState(state) : null;
    },

    async getDimensionStateMap(socioId) {
        const states = await prisma.socioDimensionState.findMany({
            where: { socioId },
        });
        return states.map(toDimensionState);
    },

    async upsertDimensionState(socioId, state) {
        const row = await prisma.socioDimensionState.upsert({
            where: { socioId_dimensionKey: { socioId, dimensionKey: state.dimensionKey } },
            create: {
                socioId,
                dimensionKey: state.dimensionKey,
                level: state.level,
                trend: state.trend,
                confidence: state.confidence,
                evidence: state.evidence,
            },
            update: {
                level: state.level,
                trend: state.trend,
                confidence: state.confidence,
                evidence: state.evidence,
            },
        });
        return toDimensionState(row);
    },

    async clearDimensionState(socioId) {
        await prisma.socioDimensionState.deleteMany({
            where: { socioId },
        });
    },

    // ─── System Prompt Methods ───────────────────────────────────────────────────

    async getActivePrompt(category, scope) {
        // One query per tier, most specific first, stopping at the first hit.
        // Fetching all candidates and sorting in memory would be one round trip
        // instead of up to three, but it would also silently return a row from
        // another organization if the tier logic ever drifted. Losing the wrong
        // tenant's prompt into a learner's chat is not a trade worth one query.
        for (const tier of scopeTiers(scope)) {
            const prompt = await prisma.systemPrompt.findFirst({
                where: {
                    category,
                    active: true,
                    organizationId: tier.organizationId,
                    collectionKey: tier.collectionKey,
                },
                orderBy: { createdAt: 'desc' },
            });
            if (prompt) return toSystemPrompt(prompt);
        }
        return null;
    },

    // ─── Summary Methods ─────────────────────────────────────────────────────────

    async createSummary(data) {
        const summary = await prisma.summary.create({
            data: {
                socioId: data.socioId,
                weekStartDate: data.weekStartDate,
                content: data.content,
                flags: data.flags as object ?? undefined,
                metrics: data.metrics as object ?? undefined,
            },
        });
        return toSummary(summary);
    },

    async getSummaries(socioId, limit) {
        const summaries = await prisma.summary.findMany({
            where: { socioId },
            orderBy: { weekStartDate: 'desc' },
            ...(limit ? { take: limit } : {}),
        });
        return summaries.map(toSummary);
    },

    // ─── Financial Snapshot Methods ──────────────────────────────────────────────

    async upsertFinancialSnapshot(socioId, weekStartDate, data) {
        const snapshot = await prisma.financialSnapshot.upsert({
            where: { socioId_weekStartDate: { socioId, weekStartDate } },
            create: {
                socioId,
                weekStartDate,
                revenue: data.revenue,
                netProfit: data.netProfit,
                source: data.source ?? 'ai_marker',
            },
            update: {
                revenue: data.revenue,
                netProfit: data.netProfit,
                source: data.source ?? 'ai_marker',
            },
        });
        return toFinancialSnapshot(snapshot);
    },

    async getFinancialSnapshots(socioId, limit) {
        const snapshots = await prisma.financialSnapshot.findMany({
            where: { socioId },
            orderBy: { weekStartDate: 'desc' },
            ...(limit ? { take: limit } : {}),
        });
        return snapshots.map(toFinancialSnapshot);
    },

    // ─── Feedback Methods ────────────────────────────────────────────────────────

    async createFeedback(data) {
        const feedback = await prisma.socioFeedback.create({
            data: {
                socioId: data.socioId,
                lessonNum: data.lessonNum,
                rating: data.rating,
                comment: data.comment,
            },
        });
        return toFeedback(feedback);
    },

    async getFeedback(socioId) {
        const feedback = await prisma.socioFeedback.findMany({
            where: { socioId },
            orderBy: { createdAt: 'desc' },
        });
        return feedback.map(toFeedback);
    },

    // ─── Flag by ID ──────────────────────────────────────────────────────────────

    async getFlagById(flagId) {
        const flag = await prisma.socioFlag.findUnique({
            where: { id: flagId },
        });
        return flag ? toSocioFlag(flag) : null;
    },

    async getFlagWithSocio(flagId) {
        const flag = await prisma.socioFlag.findUnique({
            where: { id: flagId },
            include: { socio: true },
        });
        return flag ? { ...toSocioFlag(flag), socio: toSocio(flag.socio) } : null;
    },

    async setSocioCurriculum(socioId, collectionKey) {
        const socio = await prisma.socio.update({
            where: { id: socioId },
            data: { curriculumCollectionKey: collectionKey },
        });
        return toSocio(socio);
    },

    async archiveSocio(socioId) {
        const existing = await prisma.socio.findUnique({ where: { id: socioId } });
        if (!existing) throw new Error('Socio not found');
        if (existing.archivedAt) return toSocio(existing);
        const socio = await prisma.socio.update({
            where: { id: socioId },
            data: { archivedAt: new Date() },
        });
        return toSocio(socio);
    },

    // ─── Assessment Session Methods ─────────────────────────────────────────────

    async recordMilestoneReached(data) {
        // A.4: prefer the caller's enrollmentId (the player surface always
        // has one, via ValidatedPlayerContext). Chat-surface markers have no
        // PlayerAccess/context to carry one, so resolve it here — same
        // participant+collectionKey lookup the A.4 backfill used, preferring
        // an ACTIVE enrollment. Best-effort: null is a valid outcome (e.g. an
        // unanchored socio), matching the nullable column.
        // Defense in depth: a caller-supplied enrollmentId is verified
        // against data.organizationId rather than trusted — see the matching
        // note in tenantPrismaRepo.createAssessmentSession. Cross-org IDs are
        // dropped, not thrown, and fall through to internal resolution.
        let enrollmentId = data.enrollmentId ?? null;
        if (enrollmentId) {
            const owner = await prisma.enrollment.findUnique({
                where: { id: enrollmentId },
                select: { cohort: { select: { program: { select: { organizationId: true } } } } },
            });
            if (!owner || owner.cohort.program.organizationId !== data.organizationId) {
                enrollmentId = null;
            }
        }
        if (!enrollmentId) {
            const socio = await prisma.socio.findUnique({ where: { id: data.socioId }, select: { participantProfile: { select: { id: true } } } });
            if (socio?.participantProfile) {
                const candidates = await prisma.enrollment.findMany({
                    where: { participantId: socio.participantProfile.id, collectionKey: data.collectionKey },
                    orderBy: { enrolledAt: 'desc' },
                });
                enrollmentId = (candidates.find((c) => c.status === 'active') ?? candidates[0])?.id ?? null;
            }
        }

        // upsert with an empty update: a second marker for the same milestone
        // must not move `reachedAt`. The first time they reported doing it is
        // the fact worth keeping. enrollmentId is likewise create-only — see
        // the MilestoneProgress.enrollmentId doc comment (A.4).
        //
        // A.6.1 widened the identity constraint to (enrollmentId,
        // milestoneKey) so a second enrollment reaching the same milestone
        // creates a fresh row instead of no-op'ing on the first enrollment's.
        // That constraint can't back a `upsert.where` when enrollmentId is
        // null (Postgres does not treat two NULLs as colliding, so a
        // null-keyed upsert can't find "the" existing row) — the best-effort
        // unresolved case above falls back to the pre-A.6.1 dedupe shape
        // instead, via an explicit findFirst + create.
        const row = enrollmentId
            ? await prisma.milestoneProgress.upsert({
                where: {
                    enrollmentId_milestoneKey: {
                        enrollmentId,
                        milestoneKey: data.milestoneKey,
                    },
                },
                update: {},
                create: {
                    socioId: data.socioId,
                    organizationId: data.organizationId,
                    collectionKey: data.collectionKey,
                    milestoneKey: data.milestoneKey,
                    source: data.source ?? 'ai_marker',
                    evidence: data.evidence ?? null,
                    enrollmentId,
                },
            })
            : (await prisma.milestoneProgress.findFirst({
                where: { socioId: data.socioId, collectionKey: data.collectionKey, milestoneKey: data.milestoneKey, enrollmentId: null },
            })) ?? (await prisma.milestoneProgress.create({
                data: {
                    socioId: data.socioId,
                    organizationId: data.organizationId,
                    collectionKey: data.collectionKey,
                    milestoneKey: data.milestoneKey,
                    source: data.source ?? 'ai_marker',
                    evidence: data.evidence ?? null,
                    enrollmentId: null,
                },
            }));
        return {
            id: row.id,
            socioId: row.socioId,
            organizationId: row.organizationId,
            collectionKey: row.collectionKey,
            milestoneKey: row.milestoneKey,
            reachedAt: row.reachedAt,
            source: row.source,
            evidence: row.evidence,
            enrollmentId: row.enrollmentId,
        };
    },

    async getMilestoneProgress(socioId, collectionKey) {
        const rows = await prisma.milestoneProgress.findMany({
            where: { socioId, collectionKey },
            orderBy: { reachedAt: 'asc' },
        });
        return rows.map((r) => ({
            id: r.id,
            socioId: r.socioId,
            organizationId: r.organizationId,
            collectionKey: r.collectionKey,
            milestoneKey: r.milestoneKey,
            reachedAt: r.reachedAt,
            source: r.source,
            evidence: r.evidence,
            enrollmentId: r.enrollmentId,
        }));
    },

    async getAssessmentSessionsForSocioLesson(socioId, lessonKey, blockId) {
        const sessions = await prisma.assessmentSession.findMany({
            where: {
                socioId,
                lessonKey,
                blockId,
            },
            orderBy: { createdAt: 'desc' },
        });

        return sessions.map((s) => ({
            id: s.id,
            organizationId: s.organizationId,
            socioId: s.socioId,
            lessonKey: s.lessonKey,
            blockId: s.blockId ?? null,
            kind: s.kind as 'gated_session' | 'inline_formative',
            channel: s.channel,
            status: s.status as 'pending' | 'in_progress' | 'completed',
            attemptNumber: s.attemptNumber,
            turnCount: s.turnCount,
            liveState: s.liveState as Record<string, unknown> | null,
            scores: s.scores as Record<string, number> | null,
            passedAt: s.passedAt,
            completedAt: s.completedAt,
            configSnapshot: s.configSnapshot as Record<string, unknown>,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            enrollmentId: s.enrollmentId,
        }));
    },
};
