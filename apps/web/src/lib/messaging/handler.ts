import { repo } from '@/lib/repo';
import { handleOnboarding } from '@/lib/onboarding/service';
import { generateAIResponse } from '@/lib/ai/service';
import { InteractionMode, parseScore, type ParsedMarkers } from '@/lib/ai/prompts';
import { hasLessonData } from '@/lib/lessons/data';
import { analyzeSentimentAndFlag } from '@/lib/sentiment/pipeline';
import { extractAndStoreContext } from '@/lib/ai/contextExtractor';
import { prisma } from '@/lib/db';
import type { DeliveryChannel, ChannelType } from '@/lib/delivery/types';
import { LESSON_MESSAGES, type SupportedLanguage } from '@/lib/i18n/languages';
import { MAX_LESSON_NUMBER } from '@/lib/ai/prompts/constants';
import { getConfigNumber } from '@/lib/config/service';

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
    const startTime = performance.now();
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

            const langStrings = LESSON_MESSAGES[(lang as SupportedLanguage) ?? 'es'] ?? LESSON_MESSAGES['es'];
            const welcomeMsg = displayName
                ? langStrings.welcomeWithName(displayName)
                : langStrings.welcomeAnonymous;

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

    // Update language if the client sends a different one (e.g. language switcher)
    if (language && language !== socio.language) {
        await repo.updateSocio(socio.id, { language });
        socio = { ...socio, language };
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

    if (socio.aiPaused) {
        return {
            responseText: '',
            mode: InteractionMode.LESSON_DELIVERY,
            markers: { cleanText: '', flags: [], lessonsCompleted: [], escalations: [], financials: [] },
            socioId: socio.id,
            isNewSocio,
        };
    }

    const promptOverridesRaw = socio.promptOverrides as Record<string, unknown> | null;
    if (promptOverridesRaw?.awaitingFeedback === true) {
        const scoreMatch = message.match(/\b(\d{1,2})\b/);
        const parsed = scoreMatch ? parseInt(scoreMatch[1], 10) : NaN;
        const rating = Number.isFinite(parsed) ? parsed : NaN;
        const lessonNum =
            typeof promptOverridesRaw.feedbackLessonNum === 'number'
                ? promptOverridesRaw.feedbackLessonNum
                : Number(promptOverridesRaw.feedbackLessonNum) || 0;

        if (rating >= 1 && rating <= 10) {
            await prisma.socioFeedback.create({
                data: {
                    socioId: socio.id,
                    lessonNum,
                    rating,
                    comment: message.trim() || null,
                },
            });

            const rest = { ...promptOverridesRaw };
            delete rest.awaitingFeedback;
            delete rest.feedbackLessonNum;
            await repo.updateSocio(socio.id, {
                promptOverrides:
                    Object.keys(rest).length > 0 ? (rest as Record<string, unknown>) : null,
            });

            const thankYou =
                '¡Gracias por compartir tu opinión! Lo que nos cuentas nos ayuda a mejorar. ¿En qué más te puedo ayudar hoy?';

            await repo.addMessage({
                socioId: socio.id,
                role: 'assistant',
                content: thankYou,
                senderType: 'ai',
            } as Parameters<typeof repo.addMessage>[0]);

            await channel.sendMessage(externalId, thankYou);

            return {
                responseText: thankYou,
                mode: InteractionMode.LESSON_DELIVERY,
                markers: {
                    cleanText: thankYou,
                    flags: [],
                    lessonsCompleted: [],
                    escalations: [],
                    financials: [],
                },
                socioId: socio.id,
                isNewSocio,
            };
        }

        const nudge =
            'Por favor responde con un número del 1 al 10 (qué tan útil ha sido el programa para tu negocio). Puedes añadir un comentario si quieres.';

        await repo.addMessage({
            socioId: socio.id,
            role: 'assistant',
            content: nudge,
            senderType: 'ai',
        } as Parameters<typeof repo.addMessage>[0]);

        await channel.sendMessage(externalId, nudge);

        return {
            responseText: nudge,
            mode: InteractionMode.LESSON_DELIVERY,
            markers: {
                cleanText: nudge,
                flags: [],
                lessonsCompleted: [],
                escalations: [],
                financials: [],
            },
            socioId: socio.id,
            isNewSocio,
        };
    }

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

    const socioLang = ((socio.language || 'es') as SupportedLanguage);
    const lm = LESSON_MESSAGES[socioLang] ?? LESSON_MESSAGES['es'];

    let responseText = aiResponse.text;

    // Prepend lesson number header when starting a new lesson
    if (aiResponse.mode === InteractionMode.LESSON_START) {
        const currentLesson = aiResponse.determineModeResult.progress?.currentLessonNumber ?? 1;
        responseText = `${lm.lessonHeader(currentLesson, MAX_LESSON_NUMBER)}\n\n${responseText}`;
    }

    // Append completion notification when a lesson finishes
    if (aiResponse.markers.lessonsCompleted.length > 0) {
        const completedNum =
            aiResponse.markers.lessonsCompleted[aiResponse.markers.lessonsCompleted.length - 1];
        const nextLessonNum = completedNum + 1;

        let completionSuffix = `\n\n---\n${lm.lessonComplete(completedNum)}\n\n`;
        completionSuffix += hasLessonData(nextLessonNum)
            ? lm.nextLesson(nextLessonNum)
            : lm.courseComplete;

        responseText = responseText + completionSuffix;

        let feedbackInterval = 5;
        try {
            feedbackInterval = await getConfigNumber('FEEDBACK_EVERY_N_LESSONS');
        } catch {
            feedbackInterval = 5;
        }
        if (!Number.isFinite(feedbackInterval) || feedbackInterval < 1) {
            feedbackInterval = 5;
        }

        if (completedNum > 0 && completedNum % feedbackInterval === 0) {
            const feedbackPrompt = '\n\n' + lm.feedbackPrompt(completedNum);
            responseText += feedbackPrompt;

            const existingPo = (socio.promptOverrides || {}) as Record<string, unknown>;
            await repo.updateSocio(socio.id, {
                promptOverrides: {
                    ...existingPo,
                    awaitingFeedback: true,
                    feedbackLessonNum: completedNum,
                },
            });
        }
    }

    if (aiResponse.markers.escalations.length > 0) {
        for (const reason of aiResponse.markers.escalations) {
            await repo.createFlag({
                socioId: socio.id,
                level: 'RED',
                reason: `Solicitud de escalación: ${reason}`,
                source: 'ai_marker',
            });
            console.log(`[Escalation Persisted] socio=${socio.id} reason=${reason}`);
        }

        const lang = (socio.language ?? 'es') as SupportedLanguage;
        const langStrings = LESSON_MESSAGES[lang] ?? LESSON_MESSAGES['es'];
        const escalationConfirmation = '\n\n' + langStrings.escalationConfirmation;
        responseText = responseText + escalationConfirmation;

        if (socio.mentorId) {
            console.log(
                `[ESCALATE] Socio ${socio.id} (${socio.name ?? 'unknown'}) requested mentor contact. Mentor: ${socio.mentorId}`,
            );
        }
    }

    await repo.addMessage({
        socioId: socio.id,
        role: 'assistant',
        content: responseText,
        senderType: 'ai',
    } as Parameters<typeof repo.addMessage>[0]);

    // Context extraction — fire-and-forget, don't block the response
    extractAndStoreContext(socio.id, message, responseText).catch(err =>
        console.error('[ContextExtractor] Background extraction failed:', err)
    );

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

    const totalTime = performance.now() - startTime;
    console.log(`[MessageHandler] Total processing time: ${Math.round(totalTime)}ms for socio ${socio.id}`);

    return {
        responseText,
        mode: aiResponse.mode,
        markers: aiResponse.markers,
        socioId: socio.id,
        isNewSocio,
        isError: aiResponse.isError,
    };
}
