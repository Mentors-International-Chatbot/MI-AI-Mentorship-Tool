
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { repo } from '@/lib/repo';
import { Socio, Message } from '@/lib/repo/types';

// MVP System Prompt - In the future, this comes from the DB
const BASE_SYSTEM_PROMPT = `
Eres un mentor virtual experto de "Mentors International".
Tu objetivo es ayudar a micro-emprendedores en Colombia a crecer sus negocios.

GUIDELINES:
1. Sé alentador y empático. Usa emojis moderadamente (👋, 🚀).
2. Habla español latinoamericano claro y sencillo.
3. NO des consejos legales, financieros (inversiones) o médicos.
4. Si no sabes algo, admítelo.
5. Mantén respuestas cortas (máximo 1-2 párrafos cortos). WhatsApp es un medio rápido.

CONTEXT:
Estás hablando con un emprendedor.
`;

export async function generateAIResponse(socio: Socio, incomingText: string): Promise<string> {
    // 1. Initialize Model (requires ANTHROPIC_API_KEY env var)
    const chat = new ChatAnthropic({
        modelName: "claude-sonnet-4-20250514", // Cost effective for pilot
        temperature: 0.7,
    });

    // 2. Fetch Conversation History (Last 10 messages for context)
    const recentHistory = await repo.getMessages(socio.id, 10);

    // 3. Construct Prompt (Messages are already in chrono order from repo)
    const previousMessages = recentHistory.map((msg: Message) => {
        if (msg.role === 'user') return new HumanMessage(msg.content);
        if (msg.role === 'assistant') return new AIMessage(msg.content);
        return new SystemMessage(msg.content);
    });

    const messages = [
        new SystemMessage(BASE_SYSTEM_PROMPT),
        new SystemMessage(`Nombre del Socio: ${socio.name || "Amigo"}`),
        ...previousMessages,
        new HumanMessage(incomingText),
    ];

    // 4. Call LLM
    try {
        const response = await chat.invoke(messages);

        // LangChain returns a BaseMessage, access the content
        const content = typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content); // Fallback for complex content types

        return content;
    } catch (error) {
        console.error("AI Generation Error:", error);
        return "Lo siento, tuve un problema pensando mi respuesta. ¿Me puedes repetir eso? 🤖";
    }
}
