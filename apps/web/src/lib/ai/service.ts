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
import { createOpenRouterChat } from '@/lib/ai/openrouter';


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
    chat: { invoke: (messages: (SystemMessage | HumanMessage | AIMessage)[]) => Promise<{ content: unknown }> },
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
    /** Gated assessment info - present when mode is GATED_ASSESSMENT */
    gatedAssessment?: {
        sessionId?: string;
        blockId: string;
        lessonKey: string;
        prompt: string;
    };
}

export async function generateAIResponse(
    socio: Socio,
    incomingText: string,
    /** Curriculum collection key (required) */
    collectionKey: string,
    /** Optional pre-computed dimension state for testing */
    overrideDimensionState?: DimensionStateMap,
): Promise<AIResponse> {
    const startTime = performance.now();
    const timings: Record<string, number> = {};

    const chat = createOpenRouterChat({
        temperature: 0.7,
    });

    // 0. Kick off the sensing pass. It is NOT awaited here: dimension state is
    //    a slow-moving EMA, so this turn's reply is generated against the PRIOR
    //    state while sensing computes the new one concurrently. Turn latency
    //    drops from sensing + llm (~5s) to roughly max(sensing, llm) (~2.5s).
    const sensingStart = performance.now();
    let priorState: DimensionStateMap = {};
    let sensingPromise: Promise<DimensionStateMap>;

    if (overrideDimensionState) {
        // Use override state (for testing) - no sensing call at all
        priorState = overrideDimensionState;
        sensingPromise = Promise.resolve(overrideDimensionState);
    } else {
        priorState = await getDimensionStateMap(socio.id);

        // Get lesson context for sensing
        const repoProgress = await repo.getSocioProgress(socio.id);
        const lessonContext = hasLessonData(collectionKey, repoProgress.currentLessonNumber)
            ? getLessonData(collectionKey, repoProgress.currentLessonNumber).titleEs
            : 'Conversación general de mentoría';

        const stateAtDispatch = priorState;
        sensingPromise = senseDimensions({
            incomingText,
            priorState: stateAtDispatch,
            lessonContext,
        }).then((sensed) => {
            // Trivial message: no LLM call ran and there is nothing to fold in,
            // so the prior state carries forward untouched.
            if (sensed.skipped || sensed.dimensions.length === 0) {
                return stateAtDispatch;
            }
            return updateDimensionState(socio.id, sensed.dimensions);
        }).catch((error) => {
            console.error('[AI] Sensing pass failed, keeping prior state:', error);
            return stateAtDispatch;
        });
    }

    // 1. Determine interaction mode from real progress data + PRIOR dimension
    //    state. Gate detection does not read dimension state; only the reteach
    //    heuristic does, and a one-turn lag on an EMA signal is immaterial.
    const modeStart = performance.now();
    const modeResult = await determineMode(socio, incomingText, collectionKey, priorState);
    timings.determineMode = performance.now() - modeStart;

    // ── Handle gated assessment mode early ──────────────────────────────────
    // When student reaches a gate, we return the assessment prompt instead of
    // normal AI generation. The client should switch to assessment mode.
    if (modeResult.routerResult.mode === InteractionMode.GATED_ASSESSMENT) {
        const gateState = modeResult.routerResult.gatedAssessment!;
        const lang = (socio.language || 'es') as SupportedLanguage;

        // Build assessment intro message
        const introText = lang === 'en'
            ? `Before moving on, let's check your understanding.\n\n${gateState.prompt}`
            : lang === 'pt'
            ? `Antes de continuar, vamos verificar sua compreensão.\n\n${gateState.prompt}`
            : `Antes de continuar, verifiquemos tu comprensión.\n\n${gateState.prompt}`;

        console.log(`[GatedAssessment] Reached gate ${gateState.blockId} in lesson ${gateState.lessonKey}`);

        // Let the in-flight sensing pass finish and persist before returning.
        const gateLiveState = await sensingPromise;

        return {
            text: introText,
            markers: { cleanText: introText, flags: [], lessonsCompleted: [], escalations: [], financials: [] },
            mode: InteractionMode.GATED_ASSESSMENT,
            determineModeResult: modeResult,
            dimensionState: gateLiveState,
            gatedAssessment: {
                sessionId: gateState.sessionId,
                blockId: gateState.blockId,
                lessonKey: gateState.lessonKey,
                prompt: gateState.prompt,
            },
        };
    }

    // 2. Assemble 4-layer system prompt with real progress + dimension state
    const promptStart = performance.now();
    const systemPrompt = await buildSystemPrompt(
        socio,
        modeResult.routerResult,
        modeResult.progress,
        collectionKey,
        priorState,
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

        // 4b. Join the concurrent sensing pass. By now it has usually already
        //     settled, so sensingJoinWait should be near zero on a normal turn -
        //     that number is how much sensing still costs after parallelization.
        const joinStart = performance.now();
        const liveState = await sensingPromise;
        timings.sensingJoinWait = performance.now() - joinStart;
        timings.sensing = performance.now() - sensingStart;

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
                sensingJoinWait: Math.round(timings.sensingJoinWait),
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

        // Still join sensing so its state write lands before the request ends.
        await sensingPromise;

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
