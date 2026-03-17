import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { WhatsAppChannel } from '@/lib/delivery';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: socioId } = await params;
  const { text, mentorId } = await req.json();

  if (!text || !mentorId) {
    return NextResponse.json({ error: 'Missing text or mentorId' }, { status: 400 });
  }

  const socio = await repo.getSocioById(socioId);
  if (!socio) {
    return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
  }

  // Save message with senderType: "mentor"
  await repo.addMessage({
    socioId: socio.id,
    role: 'assistant',
    content: text,
    senderType: 'mentor',
  } as Parameters<typeof repo.addMessage>[0]);

  // Deliver via WhatsApp if applicable
  if (socio.channelType === 'whatsapp') {
    const channel = new WhatsAppChannel();
    await channel.sendMessage(socio.externalId, text);
  }

  return NextResponse.json({ success: true });
}
