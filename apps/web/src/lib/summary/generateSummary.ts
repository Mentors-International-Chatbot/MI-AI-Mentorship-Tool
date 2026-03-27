import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { prisma } from '@/lib/db';

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

export async function generateSummary(socioId: string): Promise<GeneratedSummary | null> {
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

  const prompt = `Genera un resumen semanal para el mentor humano sobre este socio.

SOCIO: ${socio.name ?? 'Sin nombre'} (${socio.businessName ?? 'negocio no especificado'})
LECCIÓN ACTUAL: ${progress?.currentLessonNumber ?? 1}
MENSAJES ESTA SEMANA: ${messages.length}
LECCIONES COMPLETADAS ESTA SEMANA: ${lessonsThisWeek.length}
BANDERAS ACTIVAS: ${activeFlags.length} (${activeFlags.map((f) => `${f.level}: ${f.reason}`).join('; ') || 'ninguna'})
CONFUSIÓN PROMEDIO: ${avgConfusion}/10
FRUSTRACIÓN PROMEDIO: ${avgFrustration}/10

CONVERSACIÓN RECIENTE:
${recentConvo}

Responde ÚNICAMENTE con JSON válido, sin backticks:
{
  "summary": "2-3 oraciones resumen en español",
  "risks": ["riesgo1", "riesgo2"],
  "achievements": ["logro1", "logro2"],
  "recommendedAction": "qué debería hacer el mentor",
  "overallHealth": "green|yellow|red"
}`;

  const chat = new ChatAnthropic({
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.3,
    maxTokens: 500,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  const response = await chat.invoke([
    new SystemMessage('Eres un asistente que genera resúmenes semanales en JSON. Responde SOLO con JSON válido.'),
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
