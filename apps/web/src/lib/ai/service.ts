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

async function invokeWithRetry(
    chat: ChatAnthropic,
    messages: (SystemMessage | HumanMessage | AIMessage)[],
    maxRetries: number = 2,
): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await chat.invoke(messages);
            return typeof response.content === 'string'
                ? response.content
                : JSON.stringify(response.content);
        } catch (error) {
            lastError = error as Error;
            console.error(`[AI] Attempt ${attempt + 1}/${maxRetries + 1} failed:`, error);

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
    isError?: boolean;
}

export async function generateAIResponse(socio: Socio, incomingText: string): Promise<AIResponse> {
    const chat = new ChatAnthropic({
        model: "claude-haiku-4-5-20251001",
        temperature: 0.7,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });

    // 1. Determine interaction mode from real progress data
    const modeResult = await determineMode(socio, incomingText);

    // 2. Assemble 4-layer system prompt with real progress (DB-backed)
    const systemPrompt = await buildSystemPrompt(
        socio,
        modeResult.routerResult,
        modeResult.progress,
    );

    // 3. Fetch conversation history (last 10 messages for context)
    const recentHistory = await repo.getMessages(socio.id, 10);

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
        const rawContent = await invokeWithRetry(chat, messages);

        // 5. Parse markers from the response
        const markers = parseMarkers(rawContent);
        const sanitized = sanitizeForDelivery(markers.cleanText);

        return {
            text: sanitized,
            markers,
            mode: modeResult.routerResult.mode,
            determineModeResult: modeResult,
        };
    } catch (error) {
        console.error('[AI] All retry attempts failed:', error);

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
