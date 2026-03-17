import { NextRequest, NextResponse } from 'next/server';
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
    buildSystemPrompt,
    parseMarkers,
    InteractionMode,
    type RouterResult,
    type SocioProgress,
} from '@/lib/ai/prompts';
import { getLessonData, hasLessonData } from '@/lib/lessons/data';
import { Socio } from '@/lib/repo/types';

/**
 * Test endpoint for prompt iteration.
 *
 * Basic usage (uses real router):
 *   POST { "message": "Hola" }
 *
 * Override mode and progress (skips router):
 *   POST {
 *     "message": "Hola",
 *     "mode": "LESSON_START",
 *     "lessonNumber": 3,
 *     "messageIndex": 0,
 *     "completedLessons": [1, 2],
 *     "socioName": "María",
 *     "businessDescription": "Panadería en el barrio"
 *   }
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            message,
            mode,
            lessonNumber,
            messageIndex,
            completedLessons,
            socioName,
            businessDescription,
        } = body;

        if (!message) {
            return NextResponse.json({ error: 'Missing "message" in body' }, { status: 400 });
        }

        const fakeSocio: Socio = {
            id: 'test-user',
            whatsappPhoneNumber: '0000000000',
            channelType: 'whatsapp',
            externalId: '0000000000',
            language: 'es',
            name: socioName || 'Test User',
            businessDescription: businessDescription || null,
            status: 'ACTIVE' as const,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        // If mode is specified, bypass the router and build prompt directly
        if (mode) {
            const interactionMode = mode as InteractionMode;
            const lessonNum = lessonNumber ?? 1;
            const msgIdx = messageIndex ?? 0;
            const completed: number[] = completedLessons ?? [];

            const progress: SocioProgress = {
                currentLessonNumber: lessonNum,
                completedLessons: completed,
                weeklyUnderstanding: null,
                weeklyImplementation: null,
                daysSinceLastInteraction: 0,
            };

            const routerResult: RouterResult = { mode: interactionMode };

            // Build LessonDeliveryState for lesson modes
            if (
                (interactionMode === InteractionMode.LESSON_START ||
                 interactionMode === InteractionMode.LESSON_DELIVERY) &&
                hasLessonData(lessonNum)
            ) {
                const lesson = getLessonData(lessonNum);
                const msg = lesson.messages[msgIdx];
                routerResult.lesson = {
                    lessonNumber: lessonNum,
                    lessonTitleEs: lesson.titleEs,
                    lessonCategory: lesson.category,
                    messageIndex: msgIdx + 1,
                    totalMessages: lesson.messages.length,
                    messageType: msg?.type ?? 'explicación',
                    messageContentEs: msg?.contentEs ?? '',
                    keyConcepts: lesson.keyConcepts.map(c => `- ${c}`).join('\n'),
                    exercise: lesson.exercise,
                    commitment: lesson.commitment,
                };
            }

            if (interactionMode === InteractionMode.RETEACH && hasLessonData(lessonNum)) {
                const lesson = getLessonData(lessonNum);
                routerResult.reteach = {
                    lessonNumber: lessonNum,
                    lessonTitleEs: lesson.titleEs,
                    understandingScore: 2,
                };
            }

            if (interactionMode === InteractionMode.REMINDER && hasLessonData(lessonNum)) {
                const lesson = getLessonData(lessonNum);
                routerResult.reminder = {
                    lessonNumber: lessonNum,
                    lessonTitleEs: lesson.titleEs,
                    messageIndex: msgIdx,
                    totalMessages: lesson.messages.length,
                    reminderNumber: 1,
                    maxReminders: 2,
                };
            }

            const systemPrompt = await buildSystemPrompt(fakeSocio, routerResult, progress);

            const chat = new ChatAnthropic({
                model: "claude-haiku-4-5-20251001",
                temperature: 0.7,
                anthropicApiKey: process.env.ANTHROPIC_API_KEY,
            });

            const response = await chat.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(message),
            ]);

            const rawContent = typeof response.content === 'string'
                ? response.content
                : JSON.stringify(response.content);

            const markers = parseMarkers(rawContent);

            return NextResponse.json({
                response: markers.cleanText,
                markers,
                mode: interactionMode,
                systemPrompt,
            });
        }

        // Default: FREEFORM_QUESTION with synthetic progress (no DB required)
        const defaultProgress: SocioProgress = {
            currentLessonNumber: 1,
            completedLessons: [],
            weeklyUnderstanding: null,
            weeklyImplementation: null,
            daysSinceLastInteraction: 0,
        };

        const defaultRouter: RouterResult = { mode: InteractionMode.FREEFORM_QUESTION };
        const systemPrompt = await buildSystemPrompt(fakeSocio, defaultRouter, defaultProgress);

        const chat = new ChatAnthropic({
            model: "claude-haiku-4-5-20251001",
            temperature: 0.7,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        });

        const response = await chat.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage(message),
        ]);

        const rawContent = typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);

        const markers = parseMarkers(rawContent);

        return NextResponse.json({
            response: markers.cleanText,
            markers,
            mode: InteractionMode.FREEFORM_QUESTION,
            systemPrompt,
        });
    } catch (error) {
        console.error('Test AI Error:', error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
