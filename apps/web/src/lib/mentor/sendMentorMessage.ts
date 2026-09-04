/**
 * A mentor sending a direct message to a learner — the one write path, used
 * by both `/api/dashboard/socios/[id]/message` and the D.3 embedded
 * assistant's `draft_message_to_learner` tool. Pulled out so the two never
 * quietly diverge on how WhatsApp delivery is attempted or reported.
 */
import { repo } from '@/lib/repo';
import { WhatsAppChannel } from '@/lib/delivery';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/languages';
import type { SupportedLanguage } from '@/lib/i18n/languages';
import type { Message } from '@/lib/repo/types';

const MENTOR_LABEL: Record<SupportedLanguage, string> = {
  es: 'Tu Mentor',
  en: 'Your Mentor',
  pt: 'Seu Mentor',
};

export type SendMentorMessageResult = {
  message: Message;
  whatsappDelivered: boolean;
  whatsappError: string | null;
};

export async function sendMentorMessage(socioId: string, content: string): Promise<SendMentorMessageResult> {
  const socio = await repo.getSocioById(socioId);
  if (!socio) {
    throw new Error('Socio not found');
  }

  const savedMessage = await repo.addMessage({
    socioId: socio.id,
    role: 'mentor',
    content,
    senderType: 'mentor',
  });

  let whatsappDelivered = false;
  let whatsappError: string | null = null;

  if (socio.channelType === 'whatsapp' && socio.whatsappPhoneNumber) {
    try {
      const lang = (socio.language ?? DEFAULT_LANGUAGE) as SupportedLanguage;
      const label = MENTOR_LABEL[lang] ?? MENTOR_LABEL['es'];
      const whatsappText = `${content}\n\n— ${label}`;
      const channel = new WhatsAppChannel();
      await channel.sendMessage(socio.whatsappPhoneNumber, whatsappText);
      whatsappDelivered = true;
    } catch (error) {
      whatsappError = error instanceof Error ? error.message : String(error);
      console.error('[sendMentorMessage] WhatsApp delivery failed:', whatsappError);
    }
  }

  return { message: savedMessage, whatsappDelivered, whatsappError };
}
