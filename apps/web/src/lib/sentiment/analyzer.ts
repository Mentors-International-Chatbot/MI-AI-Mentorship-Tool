import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { loadActivePrompt } from '@/lib/ai/prompts/loadPrompt';
import { createOpenRouterChat } from '@/lib/ai/openrouter';

export interface SentimentResult {
  confusion: number;    // 0-10
  frustration: number;  // 0-10
  urgency: number;      // 0-10
  sentiment: 'positive' | 'neutral' | 'negative' | 'distressed';
  topics: string[];
}

const SENTIMENT_SYSTEM_PROMPT_DEFAULT = `You are a sentiment analyzer for messages in an educational mentorship program.

Analyze the message and respond ONLY with valid JSON, no additional text, no backticks, no explanation:

{"confusion": 0, "frustration": 0, "urgency": 0, "sentiment": "neutral", "topics": ["learning"]}

Scales (0-10):
- confusion: 0 = understands everything, 10 = completely lost
- frustration: 0 = calm, 10 = furious/desperate
- urgency: 0 = no rush, 10 = immediate emergency

sentiment: "positive" | "neutral" | "negative" | "distressed"

topics: Array of 1-3 from: "learning", "progress", "personal", "family", "finances", "application", "other"

IMPORTANT: Focus on emotional signals regardless of language or cultural context. Look for:
- Confusion: questions about concepts, "I don't understand", repeated requests for clarification
- Frustration: complaints, expressions of difficulty, giving up language
- Urgency: time pressure, crisis language, desperate tone
- Distress: emotional overwhelm, crisis indicators

Informal language does not imply frustration. Evaluate the underlying emotional state.`;

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

    const chat = createOpenRouterChat({
      temperature: 0,
      maxTokens: 150,
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

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function validateSentiment(s: unknown): SentimentResult['sentiment'] {
  const valid = ['positive', 'neutral', 'negative', 'distressed'];
  return valid.includes(s as string) ? (s as SentimentResult['sentiment']) : 'neutral';
}
