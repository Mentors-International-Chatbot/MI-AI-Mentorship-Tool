import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { prisma } from '@/lib/db';
import {
  DEFAULT_LANGUAGE,
  type SupportedLanguage,
  isSupportedLanguage,
} from '@/lib/i18n/languages';

export type SummaryFlags = {
  risks: string[];
  achievements: string[];
  recommendedAction: string;
  overallHealth: 'green' | 'yellow' | 'red';
};

export type SummaryMetrics = {
  messageCount: number;
  lessonsCompleted: number;
  avgConfusion: number;
  avgFrustration: number;
  currentLesson: number;
  activeFlagCount: number;
};

export type GeneratedSummary = {
  weekStartDate: Date;
  content: string;
  flags: SummaryFlags;
  metrics: SummaryMetrics;
};

function normalizeSummaryLanguage(raw: string | undefined): SupportedLanguage {
  const t = raw?.trim().toLowerCase() ?? '';
  if (t && isSupportedLanguage(t)) return t;
  return DEFAULT_LANGUAGE;
}

type PromptCtx = {
  name: string;
  business: string;
  currentLesson: number;
  messageCount: number;
  lessonsCompleted: number;
  activeFlagsLine: string;
  avgConfusion: number;
  avgFrustration: number;
  recentConvo: string;
};

function buildHumanPrompt(lang: SupportedLanguage, ctx: PromptCtx): string {
  if (lang === 'en') {
    return `Generate a weekly summary for the human mentor about this socio.

SOCIO: ${ctx.name} (${ctx.business})
CURRENT LESSON: ${ctx.currentLesson}
MESSAGES THIS WEEK: ${ctx.messageCount}
LESSONS COMPLETED THIS WEEK: ${ctx.lessonsCompleted}
ACTIVE FLAGS: ${ctx.activeFlagsLine}
AVERAGE CONFUSION: ${ctx.avgConfusion}/10
AVERAGE FRUSTRATION: ${ctx.avgFrustration}/10

RECENT CONVERSATION (in Spanish — the socio speaks Spanish):
${ctx.recentConvo}

Respond ONLY with valid JSON, no backticks:
{
  "summary": "2-3 sentence summary in English",
  "risks": ["risk1", "risk2"],
  "achievements": ["achievement1", "achievement2"],
  "recommendedAction": "what the mentor should do next",
  "overallHealth": "green|yellow|red"
}`;
  }

  if (lang === 'pt') {
    return `Gere um resumo semanal para o mentor humano sobre este socio.

SOCIO: ${ctx.name} (${ctx.business})
LIÇÃO ATUAL: ${ctx.currentLesson}
MENSAGENS ESTA SEMANA: ${ctx.messageCount}
LIÇÕES CONCLUÍDAS ESTA SEMANA: ${ctx.lessonsCompleted}
BANDEIRAS ATIVAS: ${ctx.activeFlagsLine}
CONFUSÃO MÉDIA: ${ctx.avgConfusion}/10
FRUSTRAÇÃO MÉDIA: ${ctx.avgFrustration}/10

CONVERSA RECENTE (em espanhol — o sócio fala espanhol):
${ctx.recentConvo}

Responda APENAS com JSON válido, sem backticks:
{
  "summary": "2-3 frases em português",
  "risks": ["risco1", "risco2"],
  "achievements": ["conquista1", "conquista2"],
  "recommendedAction": "o que o mentor deve fazer",
  "overallHealth": "green|yellow|red"
}`;
  }

  // es (default)
  return `Genera un resumen semanal para el mentor humano sobre este socio.

SOCIO: ${ctx.name} (${ctx.business})
LECCIÓN ACTUAL: ${ctx.currentLesson}
MENSAJES ESTA SEMANA: ${ctx.messageCount}
LECCIONES COMPLETADAS ESTA SEMANA: ${ctx.lessonsCompleted}
BANDERAS ACTIVAS: ${ctx.activeFlagsLine}
CONFUSIÓN PROMEDIO: ${ctx.avgConfusion}/10
FRUSTRACIÓN PROMEDIO: ${ctx.avgFrustration}/10

CONVERSACIÓN RECIENTE (el socio escribe en español):
${ctx.recentConvo}

Responde ÚNICAMENTE con JSON válido, sin backticks:
{
  "summary": "2-3 oraciones resumen en español",
  "risks": ["riesgo1", "riesgo2"],
  "achievements": ["logro1", "logro2"],
  "recommendedAction": "qué debería hacer el mentor",
  "overallHealth": "green|yellow|red"
}`;
}

