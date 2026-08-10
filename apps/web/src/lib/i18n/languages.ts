export type SupportedLanguage = 'es' | 'en' | 'pt';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['en', 'es', 'pt'];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

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

// ─── Assessment Strings (for gated teach-back UI) ─────────────────────

interface AssessmentStrings {
    startButton: string;
    resumeButton: string;
    viewButton: string;
    completeButton: string;
    backToChat: string;
    scoreLabel: string;
    loading: string;
    error: string;
    readOnlyNotice: string;
    placeholder: string;
    /**
     * Closing lines written into the assessment transcript by
     * `/api/assessment/[sessionId]/complete`. These were English string
     * literals in the route until 2026-08-09, so a Spanish-speaking learner
     * finished a Spanish assessment and was congratulated in English.
     *
     * They close the ASSESSMENT only. The conversational half — acknowledging
     * the result and moving the learner on — belongs to the AI's follow-up turn
     * (`messaging/gateFollowUp.ts`), not here.
     */
    completedPassed: string;
    completedNotPassed: string;
    completedReteach: string;
    completedCancelled: string;
}

export const ASSESSMENT_STRINGS: Record<SupportedLanguage, AssessmentStrings> = {
    es: {
        startButton: 'Comenzar evaluación',
        resumeButton: 'Continuar evaluación',
        viewButton: 'Ver evaluación',
        completeButton: 'Evaluación completada',
        backToChat: 'Volver a tu lección',
        scoreLabel: 'Comprensión',
        loading: 'Cargando...',
        error: 'No se pudo cargar la evaluación. Intenta de nuevo.',
        readOnlyNotice: 'Esta evaluación ya está completada.',
        placeholder: 'Escribe tu respuesta...',
        completedPassed: '¡Muy bien! Completaste esta evaluación.',
        completedNotPassed: 'Terminaste esta evaluación. ¡Gracias por tu esfuerzo!',
        completedReteach: 'Repasemos el material juntos. Tómate tu tiempo para volver a ver la lección.',
        completedCancelled: 'Sin problema. Puedes intentar esta evaluación cuando quieras.',
    },
    en: {
        startButton: 'Start assessment',
        resumeButton: 'Resume assessment',
        viewButton: 'View assessment',
        completeButton: 'Assessment complete',
        backToChat: 'Back to your lesson',
        scoreLabel: 'Understanding',
        loading: 'Loading...',
        error: 'Could not load assessment. Please try again.',
        readOnlyNotice: 'This assessment is already complete.',
        placeholder: 'Type your response...',
        completedPassed: 'Nicely done. You completed this assessment.',
        completedNotPassed: "You've completed this assessment. Thank you for your effort!",
        completedReteach: "Let's review the material together. Take your time going through the lesson again.",
        completedCancelled: "That's okay! You can try this assessment again whenever you're ready.",
    },
    pt: {
        startButton: 'Iniciar avaliação',
        resumeButton: 'Continuar avaliação',
        viewButton: 'Ver avaliação',
        completeButton: 'Avaliação concluída',
        backToChat: 'Voltar para sua lição',
        scoreLabel: 'Compreensão',
        loading: 'Carregando...',
        error: 'Não foi possível carregar a avaliação. Tente novamente.',
        readOnlyNotice: 'Esta avaliação já foi concluída.',
        placeholder: 'Digite sua resposta...',
        completedPassed: 'Muito bem! Você concluiu esta avaliação.',
        completedNotPassed: 'Você concluiu esta avaliação. Obrigado pelo seu esforço!',
        completedReteach: 'Vamos revisar o material juntos. Reserve um tempo para rever a lição.',
        completedCancelled: 'Sem problema. Você pode tentar esta avaliação quando quiser.',
    },
};

// ─── Progress Panel (web chat sidebar) ───────────────────────────────
// Scaffolding only. Every value shown through these labels — course name,
// lesson count, project title, milestone names — comes from the learner's own
// collection and its declared outcome, never from here.

interface ProgressStrings {
    heading: string;
    lessonOf: (current: number, total: number) => string;
    partOf: (part: number, total: number) => string;
    gateHeading: string;
    gateNotReached: string;
    gatePassed: string;
    gateNotPassed: string;
    projectHeading: string;
    milestoneDone: string;
    milestonePending: string;
    /** Accessible name for the narrow-viewport toggle. */
    toggleLabel: string;
}

