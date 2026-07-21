import { ChatOpenAI } from "@langchain/openai";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
const DEFAULT_APP_NAME = "MI AI Mentorship Tool";

type OpenRouterChatOptions = {
  model?: string;
  temperature: number;
  maxTokens?: number;
};

export function createOpenRouterChat(options: OpenRouterChatOptions): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable");
  }

  const model = options.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  return new ChatOpenAI({
    model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    apiKey,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
        "X-Title": process.env.OPENROUTER_APP_NAME ?? DEFAULT_APP_NAME,
      },
    },
  });
}
