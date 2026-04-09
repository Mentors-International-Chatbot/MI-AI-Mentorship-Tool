import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { WhatsAppChannel } from '@/lib/delivery';
import { verifyMentorOwnership } from '@/lib/auth/ownership';
import type { SupportedLanguage } from '@/lib/i18n/languages';

const MENTOR_LABEL: Record<SupportedLanguage, string> = {
  es: 'Tu Mentor',
  en: 'Your Mentor',
  pt: 'Seu Mentor',
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: socioId } = await params;

  const auth = await verifyMentorOwnership(socioId);
  if (!auth.authorized) return auth.response;

  const { content } = (await req.json()) as { content?: string };

  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const socio = await repo.getSocioById(socioId);
  if (!socio) {
    return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
  }

  const savedMessage = await repo.addMessage({
    socioId: socio.id,
    role: 'mentor',
    content: content.trim(),
    senderType: 'mentor',
  });

  // Deliver via WhatsApp if applicable
  let whatsappDelivered = false;
  let whatsappError: string | null = null;

  if (socio.channelType === 'whatsapp' && socio.whatsappPhoneNumber) {
    try {
      const lang = (socio.language ?? 'es') as SupportedLanguage;
      const label = MENTOR_LABEL[lang] ?? MENTOR_LABEL['es'];
      const whatsappText = `${content.trim()}\n\n— ${label}`;
      const channel = new WhatsAppChannel();
      await channel.sendMessage(socio.whatsappPhoneNumber, whatsappText);
      whatsappDelivered = true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[DashboardMessage] WhatsApp delivery failed:', msg);
      whatsappError = msg;
    }
  }

  return NextResponse.json({ success: true, message: savedMessage, whatsappDelivered, whatsappError });
}
