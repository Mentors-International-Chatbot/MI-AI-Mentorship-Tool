import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateSummary } from '@/lib/summary/generateSummary';
import { verifyMentorOwnership } from '@/lib/auth/ownership';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: socioId } = await params;

  const auth = await verifyMentorOwnership(socioId);
  if (!auth.authorized) return auth.response;

  try {
    const generated = await generateSummary(socioId);
    if (!generated) {
      return NextResponse.json(
        { error: 'No hay suficientes mensajes esta semana para generar un resumen.' },
        { status: 400 },
      );
    }

    const summary = await prisma.summary.create({
      data: {
        socioId,
        weekStartDate: generated.weekStartDate,
        content: generated.content,
        flags: generated.flags,
        metrics: generated.metrics,
      },
    });

    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error('[SummaryGenerate] Failed:', error);
    return NextResponse.json({ error: 'Failed to generate summary' }, { status: 500 });
  }
}
