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

// ─── Onboarding Strings ─────────────────────────────────────────────
// These are sent before the AI is involved, so they must be pre-translated.

interface OnboardingStrings {
    languagePicker: string;
    languageConfirmed: string;
    consentPrompt: string;
    consentAcceptKeyword: string;
    consentRetry: string;
    namePrompt: string;
    nameRetry: string;
    businessPrompt: string;
    businessRetry: string;
    /** Sent after business description is saved (onboarding complete). */
    welcome: (name: string) => string;
}

export const ONBOARDING: Record<SupportedLanguage, OnboardingStrings> = {
    es: {
        languagePicker:
            '¡Hola! Soy tu mentor virtual de Mentors International.\n\nElige tu idioma / Choose your language / Escolha seu idioma:\n\n1. Español\n2. English\n3. Português',
        languageConfirmed: '¡Perfecto! Continuamos en español.',
        consentPrompt:
            "Para continuar, por favor lee y acepta nuestros términos de uso. Responde 'ACEPTO' para iniciar.",
        consentAcceptKeyword: 'ACEPTO',
        consentRetry:
            "Por favor responde 'ACEPTO' para confirmar que estás de acuerdo con los términos.",
        namePrompt:
            '¡Hola! Soy tu mentor virtual de Mentors International 🤖. Estoy aquí para ayudarte a crecer tu negocio. Para empezar, ¿cómo te llamas?',
        nameRetry:
            'No pude entender tu nombre. ¿Podrías escribir solo tu nombre, por favor?',
        businessPrompt:
            '¡Gracias! Ahora cuéntame, ¿qué tipo de negocio tienes? Por ejemplo: tienda de ropa, venta de comida, servicios de limpieza, etc.',
        businessRetry:
            'No pude entender bien. ¿Podrías describir tu negocio en pocas palabras? Por ejemplo: "Vendo empanadas en el mercado" o "Tengo una peluquería".',
        welcome: (name: string) =>
            `¡Perfecto, ${name}! 👋 Ya podemos empezar con tu mentoría. Cuando quieras, escribe "comenzar" para iniciar tu primera lección.`,
    },
    en: {
        languagePicker:
            'Hello! I\'m your virtual mentor from Mentors International.\n\nChoose your language / Elige tu idioma / Escolha seu idioma:\n\n1. Español\n2. English\n3. Português',
        languageConfirmed: 'Great! We\'ll continue in English.',
        consentPrompt:
            "To continue, please read and accept our terms of use. Reply 'ACCEPT' to start.",
        consentAcceptKeyword: 'ACCEPT',
        consentRetry:
            "Please reply 'ACCEPT' to confirm that you agree with the terms.",
        namePrompt:
            "Hi! I'm your virtual mentor from Mentors International 🤖. I'm here to help you grow your business. To get started, what's your name?",
        nameRetry:
            "I couldn't catch your name. Could you please type just your name?",
        businessPrompt:
            'Thanks! Now tell me, what kind of business do you have? For example: clothing store, food sales, cleaning services, etc.',
        businessRetry:
            'I didn\'t quite understand. Could you describe your business in a few words? For example: "I sell empanadas at the market" or "I have a hair salon".',
        welcome: (name: string) =>
            `Great, ${name}! 👋 We can start your mentorship now. When you\'re ready, type "comenzar" or "start" to begin your first lesson.`,
    },
    pt: {
        languagePicker:
            'Olá! Sou seu mentor virtual da Mentors International.\n\nEscolha seu idioma / Elige tu idioma / Choose your language:\n\n1. Español\n2. English\n3. Português',
        languageConfirmed: 'Perfeito! Vamos continuar em português.',
        consentPrompt:
            "Para continuar, por favor leia e aceite nossos termos de uso. Responda 'ACEITO' para começar.",
        consentAcceptKeyword: 'ACEITO',
        consentRetry:
            "Por favor responda 'ACEITO' para confirmar que você concorda com os termos.",
        namePrompt:
            'Olá! Sou seu mentor virtual da Mentors International 🤖. Estou aqui para ajudar você a crescer seu negócio. Para começar, qual é o seu nome?',
        nameRetry:
            'Não consegui entender seu nome. Poderia digitar apenas o seu nome, por favor?',
        businessPrompt:
            'Obrigado! Agora me conte, que tipo de negócio você tem? Por exemplo: loja de roupas, venda de comida, serviços de limpeza, etc.',
        businessRetry:
            'Não entendi bem. Poderia descrever seu negócio em poucas palavras? Por exemplo: "Vendo empanadas no mercado" ou "Tenho um salão de beleza".',
        welcome: (name: string) =>
            `Perfeito, ${name}! 👋 Já podemos começar sua mentoria. Quando quiser, digite "comenzar" para iniciar sua primeira lição.`,
    },
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

interface LessonMessageStrings {
    lessonHeader: (num: number, total: number) => string;
    lessonComplete: (num: number) => string;
    nextLesson: (num: number) => string;
    courseComplete: string;
    welcomeWithName: (name: string) => string;
    welcomeAnonymous: string;
    welcomeStart: string;
}

export const LESSON_MESSAGES: Record<SupportedLanguage, LessonMessageStrings> = {
    es: {
        lessonHeader: (num, total) => `📚 Lección ${num} de ${total}`,
        lessonComplete: (num) => `✅ ¡Lección ${num} completada!`,
        nextLesson: (num) => `Cuando estés listo(a), escribe "siguiente" para comenzar la Lección ${num}.`,
        courseComplete: '¡Felicitaciones por completar todas las lecciones!',
        welcomeWithName: (name) => `¡Hola ${name}! 👋 Soy tu Mentor Virtual de Mentors International.\n\nEstoy aquí para ayudarte a fortalecer tu negocio con lecciones prácticas sobre finanzas, ventas y más.\n\n📚 Cuando estés listo(a), escribe "comenzar" para iniciar tu primera lección.`,
        welcomeAnonymous: `¡Hola! 👋 Soy tu Mentor Virtual de Mentors International.\n\nEstoy aquí para ayudarte a fortalecer tu negocio con lecciones prácticas sobre finanzas, ventas y más.\n\n📚 Cuando estés listo(a), escribe "comenzar" para iniciar tu primera lección.`,
        welcomeStart: 'comenzar',
    },
    en: {
        lessonHeader: (num, total) => `📚 Lesson ${num} of ${total}`,
        lessonComplete: (num) => `✅ Lesson ${num} complete!`,
        nextLesson: (num) => `When you're ready, type "next" to start Lesson ${num}.`,
        courseComplete: 'Congratulations on completing all the lessons!',
        welcomeWithName: (name) => `Hi ${name}! 👋 I'm your Virtual Mentor from Mentors International.\n\nI'm here to help you strengthen your business with practical lessons on finances, sales, and more.\n\n📚 When you're ready, type "start" to begin your first lesson.`,
        welcomeAnonymous: `Hi! 👋 I'm your Virtual Mentor from Mentors International.\n\nI'm here to help you strengthen your business with practical lessons on finances, sales, and more.\n\n📚 When you're ready, type "start" to begin your first lesson.`,
        welcomeStart: 'start',
    },
    pt: {
        lessonHeader: (num, total) => `📚 Lição ${num} de ${total}`,
        lessonComplete: (num) => `✅ Lição ${num} concluída!`,
        nextLesson: (num) => `Quando estiver pronto(a), digite "próximo" para começar a Lição ${num}.`,
        courseComplete: 'Parabéns por completar todas as lições!',
        welcomeWithName: (name) => `Olá ${name}! 👋 Sou seu Mentor Virtual da Mentors International.\n\nEstou aqui para ajudar você a fortalecer seu negócio com lições práticas sobre finanças, vendas e mais.\n\n📚 Quando estiver pronto(a), digite "começar" para iniciar sua primeira lição.`,
        welcomeAnonymous: `Olá! 👋 Sou seu Mentor Virtual da Mentors International.\n\nEstou aqui para ajudar você a fortalecer seu negócio com lições práticas sobre finanças, vendas e mais.\n\n📚 Quando estiver pronto(a), digite "começar" para iniciar sua primeira lição.`,
        welcomeStart: 'começar',
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
