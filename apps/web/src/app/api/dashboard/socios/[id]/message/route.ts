import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { WhatsAppChannel } from '@/lib/delivery';
import { prisma } from '@/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: socioId } = await params;
  const { content, mentorId } = (await req.json()) as { content?: string; mentorId?: string };

  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  if (!mentorId || !mentorId.trim()) {
    return NextResponse.json({ error: 'mentorId is required' }, { status: 400 });
  }

  const socio = await repo.getSocioById(socioId);
  if (!socio) {
    return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
  }

  // Best-effort lookup: keep delivery flow working even for test/demo mentor IDs.
  const mentorRecord = await prisma.mentor.findUnique({
    where: { id: mentorId },
    select: { id: true },
  }).catch(() => null);
  if (!mentorRecord) {
    console.warn(`[DashboardMessage] mentorId not found in DB: ${mentorId}`);
  }

  const savedMessage = await repo.addMessage({
    socioId: socio.id,
    role: 'mentor',
    content: content.trim(),
    senderType: 'mentor',
  });

  // Deliver via WhatsApp if applicable
  if (socio.channelType === 'whatsapp' && socio.whatsappPhoneNumber) {
    try {
      const channel = new WhatsAppChannel();
      await channel.sendMessage(socio.whatsappPhoneNumber, content.trim());
    } catch (error) {
      console.error('[DashboardMessage] WhatsApp delivery failed:', error);
    }
  }

  return NextResponse.json({ success: true, message: savedMessage });
}
