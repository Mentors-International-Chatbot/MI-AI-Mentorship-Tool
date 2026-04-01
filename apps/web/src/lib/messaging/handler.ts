import { repo } from '@/lib/repo';
import { handleOnboarding } from '@/lib/onboarding/service';
import { generateAIResponse } from '@/lib/ai/service';
import { InteractionMode, parseScore, type ParsedMarkers } from '@/lib/ai/prompts';
import { hasLessonData } from '@/lib/lessons/data';
import { analyzeSentimentAndFlag } from '@/lib/sentiment/pipeline';
import { prisma } from '@/lib/db';
import type { DeliveryChannel, ChannelType } from '@/lib/delivery/types';
import type { SupportedLanguage } from '@/lib/i18n/languages';

export interface HandleMessageInput {
    externalId: string;
    channelType: ChannelType;
    message: string;
    channel: DeliveryChannel;
    language?: SupportedLanguage;
    /** Web socios only: JWT display name so we can skip name onboarding */
    userName?: string | null;
}

export interface HandleMessageResult {
    responseText: string;
    mode: InteractionMode;
    markers: ParsedMarkers;
    socioId: string;
    isNewSocio: boolean;
    isError?: boolean;
}

export async function handleIncomingMessage(input: HandleMessageInput): Promise<HandleMessageResult> {
    const { externalId, channelType, message, channel, language, userName } = input;

    let socio = await repo.getSocio(channelType, externalId);
    const isNewSocio = !socio;

    if (!socio) {
        socio = await repo.createSocio(channelType, externalId);

        if (channelType === 'web' && userName !== undefined) {
            const displayName = userName?.trim() ? userName.trim() : null;
            const lang = language || 'es';

            await repo.updateSocio(socio.id, {
                language: lang,
                name: displayName,
                status: 'ACTIVE',
            });
            await repo.initProgress(socio.id);
            socio = { ...socio, language: lang, name: displayName, status: 'ACTIVE' };

            const welcomeMsg = displayName
                ? `¡Hola ${displayName}! 👋 Soy tu Mentor Virtual de Mentors International.\n\nEstoy aquí para ayudarte a fortalecer tu negocio con lecciones prácticas sobre finanzas, ventas y más.\n\n📚 Cuando estés listo(a), escribe "comenzar" para iniciar tu primera lección.`
                : `¡Hola! 👋 Soy tu Mentor Virtual de Mentors International.\n\nEstoy aquí para ayudarte a fortalecer tu negocio con lecciones prácticas sobre finanzas, ventas y más.\n\n📚 Cuando estés listo(a), escribe "comenzar" para iniciar tu primera lección.`;

            await repo.addMessage({
                socioId: socio.id,
                role: 'user',
                content: message,
            });

            await repo.addMessage({
                socioId: socio.id,
                role: 'assistant',
                content: welcomeMsg,
                senderType: 'ai',
            } as Parameters<typeof repo.addMessage>[0]);

            await channel.sendMessage(externalId, welcomeMsg);

            return {
                responseText: welcomeMsg,
                mode: InteractionMode.LESSON_START,
                markers: {
                    cleanText: welcomeMsg,
                    flags: [],
                    lessonsCompleted: [],
                    escalations: [],
                    financials: [],
                },
                socioId: socio.id,
                isNewSocio: true,
            };
        }

        if (language) {
            await repo.updateSocio(socio.id, { language, status: 'AWAITING_NAME' });
            socio = { ...socio, language, status: 'AWAITING_NAME' };
        }

        await handleOnboarding(socio, message, channel);
        return {
            responseText: '',
            mode: InteractionMode.LESSON_START,
            markers: { cleanText: '', flags: [], lessonsCompleted: [], escalations: [], financials: [] },
            socioId: socio.id,
            isNewSocio: true,
        };
    }

    if (socio.status !== 'ACTIVE') {
        await handleOnboarding(socio, message, channel);
        return {
            responseText: '',
            mode: InteractionMode.LESSON_START,
            markers: { cleanText: '', flags: [], lessonsCompleted: [], escalations: [], financials: [] },
            socioId: socio.id,
            isNewSocio,
        };
    }

    const userMsg = await repo.addMessage({
        socioId: socio.id,
        role: 'user',
        content: message,
    });

    // Sentiment analysis — fire-and-forget, don't block the AI response
    analyzeSentimentAndFlag(userMsg.id, socio.id, message).catch(err =>
        console.error('[Sentiment] Background analysis failed:', err)
    );

    await repo.touchInteraction(socio.id);

    const aiResponse = await generateAIResponse(socio, message);

    for (const flag of aiResponse.markers.flags) {
        await repo.createFlag({
            socioId: socio.id,
            level: flag.level,
            reason: flag.reason,
            source: 'ai_marker',
        });
        console.log(`[Flag:${flag.level}] socio=${socio.id} reason=${flag.reason}`);
    }
    for (const escalation of aiResponse.markers.escalations) {
        await repo.createFlag({
            socioId: socio.id,
            level: 'RED',
            reason: `Escalación: ${escalation}`,
            source: 'ai_marker',
        });
        console.log(`[Escalation Persisted] socio=${socio.id} reason=${escalation}`);
    }

    for (const lessonNum of aiResponse.markers.lessonsCompleted) {
        const score = parseScore(message);
        await repo.completeLesson(socio.id, lessonNum, {
            understanding: score ?? undefined,
        });
        await repo.upsertLessonProgress(socio.id, lessonNum, score, true);
        console.log(`[LessonComplete] socio=${socio.id} lesson=${lessonNum} score=${score}`);
    }

    for (const fin of aiResponse.markers.financials) {
        const now = new Date();
        const day = now.getUTCDay();
        const mondayOffset = day === 0 ? 6 : day - 1;
        const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset));
        await prisma.financialSnapshot.upsert({
            where: {
                socioId_weekStartDate: { socioId: socio.id, weekStartDate: weekStart },
            },
            update: { revenue: fin.revenue, netProfit: fin.netProfit },
            create: {
                socioId: socio.id,
                weekStartDate: weekStart,
                revenue: fin.revenue,
                netProfit: fin.netProfit,
                source: 'ai_marker',
            },
        });
        console.log(`[Financial] socio=${socio.id} revenue=${fin.revenue} netProfit=${fin.netProfit}`);
    }

    let responseText = aiResponse.text;
    if (aiResponse.markers.lessonsCompleted.length > 0) {
        const completedNum =
            aiResponse.markers.lessonsCompleted[aiResponse.markers.lessonsCompleted.length - 1];
        const nextLessonNum = completedNum + 1;

        let completionSuffix = `\n\n---\n✅ ¡Lección ${completedNum} completada!\n\n`;
        if (hasLessonData(nextLessonNum)) {
            completionSuffix += `Cuando estés listo(a), escribe "siguiente" para comenzar la Lección ${nextLessonNum}.`;
        } else {
            completionSuffix += '¡Felicitaciones por avanzar en tu curso!';
        }

        responseText = aiResponse.text + completionSuffix;
    }

    await repo.addMessage({
        socioId: socio.id,
        role: 'assistant',
        content: responseText,
        senderType: 'ai',
    } as Parameters<typeof repo.addMessage>[0]);

    const isLessonMode =
        aiResponse.mode === InteractionMode.LESSON_DELIVERY ||
        aiResponse.mode === InteractionMode.LESSON_START;

    if (aiResponse.markers.lessonsCompleted.length === 0 && isLessonMode) {
        await repo.advanceMessage(socio.id);
        const progress = await repo.getSocioProgress(socio.id);
        await repo.upsertLessonProgress(socio.id, progress.currentLessonNumber, null, false);
    }

    if (isLessonMode || aiResponse.mode === InteractionMode.REMINDER) {
        await repo.resetReminders(socio.id);
    }

    await channel.sendMessage(externalId, responseText);

    return {
        responseText,
        mode: aiResponse.mode,
        markers: aiResponse.markers,
        socioId: socio.id,
        isNewSocio,
        isError: aiResponse.isError,
    };
}
