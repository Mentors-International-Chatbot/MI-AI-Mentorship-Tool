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
        welcome: (name: string) =>
            `¡Mucho gusto, ${name}! 👋\n\nPara darte los mejores consejos, cuéntame: ¿Qué tipo de negocio tienes? (Ej: Panadería, Tienda de ropa, Servicios...)`,
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
        welcome: (name: string) =>
            `Nice to meet you, ${name}! 👋\n\nTo give you the best advice, tell me: what kind of business do you have? (e.g. Bakery, Clothing store, Services...)`,
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
        welcome: (name: string) =>
            `Muito prazer, ${name}! 👋\n\nPara te dar os melhores conselhos, me conte: que tipo de negócio você tem? (Ex: Padaria, Loja de roupas, Serviços...)`,
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

// ─── Language Directives (injected into the AI system prompt) ────────

const LANGUAGE_DIRECTIVES: Record<SupportedLanguage, string> = {
    es: '',
    en: `LANGUAGE OVERRIDE:
You MUST respond ENTIRELY in English. The socio speaks English.
- Translate all your responses to natural, friendly English.
- Adapt cultural examples to be more universal (corner stores, local markets, small businesses).
- System markers ([FLAG:...], [LESSON_COMPLETE:...], [ESCALATE|...]) stay in their original format.
- Keep the same warm, encouraging tone described above, just in English.`,
    pt: `LANGUAGE OVERRIDE:
You MUST respond ENTIRELY in Brazilian Portuguese. The socio speaks Portuguese.
- Translate all your responses to natural, friendly Brazilian Portuguese.
- Adapt cultural examples to Brazilian context (padarias, lojas de bairro, vendas pelo WhatsApp, feiras locais).
- System markers ([FLAG:...], [LESSON_COMPLETE:...], [ESCALATE|...]) stay in their original format.
- Keep the same warm, encouraging tone described above, just in Portuguese.`,
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