function systemMessageForLang(lang: SupportedLanguage): string {
  if (lang === 'en') {
    return 'You are an assistant that generates weekly mentor summaries as JSON. Respond with ONLY valid JSON.';
  }
  if (lang === 'pt') {
    return 'Você é um assistente que gera resumos semanais em JSON. Responda APENAS com JSON válido.';
  }
  return 'Eres un asistente que genera resúmenes semanales en JSON. Responde SOLO con JSON válido.';
}

/**
 * @param language Output language for the mentor-facing summary (es | en | pt).
 *        Default `es`. Cron/dashboard pass the mentor’s preference explicitly.
 */
export async function generateSummary(
  socioId: string,
  language: string = 'es',
): Promise<GeneratedSummary | null> {
  const lang = normalizeSummaryLanguage(language);

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const socio = await prisma.socio.findUnique({
    where: { id: socioId },
    select: { id: true, name: true, businessName: true },
  });
  if (!socio) {
    throw new Error(`Socio not found: ${socioId}`);
  }

  const [messages, sentiments, progress, activeFlags, lessonsThisWeek] = await Promise.all([
    prisma.message.findMany({
      where: { socioId, createdAt: { gte: weekAgo } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.messageSentiment.findMany({
      where: { socioId, createdAt: { gte: weekAgo } },
    }),
    prisma.socioProgress.findUnique({ where: { socioId } }),
    prisma.socioFlag.findMany({
      where: { socioId, resolved: false },
    }),
    prisma.lessonProgress.findMany({
      where: { socioId, completedAt: { gte: weekAgo } },
    }),
  ]);

  // Keep behavior aligned with cron: no weekly messages means no summary.
  if (messages.length === 0) {
    return null;
  }

  const avgConfusion = sentiments.length > 0
    ? Math.round((sentiments.reduce((s, r) => s + r.confusion, 0) / sentiments.length) * 10) / 10
    : 0;
  const avgFrustration = sentiments.length > 0
    ? Math.round((sentiments.reduce((s, r) => s + r.frustration, 0) / sentiments.length) * 10) / 10
    : 0;

  const recentConvo = messages
    .slice(-20)
    .map((m) => `${m.role === 'user' ? 'SOCIO' : m.role === 'mentor' ? 'MENTOR' : 'IA'}: ${m.content}`)
    .join('\n');

  const noneLabel =
    lang === 'en' ? 'none' : lang === 'pt' ? 'nenhuma' : 'ninguna';

  const ctx: PromptCtx = {
    name: socio.name ?? (lang === 'en' ? 'No name' : lang === 'pt' ? 'Sem nome' : 'Sin nombre'),
    business:
      socio.businessName ??
      (lang === 'en'
        ? 'business not specified'
        : lang === 'pt'
          ? 'negócio não especificado'
          : 'negocio no especificado'),
    currentLesson: progress?.currentLessonNumber ?? 1,
    messageCount: messages.length,
    lessonsCompleted: lessonsThisWeek.length,
    activeFlagsLine:
      activeFlags.length > 0
        ? `${activeFlags.length} (${activeFlags.map((f) => `${f.level}: ${f.reason}`).join('; ')})`
        : noneLabel,
    avgConfusion,
    avgFrustration,
    recentConvo,
  };

  const prompt = buildHumanPrompt(lang, ctx);

  const chat = new ChatAnthropic({
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.3,
    maxTokens: 500,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  const response = await chat.invoke([
    new SystemMessage(systemMessageForLang(lang)),
    new HumanMessage(prompt),
  ]);

  const raw = typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content);

  let parsed: {
    summary?: unknown;
    risks?: unknown;
    achievements?: unknown;
    recommendedAction?: unknown;
    overallHealth?: unknown;
  };

  try {
    parsed = JSON.parse(raw.replace(/```json\s*|```/g, '').trim()) as typeof parsed;
  } catch {
    parsed = {
      summary: raw,
      risks: [],
      achievements: [],
      recommendedAction: '',
      overallHealth: 'yellow',
    };
  }

  const health = String(parsed.overallHealth ?? 'yellow').toLowerCase();
  const overallHealth: SummaryFlags['overallHealth'] =
    health === 'green' || health === 'red' ? health : 'yellow';

  return {
    weekStartDate: weekAgo,
    content: String(parsed.summary ?? ''),
    flags: {
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements.map(String) : [],
      recommendedAction: String(parsed.recommendedAction ?? ''),
      overallHealth,
    },
    metrics: {
      messageCount: messages.length,
      lessonsCompleted: lessonsThisWeek.length,
      avgConfusion,
      avgFrustration,
      currentLesson: progress?.currentLessonNumber ?? 1,
      activeFlagCount: activeFlags.length,
    },
  };
}
