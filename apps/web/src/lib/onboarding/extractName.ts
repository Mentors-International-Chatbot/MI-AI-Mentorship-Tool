import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { SupportedLanguage } from "@/lib/i18n/languages";

const SYSTEM_PROMPT =
    "Extract only the person's name from this message. Return just the name, nothing else. If no name is found, return exactly NONE.";

const URL_RE = /https?:\/\/|www\./i;

function isValid(name: string): boolean {
    if (name.length < 2 || name.length > 60) return false;
    if (/^\d+$/.test(name)) return false;
    if (URL_RE.test(name)) return false;
    return true;
}

const REGEX_PATTERNS: Record<SupportedLanguage, RegExp[]> = {
    es: [
        /me llamo\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,2})/i,
        /mi nombre es\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,2})/i,
        /soy\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,2})/i,
    ],
    en: [
        /my name is\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,2})/i,
        /i'm\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,2})/i,
        /call me\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,2})/i,
    ],
    pt: [
        /meu nome é\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,2})/i,
        /me chamo\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,2})/i,
        /sou\s+(?:o|a)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,2})/i,
    ],
};

const BARE_NAME_RE = /^([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,2})$/;

function regexFallback(message: string, language: SupportedLanguage): string | null {
    for (const pattern of REGEX_PATTERNS[language]) {
        const match = message.match(pattern);
        if (match?.[1]) {
            const name = match[1].trim();
            if (isValid(name)) return name;
        }
    }

    const bareMatch = message.trim().match(BARE_NAME_RE);
    if (bareMatch?.[1]) {
        const name = bareMatch[1].trim();
        if (isValid(name)) return name;
    }

    return null;
}

export async function extractName(
    rawMessage: string,
    language: SupportedLanguage,
): Promise<string | null> {
    const message = rawMessage.trim();
    if (!message) return null;

    try {
        const chat = new ChatAnthropic({
            model: "claude-haiku-4-5-20251001",
            temperature: 0,
            maxTokens: 50,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        });

        const response = await chat.invoke([
            new SystemMessage(SYSTEM_PROMPT),
            new HumanMessage(message),
        ]);

        const extracted = (
            typeof response.content === "string"
                ? response.content
                : JSON.stringify(response.content)
        ).trim();

        if (extracted.toUpperCase() === "NONE") return null;
        if (isValid(extracted)) return extracted;
        return null;
    } catch (error) {
        console.error("Name extraction LLM error, falling back to regex:", error);
        return regexFallback(message, language);
    }
}
