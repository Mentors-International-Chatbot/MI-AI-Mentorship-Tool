import { NextRequest, NextResponse } from 'next/server';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekStart = weekAgo;

  // Get all ACTIVE socios
  const socios = await prisma.socio.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, businessName: true },
  });

  const chat = new ChatAnthropic({
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.3,
    maxTokens: 500,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  let generated = 0;
  const errors: string[] = [];

  for (const socio of socios) {
    try {
      // Gather weekly data
      const [messages, sentiments, progress, activeFlags] = await Promise.all([
        prisma.message.findMany({
          where: { socioId: socio.id, createdAt: { gte: weekAgo } },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.messageSentiment.findMany({
          where: { socioId: socio.id, createdAt: { gte: weekAgo } },
        }),
        prisma.socioProgress.findUnique({ where: { socioId: socio.id } }),
        prisma.socioFlag.findMany({
          where: { socioId: socio.id, resolved: false },
        }),
      ]);

      // Skip socios with no messages this week
      if (messages.length === 0) continue;

      // Compute averages
      const avgConfusion = sentiments.length > 0
        ? Math.round(sentiments.reduce((s, r) => s + r.confusion, 0) / sentiments.length * 10) / 10
        : 0;
      const avgFrustration = sentiments.length > 0
        ? Math.round(sentiments.reduce((s, r) => s + r.frustration, 0) / sentiments.length * 10) / 10
        : 0;

      // Completed lessons this week
      const lessonsThisWeek = await prisma.lessonProgress.findMany({
        where: { socioId: socio.id, completedAt: { gte: weekAgo } },
      });

      // Build context for Claude
      const recentConvo = messages
        .slice(-20)
        .map((m) => `${m.role === 'user' ? 'SOCIO' : 'IA'}: ${m.content}`)
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

      const response = await chat.invoke([
        new SystemMessage('Eres un asistente que genera resúmenes semanales en JSON. Responde SOLO con JSON válido.'),
        new HumanMessage(prompt),
      ]);

      const raw = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      let parsed;
      try {
        parsed = JSON.parse(raw.replace(/```json\s*|```/g, '').trim());
      } catch {
        parsed = { summary: raw, risks: [], achievements: [], recommendedAction: '', overallHealth: 'yellow' };
      }

      await prisma.summary.create({
        data: {
          socioId: socio.id,
          weekStartDate: weekStart,
          content: parsed.summary ?? '',
          flags: {
            risks: parsed.risks ?? [],
            achievements: parsed.achievements ?? [],
            recommendedAction: parsed.recommendedAction ?? '',
            overallHealth: parsed.overallHealth ?? 'yellow',
          },
          metrics: {
            messageCount: messages.length,
            lessonsCompleted: lessonsThisWeek.length,
            avgConfusion,
            avgFrustration,
            currentLesson: progress?.currentLessonNumber ?? 1,
            activeFlagCount: activeFlags.length,
          },
        },
      });

      generated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`socio=${socio.id}: ${msg}`);
      console.error(`[CronSummary] Error for socio=${socio.id}:`, err);
    }
  }

  return NextResponse.json({
    totalSocios: socios.length,
    generated,
    errors: errors.length > 0 ? errors : undefined,
  });
}
