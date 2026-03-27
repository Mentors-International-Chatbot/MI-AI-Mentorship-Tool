import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateSummary } from '@/lib/summary/generateSummary';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Get all ACTIVE socios
  const socios = await prisma.socio.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  let generated = 0;
  const errors: string[] = [];

  for (const socio of socios) {
    try {
      const generatedSummary = await generateSummary(socio.id);
      if (!generatedSummary) continue;

      await prisma.summary.create({
        data: {
          socioId: socio.id,
          weekStartDate: generatedSummary.weekStartDate,
          content: generatedSummary.content,
          flags: generatedSummary.flags,
          metrics: generatedSummary.metrics,
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
