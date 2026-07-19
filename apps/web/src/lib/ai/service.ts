import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { repo } from '@/lib/repo';
import { Socio, Message } from '@/lib/repo/types';
import {
    buildSystemPrompt,
    determineMode,
    parseMarkers,
    InteractionMode,
    type ParsedMarkers,
    type DetermineModeResult,
} from './prompts';
import { sanitizeForDelivery } from '@/lib/ai/sanitizer';
import { AI_ERROR_FALLBACK, type SupportedLanguage } from '@/lib/i18n/languages';
import { logEvent } from '@/lib/logging/logger';
import {
    senseDimensions,
    updateDimensionState,
    getDimensionStateMap,
    type DimensionStateMap,
} from './sensing';
import { getLessonData, hasLessonData } from '@/lib/lessons/db-lesson-service';

const AI_TIMEOUT_MS = 30000; // 30 seconds max per request

async function invokeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        ),
    ]);
}

async function invokeWithRetry(
    chat: ChatAnthropic,
    messages: (SystemMessage | HumanMessage | AIMessage)[],
    maxRetries: number = 2,
): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await invokeWithTimeout(
                chat.invoke(messages),
                AI_TIMEOUT_MS,
                `AI request timeout after ${AI_TIMEOUT_MS}ms`
            );
            return typeof response.content === 'string'
                ? response.content
                : JSON.stringify(response.content);
        } catch (error) {
            lastError = error as Error;
            console.error(`[AI] Attempt ${attempt + 1}/${maxRetries + 1} failed:`, error);

            // Don't retry on timeout errors - fail fast
            if (error instanceof Error && error.message.includes('timeout')) {
                throw error;
            }

            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError ?? new Error('AI invoke failed');
}

export interface AIResponse {
    text: string;
    markers: ParsedMarkers;
    mode: InteractionMode;
    determineModeResult: DetermineModeResult;
    dimensionState?: DimensionStateMap;
    isError?: boolean;
}

export async function generateAIResponse(
    socio: Socio,
    incomingText: string,
    /** Optional pre-computed dimension state for testing */
    overrideDimensionState?: DimensionStateMap,
): Promise<AIResponse> {
    const startTime = performance.now();
    const timings: Record<string, number> = {};

    const chat = new ChatAnthropic({
        model: "claude-haiku-4-5-20251001",
        temperature: 0.7,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });

    // 0. Run sensing pass to assess student's current state
    const sensingStart = performance.now();
    let liveState: DimensionStateMap;

    if (overrideDimensionState) {
        // Use override state (for testing)
        liveState = overrideDimensionState;
    } else {
        // Run actual sensing pass
        const priorState = await getDimensionStateMap(socio.id);

        // Get lesson context for sensing
        const repoProgress = await repo.getSocioProgress(socio.id);
        const lessonContext = hasLessonData(repoProgress.currentLessonNumber)
            ? getLessonData(repoProgress.currentLessonNumber).titleEs
            : 'Conversación general de mentoría';

        const sensed = await senseDimensions({
            incomingText,
            priorState,
            lessonContext,
        });

        // Update state with new observations
        liveState = await updateDimensionState(socio.id, sensed.dimensions);
    }
    timings.sensing = performance.now() - sensingStart;

    // 1. Determine interaction mode from real progress data + dimension state
    const modeStart = performance.now();
    const modeResult = await determineMode(socio, incomingText, liveState);
    timings.determineMode = performance.now() - modeStart;

    // 2. Assemble 4-layer system prompt with real progress + dimension state
    const promptStart = performance.now();
    const systemPrompt = await buildSystemPrompt(
        socio,
        modeResult.routerResult,
        modeResult.progress,
        liveState,
    );
    timings.buildPrompt = performance.now() - promptStart;

    // 3. Fetch conversation history (last 10 messages for context)
    const historyStart = performance.now();
    const recentHistory = await repo.getMessages(socio.id, 10);
    timings.fetchHistory = performance.now() - historyStart;

    const previousMessages = recentHistory
        .map((msg: Message) => {
            if (msg.role === 'user') return new HumanMessage(msg.content);
            if (msg.role === 'assistant' || msg.role === 'mentor') return new AIMessage(msg.content);
            return null; // skip system messages — only allowed at position 0
        })
        .filter((m): m is HumanMessage | AIMessage => m !== null);

    const messages = [
        new SystemMessage(systemPrompt),
        ...previousMessages,
        new HumanMessage(incomingText),
    ];

    // 4. Call LLM with retry
    try {
        const invokeStart = performance.now();
        const rawContent = await invokeWithRetry(chat, messages);
        timings.llmInvoke = performance.now() - invokeStart;

        // 5. Parse markers from the response
        const parseStart = performance.now();
        const markers = parseMarkers(rawContent);
        const sanitized = sanitizeForDelivery(markers.cleanText);
        timings.parseAndSanitize = performance.now() - parseStart;

        const totalTime = performance.now() - startTime;

        void logEvent('info', 'ai', 'AI response generated', {
            socioId: socio.id,
            mode: modeResult.routerResult.mode,
            promptTokensApprox: systemPrompt.length,
            responseLength: rawContent.length,
            totalMs: Math.round(totalTime),
            timings: {
                sensing: Math.round(timings.sensing),
                determineMode: Math.round(timings.determineMode),
                buildPrompt: Math.round(timings.buildPrompt),
                fetchHistory: Math.round(timings.fetchHistory),
                llmInvoke: Math.round(timings.llmInvoke),
                parseAndSanitize: Math.round(timings.parseAndSanitize),
            },
            dimensionState: liveState,
            reteachFromDimension: modeResult.reteachFromDimension,
        });

        return {
            text: sanitized,
            markers,
            mode: modeResult.routerResult.mode,
            determineModeResult: modeResult,
            dimensionState: liveState,
        };
    } catch (error) {
        console.error('[AI] All retry attempts failed:', error);

        void logEvent('error', 'ai', 'AI generation failed after retries', {
            socioId: socio.id,
            error: error instanceof Error ? error.message : String(error),
        });

        const language = (socio.language || 'es') as SupportedLanguage;
        return {
            text: AI_ERROR_FALLBACK[language] ?? AI_ERROR_FALLBACK['es'],
            markers: { cleanText: '', flags: [], lessonsCompleted: [], escalations: [], financials: [] },
            mode: modeResult.routerResult.mode,
            determineModeResult: modeResult,
            isError: true,
        };
    }
}
