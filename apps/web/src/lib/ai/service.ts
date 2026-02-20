import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { repo } from '@/lib/repo';
import { Socio, Message } from '@/lib/repo/types';
import { buildSystemPrompt, determineMode, parseMarkers, type ParsedMarkers } from './prompts';

export interface AIResponse {
    text: string;
    markers: ParsedMarkers;
}

export async function generateAIResponse(socio: Socio, incomingText: string): Promise<AIResponse> {
    const chat = new ChatAnthropic({
        model: "claude-haiku-4-5-20251001",
        temperature: 0.7,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });

    // 1. Determine interaction mode (future: pass progress, checkin, etc.)
    const routerResult = await determineMode(socio);

    // 2. Assemble 4-layer system prompt
    const systemPrompt = buildSystemPrompt(socio, routerResult);

    // 3. Fetch conversation history (last 10 messages for context)
    const recentHistory = await repo.getMessages(socio.id, 10);

    const previousMessages = recentHistory.map((msg: Message) => {
        if (msg.role === 'user') return new HumanMessage(msg.content);
        if (msg.role === 'assistant') return new AIMessage(msg.content);
        return new SystemMessage(msg.content);
    });

    const messages = [
        new SystemMessage(systemPrompt),
        ...previousMessages,
        new HumanMessage(incomingText),
    ];

    // 4. Call LLM
    try {
        const response = await chat.invoke(messages);

        const rawContent = typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);

        // 5. Parse markers from the response (flags, lesson completions, escalations)
        const markers = parseMarkers(rawContent);

        return { text: markers.cleanText, markers };
    } catch (error) {
        console.error("AI Generation Error:", error);
        return {
            text: "Lo siento, tuve un problema pensando mi respuesta. ¿Me puedes repetir eso? 🤖",
            markers: { cleanText: '', flags: [], lessonsCompleted: [], escalations: [] },
        };
    }
}
