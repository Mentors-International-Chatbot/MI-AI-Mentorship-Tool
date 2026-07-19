import { NextRequest, NextResponse } from 'next/server';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { repo } from '@/lib/repo';
import { WhatsAppChannel } from '@/lib/delivery';
import {
    buildSystemPrompt,
    parseMarkers,
    InteractionMode,
    FOLLOWUP_ENABLED,
    FOLLOWUP_DELAY_HOURS,
    MAX_REMINDERS,
    type RouterResult,
    type SocioProgress as PromptProgress,
    type ReminderState,
} from '@/lib/ai/prompts';
import { getLessonData, hasLessonData } from '@/lib/lessons/db-lesson-service';

export async function GET(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    if (!FOLLOWUP_ENABLED) {
        return NextResponse.json({ skipped: true, reason: 'FOLLOWUP_ENABLED is false' });
    }

    const staleSocios = await repo.getStaleLessonSocios(FOLLOWUP_DELAY_HOURS, MAX_REMINDERS);

    const whatsappChannel = new WhatsAppChannel();
    let sent = 0;
    const errors: string[] = [];

    for (const { socio, progress } of staleSocios) {
        try {
            // Only send reminders to WhatsApp socios (web socios have no push channel)
            if (socio.channelType !== 'whatsapp') continue;

            if (!hasLessonData(progress.currentLessonNumber)) continue;

            const lesson = getLessonData(progress.currentLessonNumber);

            const reminderState: ReminderState = {
                lessonNumber: progress.currentLessonNumber,
                lessonTitleEs: lesson.titleEs,
                messageIndex: progress.currentMessageIndex,
                totalMessages: lesson.messages.length,
                reminderNumber: progress.remindersSent + 1,
                maxReminders: MAX_REMINDERS,
            };

            const routerResult: RouterResult = {
                mode: InteractionMode.REMINDER,
                reminder: reminderState,
            };

            const promptProgress: PromptProgress = {
                currentLessonNumber: progress.currentLessonNumber,
                completedLessons: progress.completedLessons,
                weeklyUnderstanding: progress.weeklyUnderstanding,
                weeklyImplementation: progress.weeklyImplementation,
                daysSinceLastInteraction: Math.floor(
                    (Date.now() - (progress.lastInteractionAt?.getTime() ?? Date.now())) / (1000 * 60 * 60 * 24)
                ),
            };

            const systemPrompt = await buildSystemPrompt(socio, routerResult, promptProgress);

            const chat = new ChatAnthropic({
                model: 'claude-haiku-4-5-20251001',
                temperature: 0.7,
                anthropicApiKey: process.env.ANTHROPIC_API_KEY,
            });

            const response = await chat.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage('(El socio no ha respondido. Envía un recordatorio amigable.)'),
            ]);

            const rawContent = typeof response.content === 'string'
                ? response.content
                : JSON.stringify(response.content);

            const markers = parseMarkers(rawContent);

            await whatsappChannel.sendMessage(socio.externalId, markers.cleanText);

            await repo.addMessage({
                socioId: socio.id,
                role: 'assistant',
                content: markers.cleanText,
            });

            await repo.recordReminder(socio.id);
            sent++;

            console.log(`[CronReminder] Sent reminder #${progress.remindersSent + 1} to socio=${socio.id}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`socio=${socio.id}: ${msg}`);
            console.error(`[CronReminder] Error for socio=${socio.id}:`, err);
        }
    }

    return NextResponse.json({
        checked: staleSocios.length,
        sent,
        errors: errors.length > 0 ? errors : undefined,
    });
}
