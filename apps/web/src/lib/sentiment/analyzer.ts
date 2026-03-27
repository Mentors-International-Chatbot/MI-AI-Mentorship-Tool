import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { loadActivePrompt } from '@/lib/ai/prompts/loadPrompt';

export interface SentimentResult {
  confusion: number;    // 0-10
  frustration: number;  // 0-10
  urgency: number;      // 0-10
  sentiment: 'positive' | 'neutral' | 'negative' | 'distressed';
  topics: string[];
}

const SENTIMENT_SYSTEM_PROMPT_DEFAULT = `Eres un analizador de sentimiento para mensajes de micro-emprendedores colombianos que participan en un programa de mentoría por WhatsApp.

Analiza el mensaje y responde ÚNICAMENTE con JSON válido, sin texto adicional, sin backticks, sin explicación:

{"confusion": 0, "frustration": 0, "urgency": 0, "sentiment": "neutral", "topics": ["business"]}

Escalas (0-10):
- confusion: 0 = entiende todo, 10 = completamente perdido
- frustration: 0 = calmado, 10 = furioso/desesperado
- urgency: 0 = sin prisa, 10 = emergencia inmediata

sentiment: "positive" | "neutral" | "negative" | "distressed"

topics: Array de 1-3 de: "finances", "business", "personal", "family", "loan", "sales", "inventory", "other"

IMPORTANTE: Considera contexto cultural colombiano. "Ay no, pena" puede ser frustración leve. "Estoy desesperado" es urgencia alta. Lenguaje informal no implica frustración.`;

const DEFAULT_RESULT: SentimentResult = {
  confusion: 0,
  frustration: 0,
  urgency: 0,
  sentiment: 'neutral',
  topics: ['other'],
};

export async function analyzeSentiment(message: string): Promise<SentimentResult> {
  try {
    const systemPromptText = await loadActivePrompt(
      'sentiment',
      SENTIMENT_SYSTEM_PROMPT_DEFAULT,
    );

    const chat = new ChatAnthropic({
      model: 'claude-haiku-4-5-20251001',
      temperature: 0,
      maxTokens: 150,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });

    const response = await chat.invoke([
      new SystemMessage(systemPromptText),
      new HumanMessage(message),
    ]);

    const raw = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    const cleaned = raw.replace(/```json\s*|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      confusion: clamp(parsed.confusion ?? 0, 0, 10),
      frustration: clamp(parsed.frustration ?? 0, 0, 10),
      urgency: clamp(parsed.urgency ?? 0, 0, 10),
      sentiment: validateSentiment(parsed.sentiment),
      topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 3) : ['other'],
    };
  } catch (error) {
    console.error('[Sentiment] Analysis failed, using defaults:', error);
    return DEFAULT_RESULT;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function validateSentiment(s: unknown): SentimentResult['sentiment'] {
  const valid = ['positive', 'neutral', 'negative', 'distressed'];
  return valid.includes(s as string) ? (s as SentimentResult['sentiment']) : 'neutral';
}