export const PROGRESS_STRINGS: Record<SupportedLanguage, ProgressStrings> = {
    es: {
        heading: 'Tu avance',
        lessonOf: (c, t) => `Lección ${c} de ${t}`,
        partOf: (p, t) => `Parte ${p} de ${t}`,
        gateHeading: 'Evaluación',
        gateNotReached: 'Aún no la alcanzas',
        gatePassed: 'Aprobada',
        gateNotPassed: 'Sin aprobar',
        projectHeading: 'Tu proyecto',
        milestoneDone: 'hecho',
        milestonePending: 'pendiente',
        toggleLabel: 'Mostrar u ocultar tu avance',
    },
    en: {
        heading: 'Your progress',
        lessonOf: (c, t) => `Lesson ${c} of ${t}`,
        partOf: (p, t) => `Part ${p} of ${t}`,
        gateHeading: 'Assessment',
        gateNotReached: 'Not yet reached',
        gatePassed: 'Passed',
        gateNotPassed: 'Not passed',
        projectHeading: 'Your project',
        milestoneDone: 'done',
        milestonePending: 'pending',
        toggleLabel: 'Show or hide your progress',
    },
    pt: {
        heading: 'Seu progresso',
        lessonOf: (c, t) => `Lição ${c} de ${t}`,
        partOf: (p, t) => `Parte ${p} de ${t}`,
        gateHeading: 'Avaliação',
        gateNotReached: 'Ainda não alcançada',
        gatePassed: 'Aprovada',
        gateNotPassed: 'Não aprovada',
        projectHeading: 'Seu projeto',
        milestoneDone: 'feito',
        milestonePending: 'pendente',
        toggleLabel: 'Mostrar ou ocultar seu progresso',
    },
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
                    welcomeWithName: (name) => `¡Hola ${name}! 👋 Estoy aquí para ayudarte a aprender con lecciones prácticas.\n\n📚 Cuando estés listo(a), escribe "comenzar" para iniciar tu primera lección.`,
        welcomeAnonymous: `¡Hola! 👋 Estoy aquí para ayudarte a aprender con lecciones prácticas.\n\n📚 Cuando estés listo(a), escribe "comenzar" para iniciar tu primera lección.`,
        welcomeStart: 'comenzar',
        escalationConfirmation: '📋 He notificado a tu mentor humano. Te contactará lo más pronto posible. Mientras tanto, puedo seguir ayudándote con cualquier pregunta.',
        feedbackPrompt: (n) => `💬 ¡Has completado ${n} lecciones! Me encantaría saber tu opinión. Del 1 al 10, ¿qué tan útil ha sido este programa para ti? Puedes agregar cualquier comentario.`,
    },
    en: {
        lessonHeader: (num, total) => `📚 Lesson ${num} of ${total}`,
                    welcomeWithName: (name) => `Hi ${name}! 👋 I'm here to help you learn with practical lessons.\n\n📚 When you're ready, type "start" to begin your first lesson.`,
        welcomeAnonymous: `Hi! 👋 I'm here to help you learn with practical lessons.\n\n📚 When you're ready, type "start" to begin your first lesson.`,
        welcomeStart: 'start',
        escalationConfirmation: "📋 I've notified your human mentor. They will contact you as soon as possible. In the meantime, I'm here if you have any questions.",
        feedbackPrompt: (n) => `💬 You've completed ${n} lessons! I'd love to hear your thoughts. On a scale of 1 to 10, how useful has this program been for you? Feel free to add any comments.`,
    },
    pt: {
        lessonHeader: (num, total) => `📚 Lição ${num} de ${total}`,
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

    // Numbering follows the picker order in onboarding/service.ts: English first.
    if (cleaned === '1' || cleaned === 'english' || cleaned === 'inglés' || cleaned === 'ingles') return 'en';
    if (cleaned === '2' || cleaned === 'español' || cleaned === 'espanol' || cleaned === 'spanish') return 'es';
    if (cleaned === '3' || cleaned === 'português' || cleaned === 'portugues' || cleaned === 'portuguese') return 'pt';

    return null;
}

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
    return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage);
}
