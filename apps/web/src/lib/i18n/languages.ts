export type SupportedLanguage = 'es' | 'en' | 'pt';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['es', 'en', 'pt'];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'es';

export interface LanguageMeta {
    code: SupportedLanguage;
    name: string;
    nativeName: string;
    flag: string;
}

export const LANGUAGE_META: Record<SupportedLanguage, LanguageMeta> = {
    es: { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
    en: { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
    pt: { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷' },
};

// ─── UI Strings (for the web chat frontend) ─────────────────────────

interface UIStrings {
    placeholder: string;
    send: string;
    error: string;
}

export const UI_STRINGS: Record<SupportedLanguage, UIStrings> = {
    es: {
        placeholder: 'Escribe tu mensaje...',
        send: 'Enviar',
        error: 'Error al conectar con el servidor. Intenta de nuevo.',
    },
    en: {
        placeholder: 'Type your message...',
        send: 'Send',
        error: 'Error connecting to the server. Please try again.',
    },
    pt: {
        placeholder: 'Digite sua mensagem...',
        send: 'Enviar',
        error: 'Erro ao conectar com o servidor. Tente novamente.',
    },
};

/** Admin system logs page subtitle (follows `/api/auth/me` language for mentor/admin). */
export const ADMIN_LOGS_PAGE_INTRO: Record<SupportedLanguage, string> = {
    es:
        'Eventos estructurados recientes (consola y base de datos). Solo para el piloto. Solo los administradores pueden ver estos registros.',
    en:
        'Recent structured events (console + database). For pilot visibility only. Only administrators can view these logs.',
    pt:
        'Eventos estruturados recentes (console e banco de dados). Apenas para o piloto. Somente administradores podem ver estes registros.',
};

/** Web chat header subtitle (mentor line + optional lesson; brand unchanged). */
export const CHAT_SUBTITLE: Record<
    SupportedLanguage,
    { mentor: string; lesson: (n: number) => string }
> = {
    es: { mentor: 'Tu mentor virtual', lesson: (n) => `Lección ${n}` },
    en: { mentor: 'Your virtual mentor', lesson: (n) => `Lesson ${n}` },
    pt: { mentor: 'Seu mentor virtual', lesson: (n) => `Lição ${n}` },
};

/** Empty chat placeholder for socios when there are no messages yet. */
export const CHAT_EMPTY_STATE_SOCIO: Record<SupportedLanguage, (name?: string) => string> = {
    es: (name) =>
        name
            ? `¡Hola, ${name}! Escribe un mensaje para comenzar.`
            : '¡Hola! Escribe un mensaje para comenzar.',
    en: (name) =>
        name
            ? `Hi, ${name}! Type a message to get started.`
            : 'Hi! Type a message to get started.',
    pt: (name) =>
        name
            ? `Olá, ${name}! Escreva uma mensagem para começar.`
            : 'Olá! Escreva uma mensagem para começar.',
};

// ─── AI Error Fallback Messages ───────────────────────────────────────

export const AI_ERROR_FALLBACK: Record<SupportedLanguage, string> = {
    es: 'Lo siento, tuve un problema pensando mi respuesta. ¿Me puedes repetir eso? 🤖',
    en: 'Sorry, I had a problem thinking through my response. Could you repeat that? 🤖',
    pt: 'Desculpe, tive um problema para formular minha resposta. Pode repetir isso? 🤖',
};

// ─── Lesson Notification Messages ────────────────────────────────────
// Platform chrome for lesson flow. Course-specific welcomes come from config.

interface LessonMessageStrings {
    lessonHeader: (num: number, total: number) => string;
    lessonComplete: (num: number) => string;
    nextLesson: (num: number) => string;
    courseComplete: string;
    /** Fallback welcome for web socios without course config. */
    welcomeWithName: (name: string) => string;
    /** Fallback welcome for web socios without course config. */
    welcomeAnonymous: string;
    welcomeStart: string;
    escalationConfirmation: string;
    /** Feedback prompt - course-neutral, no business framing. */
    feedbackPrompt: (completedNum: number) => string;
}

export const LESSON_MESSAGES: Record<SupportedLanguage, LessonMessageStrings> = {
    es: {
        lessonHeader: (num, total) => `📚 Lección ${num} de ${total}`,
        lessonComplete: (num) => `✅ ¡Lección ${num} completada!`,
        nextLesson: (num) => `Cuando estés listo(a), escribe "siguiente" para comenzar la Lección ${num}.`,
        courseComplete: '¡Felicitaciones por completar todas las lecciones!',
        welcomeWithName: (name) => `¡Hola ${name}! 👋 Estoy aquí para ayudarte a aprender con lecciones prácticas.\n\n📚 Cuando estés listo(a), escribe "comenzar" para iniciar tu primera lección.`,
        welcomeAnonymous: `¡Hola! 👋 Estoy aquí para ayudarte a aprender con lecciones prácticas.\n\n📚 Cuando estés listo(a), escribe "comenzar" para iniciar tu primera lección.`,
        welcomeStart: 'comenzar',
        escalationConfirmation: '📋 He notificado a tu mentor humano. Te contactará lo más pronto posible. Mientras tanto, puedo seguir ayudándote con cualquier pregunta.',
        feedbackPrompt: (n) => `💬 ¡Has completado ${n} lecciones! Me encantaría saber tu opinión. Del 1 al 10, ¿qué tan útil ha sido este programa para ti? Puedes agregar cualquier comentario.`,
    },
    en: {
        lessonHeader: (num, total) => `📚 Lesson ${num} of ${total}`,
        lessonComplete: (num) => `✅ Lesson ${num} complete!`,
        nextLesson: (num) => `When you're ready, type "next" to start Lesson ${num}.`,
        courseComplete: 'Congratulations on completing all the lessons!',
        welcomeWithName: (name) => `Hi ${name}! 👋 I'm here to help you learn with practical lessons.\n\n📚 When you're ready, type "start" to begin your first lesson.`,
        welcomeAnonymous: `Hi! 👋 I'm here to help you learn with practical lessons.\n\n📚 When you're ready, type "start" to begin your first lesson.`,
        welcomeStart: 'start',
        escalationConfirmation: "📋 I've notified your human mentor. They will contact you as soon as possible. In the meantime, I'm here if you have any questions.",
        feedbackPrompt: (n) => `💬 You've completed ${n} lessons! I'd love to hear your thoughts. On a scale of 1 to 10, how useful has this program been for you? Feel free to add any comments.`,
    },
    pt: {
        lessonHeader: (num, total) => `📚 Lição ${num} de ${total}`,
        lessonComplete: (num) => `✅ Lição ${num} concluída!`,
        nextLesson: (num) => `Quando estiver pronto(a), digite "próximo" para começar a Lição ${num}.`,
        courseComplete: 'Parabéns por completar todas as lições!',
        welcomeWithName: (name) => `Olá ${name}! 👋 Estou aqui para ajudá-lo a aprender com lições práticas.\n\n📚 Quando estiver pronto(a), digite "começar" para iniciar sua primeira lição.`,
        welcomeAnonymous: `Olá! 👋 Estou aqui para ajudá-lo a aprender com lições práticas.\n\n📚 Quando estiver pronto(a), digite "começar" para iniciar sua primeira lição.`,
        welcomeStart: 'começar',
        escalationConfirmation: '📋 Notifiquei seu mentor humano. Ele entrará em contato o mais breve possível. Enquanto isso, estou aqui se você tiver dúvidas.',
        feedbackPrompt: (n) => `💬 Você completou ${n} lições! Adoraria saber sua opinião. De 1 a 10, o quanto este programa tem sido útil para você? Pode adicionar qualquer comentário.`,
    },
};

// ─── Language Directives (injected into the AI system prompt) ────────

const LANGUAGE_DIRECTIVES: Record<SupportedLanguage, string> = {
    es: '',
    en: `CRITICAL LANGUAGE RULE — THIS OVERRIDES ALL PREVIOUS INSTRUCTIONS:
You MUST respond ENTIRELY in English. Every single word you write to the user must be in English — no exceptions.
- The earlier instruction "Habla español colombiano sencillo" does NOT apply to this user. Ignore it completely.
- Do NOT write any Spanish words, phrases, or sentences in your response.
- Adapt cultural examples to be more universal (corner stores, local markets, small businesses).
- System markers ([FLAG:...], [LESSON_COMPLETE:...], [ESCALATE|...]) stay in their original format — do not translate them.
- Keep the same warm, encouraging tone, just in English.`,
    pt: `REGRA CRÍTICA DE IDIOMA — SUBSTITUI TODAS AS INSTRUÇÕES ANTERIORES:
Você DEVE responder INTEIRAMENTE em português brasileiro. Cada palavra que você escrever ao usuário deve estar em português — sem exceções.
- A instrução anterior "Habla español colombiano sencillo" NÃO se aplica a este usuário. Ignore-a completamente.
- NÃO escreva nenhuma palavra, frase ou sentença em espanhol na sua resposta.
- Adapte exemplos culturais ao contexto brasileiro (padarias, lojas de bairro, vendas pelo WhatsApp, feiras locais).
- Os marcadores de sistema ([FLAG:...], [LESSON_COMPLETE:...], [ESCALATE|...]) permanecem no formato original — não os traduza.
- Mantenha o mesmo tom caloroso e encorajador, apenas em português.`,
};

export function getLanguageDirective(language: SupportedLanguage): string {
    return LANGUAGE_DIRECTIVES[language] || '';
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function parseLanguageChoice(input: string): SupportedLanguage | null {
    const cleaned = input.trim().toLowerCase();

    if (cleaned === '1' || cleaned === 'español' || cleaned === 'espanol' || cleaned === 'spanish') return 'es';
    if (cleaned === '2' || cleaned === 'english' || cleaned === 'inglés' || cleaned === 'ingles') return 'en';
    if (cleaned === '3' || cleaned === 'português' || cleaned === 'portugues' || cleaned === 'portuguese') return 'pt';

    return null;
}

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
    return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage);
}
