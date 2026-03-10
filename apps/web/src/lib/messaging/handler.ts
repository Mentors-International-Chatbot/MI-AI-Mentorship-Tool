import { repo } from '@/lib/repo';
import { handleOnboarding } from '@/lib/onboarding/service';
import { generateAIResponse } from '@/lib/ai/service';
import { InteractionMode, parseScore, type ParsedMarkers } from '@/lib/ai/prompts';
import type { DeliveryChannel, ChannelType } from '@/lib/delivery/types';
import type { SupportedLanguage } from '@/lib/i18n/languages';

export interface HandleMessageInput {
    externalId: string;
    channelType: ChannelType;
    message: string;
    channel: DeliveryChannel;
    language?: SupportedLanguage;
}

export interface HandleMessageResult {
    responseText: string;
    mode: InteractionMode;
    markers: ParsedMarkers;
    socioId: string;
    isNewSocio: boolean;
}

export async function handleIncomingMessage(input: HandleMessageInput): Promise<HandleMessageResult> {
    const { externalId, channelType, message, channel, language } = input;

    let socio = await repo.getSocio(channelType, externalId);
    const isNewSocio = !socio;

    if (!socio) {
        socio = await repo.createSocio(channelType, externalId);

        if (language) {
            // Web channel: language already chosen in the UI, skip AWAITING_LANGUAGE
            await repo.updateSocio(socio.id, { language, status: 'AWAITING_NAME' });
            socio = { ...socio, language, status: 'AWAITING_NAME' };
        }

        await handleOnboarding(socio, message, channel);
        return {
            responseText: '',
            mode: InteractionMode.LESSON_START,
            markers: { cleanText: '', flags: [], lessonsCompleted: [], escalations: [] },
            socioId: socio.id,
            isNewSocio: true,
        };
    }

    if (socio.status !== 'ACTIVE') {
        await handleOnboarding(socio, message, channel);
        return {
            responseText: '',
            mode: InteractionMode.LESSON_START,
            markers: { cleanText: '', flags: [], lessonsCompleted: [], escalations: [] },
            socioId: socio.id,
            isNewSocio,
        };
    }

    await repo.addMessage({
        socioId: socio.id,
        role: 'user',
        content: message,
    });

    await repo.touchInteraction(socio.id);

    const aiResponse = await generateAIResponse(socio, message);

    await repo.addMessage({
        socioId: socio.id,
        role: 'assistant',
        content: aiResponse.text,
    });

    for (const flag of aiResponse.markers.flags) {
        await repo.createFlag(socio.id, flag.level, flag.reason);
        console.log(`[Flag:${flag.level}] socio=${socio.id} reason=${flag.reason}`);
    }
    if (aiResponse.markers.escalations.length > 0) {
        console.log(`[Escalation] socio=${socio.id}`, aiResponse.markers.escalations);
    }

    for (const lessonNum of aiResponse.markers.lessonsCompleted) {
        const score = parseScore(message);
        await repo.completeLesson(socio.id, lessonNum, {
            understanding: score ?? undefined,
        });
        await repo.upsertLessonProgress(socio.id, lessonNum, score, true);
        console.log(`[LessonComplete] socio=${socio.id} lesson=${lessonNum} score=${score}`);
    }

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

    await channel.sendMessage(externalId, aiResponse.text);

    return {
        responseText: aiResponse.text,
        mode: aiResponse.mode,
        markers: aiResponse.markers,
        socioId: socio.id,
        isNewSocio,
    };
}
