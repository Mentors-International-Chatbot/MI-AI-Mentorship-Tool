import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendWhatsAppMessage } from '@/lib/whatsapp/client';

const CHECKIN_MESSAGE =
  'Hola! Es momento de tu reporte semanal de negocio. ' +
  'Por favor cuéntame: esta semana, cuánto fue tu ingreso total (todo lo que entró) ' +
  'y cuánto fue tu ganancia neta (lo que te quedó después de pagar gastos)? ' +
  'Puedes decirme algo como "vendí 500000 y me quedaron 200000".';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const socios = await prisma.socio.findMany({
    where: { status: 'ACTIVE', channelType: 'whatsapp' },
    select: { id: true, whatsappPhoneNumber: true, externalId: true },
  });

  let sent = 0;
  const errors: string[] = [];

  for (const socio of socios) {
    const phone = socio.whatsappPhoneNumber ?? socio.externalId;
    if (!phone) continue;

    try {
      await sendWhatsAppMessage(phone, CHECKIN_MESSAGE);

      await prisma.message.create({
        data: {
          socioId: socio.id,
          role: 'assistant',
          content: CHECKIN_MESSAGE,
          senderType: 'ai',
        },
      });

      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`socio=${socio.id}: ${msg}`);
      console.error(`[CronFinancial] Error for socio=${socio.id}:`, err);
    }
  }

  return NextResponse.json({
    totalSocios: socios.length,
    sent,
    errors: errors.length > 0 ? errors : undefined,
  });
}
