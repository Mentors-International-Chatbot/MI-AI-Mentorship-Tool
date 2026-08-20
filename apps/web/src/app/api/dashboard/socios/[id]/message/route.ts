import { NextRequest, NextResponse } from 'next/server';
import { repo, tenantRepo } from '@/lib/repo';
import { WhatsAppChannel } from '@/lib/delivery';
import { verifyMentorOwnership } from '@/lib/auth/ownership';
import { resolveMentorMessageMetadata } from '@/lib/player/service';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/languages';
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

  // A player-enrolled learner's thread is read back by `getLessonThread`,
  // which requires `surface`/`collectionKey`/`lessonKey` metadata on the row —
  // without it the message saves and renders nowhere. `curriculumCollectionKey`
  // alone can't tell a player learner from an MI one (both get it written by
  // `/api/auth/curriculum`), so the resolver itself checks the course's
  // delivery surface and returns undefined for anything that isn't `player` —
  // MI's chat-surface history read is metadata-blind, so this must stay a
  // no-op for it.
  let metadata: Record<string, unknown> | undefined;
  if (socio.curriculumCollectionKey) {
    try {
      const { organizationId } = await tenantRepo.resolveOrganizationForSocio(socio.id);
      metadata = await resolveMentorMessageMetadata(socio.id, socio.curriculumCollectionKey, organizationId);
    } catch (error) {
      console.warn('[DashboardMessage] could not resolve organization/lesson to attach to; sending without metadata', error);
    }
  }

  const savedMessage = await repo.addMessage({
    socioId: socio.id,
    role: 'mentor',
    content: content.trim(),
    senderType: 'mentor',
    ...(metadata ? { metadata } : {}),
  });

  // Deliver via WhatsApp if applicable
  let whatsappDelivered = false;
  let whatsappError: string | null = null;

  if (socio.channelType === 'whatsapp' && socio.whatsappPhoneNumber) {
    try {
      const lang = (socio.language ?? DEFAULT_LANGUAGE) as SupportedLanguage;
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
