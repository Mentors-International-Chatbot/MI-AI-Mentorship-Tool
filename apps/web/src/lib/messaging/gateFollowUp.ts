/**
 * Speaking first, once a gate resolves
 * ═══════════════════════════════════════════════════════════════════════════
 * Observed: a learner passed a teach-back, the score card rendered, and the
 * conversation went silent. They had to type "yay! Am i done?" to get anything
 * back. Passing an assessment is the most conversational moment in the whole
 * course and it was the one moment the AI had nothing to say.
 *
 * This produces that turn. It invents no transport: the message row IS the
 * delivery, exactly as the mentor DM at `/api/dashboard/socios/[id]/message`
 * already works, and `chat/page.tsx` picks it up on its five-second poll. On
 * WhatsApp the socio's own channel sends it for real.
 *
 * ── Why a synthetic human turn ────────────────────────────────────────────
 * `generateAIResponse` is built around an incoming message, so an unprompted
 * turn needs something in that slot. The instruction below fills it and is
 * never persisted or shown — the same trick, for the same reason, as the
 * reminder cron's "(the socio has not replied…)" human turn.
 *
 * It states the outcome even though Layer 2 already carries a gate line
 * (`prompts/gateRecency.ts`). That redundancy is deliberate and cheap: the
 * failure mode it guards against is congratulating someone who just failed,
 * which is bad enough to be worth saying twice. Layer 2 supplies the fact; this
 * supplies the occasion and the instruction.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { repo } from '@/lib/repo';
import { WebChannel, WhatsAppChannel, type DeliveryChannel } from '@/lib/delivery';
import { DEFAULT_LANGUAGE, type SupportedLanguage } from '@/lib/i18n/languages';
import { handleIncomingMessage } from './handler';

/**
 * The instruction standing in for a learner message.
 *
 * Localized for the same reason every other participant-adjacent string is: it
 * steers a reply the learner reads, and a Spanish-speaking learner should not
 * get a reply shaped by an English instruction.
 */
const FOLLOW_UP_INSTRUCTION: Record<SupportedLanguage, (passed: boolean) => string> = {
  es: (passed) =>
    passed
      ? '(El participante acaba de APROBAR la evaluación de comprensión. Habla tú primero, sin esperar a que escriba: reconoce el logro brevemente y llévalo a lo que sigue.)'
      : '(El participante acaba de terminar la evaluación de comprensión SIN aprobarla. Habla tú primero, sin esperar a que escriba: reconoce el intento con calidez, NO lo felicites, y ofrécele repasar el material o intentarlo de nuevo.)',
  en: (passed) =>
    passed
      ? '(The participant just PASSED the comprehension check. Speak first, without waiting for them to write: acknowledge it briefly and move them to what comes next.)'
      : '(The participant just finished the comprehension check WITHOUT passing. Speak first, without waiting for them to write: acknowledge the attempt warmly, do NOT congratulate them, and offer to review the material or try again.)',
  pt: (passed) =>
    passed
      ? '(O participante acaba de SER APROVADO na avaliação de compreensão. Fale primeiro, sem esperar que ele escreva: reconheça brevemente e leve-o ao que vem a seguir.)'
      : '(O participante acaba de terminar a avaliação de compreensão SEM ser aprovado. Fale primeiro, sem esperar que ele escreva: reconheça a tentativa com carinho, NÃO o parabenize, e ofereça revisar o material ou tentar de novo.)',
};

function channelFor(channelType: string): DeliveryChannel {
  // WebChannel buffers and discards; the Message row is what reaches a web
  // learner. WhatsApp actually transmits.
  return channelType === 'whatsapp' ? new WhatsAppChannel() : new WebChannel();
}

/**
 * Generates and delivers the turn that follows a resolved gate.
 *
 * Never throws. The learner has already completed their assessment and the
 * scores are already committed by the time this runs; failing their completion
 * request because a follow-up message could not be generated would turn a
 * missing nicety into a broken flow.
 *
 * Returns whether a message was actually posted, which is false whenever the
 * duplicate guard in the handler decided someone had already spoken.
 */
export async function runGateResolvedFollowUp(params: {
  socioId: string;
  sessionId: string;
  passed: boolean;
  /** When the gate resolved. The duplicate guard's reference point. */
  resolvedAt: Date;
}): Promise<boolean> {
  const { socioId, sessionId, passed, resolvedAt } = params;

  try {
    const socio = await repo.getSocioById(socioId);
    if (!socio) {
      console.error(`[GateFollowUp] Socio ${socioId} not found`);
      return false;
    }
    if (socio.aiPaused) return false;

    const language = (socio.language || DEFAULT_LANGUAGE) as SupportedLanguage;
    const build = FOLLOW_UP_INSTRUCTION[language] ?? FOLLOW_UP_INSTRUCTION['en'];

    const result = await handleIncomingMessage({
      externalId: socio.externalId,
      channelType: socio.channelType as 'web' | 'whatsapp',
      message: build(passed),
      channel: channelFor(socio.channelType),
      systemInitiated: {
        kind: 'gate_resolved',
        sessionId,
        suppressIfAssistantSpokeAfter: resolvedAt,
      },
    });

    return !result.suppressed && result.responseText.length > 0;
  } catch (error) {
    console.error(`[GateFollowUp] Failed for socio ${socioId}, session ${sessionId}:`, error);
    return false;
  }
}
