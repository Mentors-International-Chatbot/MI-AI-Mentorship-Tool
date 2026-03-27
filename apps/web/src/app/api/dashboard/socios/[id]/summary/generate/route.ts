import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateSummary } from '@/lib/summary/generateSummary';
import { verifySession } from '@/lib/auth/session';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'mentor' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: socioId } = await params;

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
