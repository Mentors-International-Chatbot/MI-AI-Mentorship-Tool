import { repo } from '@/lib/repo';
import { Socio } from '@/lib/repo/types';
import type { DeliveryChannel } from '@/lib/delivery/types';
import {
    parseLanguageChoice,
    DEFAULT_LANGUAGE,
    type SupportedLanguage,
} from '@/lib/i18n/languages';
import { extractName } from './extractName';
import {
    getCourseMeta,
    resolveLocalized,
    buildWelcomeMessage,
    type CourseMeta,
} from '@/lib/courses/course-meta';
import { DEFAULT_ONBOARDING } from '@/lib/courses/defaults';

const REQUIRE_LEGAL_CONSENT = false;

function lang(socio: Socio): SupportedLanguage {
    return (socio.language || DEFAULT_LANGUAGE) as SupportedLanguage;
}

// ── Platform-level strings (language picker, consent) ────────────────────────
// These are sent before course selection, so they must be course-neutral.

const PLATFORM_STRINGS: Record<SupportedLanguage, {
    languagePicker: string;
    languageConfirmed: string;
    consentPrompt: string;
    consentAcceptKeyword: string;
    consentRetry: string;
}> = {
    es: {
        languagePicker:
            '¡Hola! 👋\n\nChoose your language / Elige tu idioma / Escolha seu idioma:\n\n1. English\n2. Español\n3. Português',
        languageConfirmed: '¡Perfecto! Continuamos en español.',
        consentPrompt:
            "Para continuar, por favor lee y acepta nuestros términos de uso. Responde 'ACEPTO' para iniciar.",
        consentAcceptKeyword: 'ACEPTO',
        consentRetry:
            "Por favor responde 'ACEPTO' para confirmar que estás de acuerdo con los términos.",
    },
    en: {
        languagePicker:
            'Hello! 👋\n\nChoose your language / Elige tu idioma / Escolha seu idioma:\n\n1. English\n2. Español\n3. Português',
        languageConfirmed: "Great! We'll continue in English.",
        consentPrompt:
            "To continue, please read and accept our terms of use. Reply 'ACCEPT' to start.",
        consentAcceptKeyword: 'ACCEPT',
        consentRetry:
            "Please reply 'ACCEPT' to confirm that you agree with the terms.",
    },
    pt: {
        languagePicker:
            'Olá! 👋\n\nChoose your language / Escolha seu idioma / Elige tu idioma:\n\n1. English\n2. Español\n3. Português',
        languageConfirmed: 'Perfeito! Vamos continuar em português.',
        consentPrompt:
            "Para continuar, por favor leia e aceite nossos termos de uso. Responda 'ACEITO' para começar.",
        consentAcceptKeyword: 'ACEITO',
        consentRetry:
            "Por favor responda 'ACEITO' para confirmar que você concorda com os termos.",
    },
};

// ── Helper: Get step retry message ───────────────────────────────────────────

function getStepRetryMessage(stepField: string, language: SupportedLanguage): string {
    // Generic retry messages based on field type
    const retries: Record<SupportedLanguage, Record<string, string>> = {
        es: {
            name: 'No pude entender tu nombre. ¿Podrías escribir solo tu nombre, por favor?',
            default: 'No pude entender bien. ¿Podrías intentar de nuevo?',
        },
        en: {
            name: "I couldn't catch your name. Could you please type just your name?",
            default: "I didn't quite understand. Could you please try again?",
        },
        pt: {
            name: 'Não consegui entender seu nome. Poderia digitar apenas o seu nome, por favor?',
            default: 'Não entendi bem. Poderia tentar novamente?',
        },
    };

    return retries[language][stepField] ?? retries[language]['default'];
}

// ── Main Handler ─────────────────────────────────────────────────────────────

export async function handleOnboarding(socio: Socio, incomingMessage: string, channel: DeliveryChannel) {
    const message = incomingMessage.trim();
    const socioLang = lang(socio);

    // Get course config if socio has a curriculum
    const collectionKey = socio.curriculumCollectionKey;
    let meta: CourseMeta | null = null;
    if (collectionKey) {
        meta = await getCourseMeta(collectionKey);
    }

    // Get onboarding steps from config or use empty defaults
    const onboardingConfig = meta?.onboarding ?? DEFAULT_ONBOARDING;
    const steps = onboardingConfig.steps;

    switch (socio.status) {
        case 'NEW': {
            await repo.updateSocio(socio.id, { status: 'AWAITING_LANGUAGE' });
            await channel.sendMessage(
                socio.externalId,
                PLATFORM_STRINGS[DEFAULT_LANGUAGE].languagePicker,
            );
            break;
        }

        case 'AWAITING_LANGUAGE': {
            const chosen = parseLanguageChoice(message);
            if (!chosen) {
                await channel.sendMessage(
                    socio.externalId,
                    PLATFORM_STRINGS[DEFAULT_LANGUAGE].languagePicker,
                );
                break;
            }

            await repo.updateSocio(socio.id, { language: chosen });
            const strings = PLATFORM_STRINGS[chosen];

            if (REQUIRE_LEGAL_CONSENT) {
                await repo.updateSocio(socio.id, { status: 'AWAITING_CONSENT' });
                await channel.sendMessage(socio.externalId, strings.languageConfirmed + '\n\n' + strings.consentPrompt);
            } else {
                // Skip consent - proceed to onboarding steps or ACTIVE
                await transitionToOnboardingOrActive(socio, chosen, meta, steps, strings.languageConfirmed, channel);
            }
            break;
        }

        case 'AWAITING_CONSENT': {
            const strings = PLATFORM_STRINGS[socioLang];
            if (message.toUpperCase() === strings.consentAcceptKeyword) {
                await transitionToOnboardingOrActive(socio, socioLang, meta, steps, '', channel);
            } else {
                await channel.sendMessage(socio.externalId, strings.consentRetry);
            }
            break;
        }

        case 'AWAITING_NAME': {
            // Generic onboarding step handler
            // Get current step index from promptOverrides
            const overrides = (socio.promptOverrides || {}) as Record<string, unknown>;
            const currentStepIndex = typeof overrides.onboardingStep === 'number' ? overrides.onboardingStep : 0;

            if (currentStepIndex >= steps.length) {
                // Shouldn't happen, but handle gracefully
                await completeOnboarding(socio, meta, channel);
                break;
            }

            const currentStep = steps[currentStepIndex];
            const stepField = currentStep.field;

            // Process the response based on field type
            let value: string | null = null;

            if (stepField === 'name') {
                // Use name extraction for name field
                value = await extractName(message, socioLang);
                if (!value && currentStep.required) {
                    await channel.sendMessage(socio.externalId, getStepRetryMessage('name', socioLang));
                    break;
                }
            } else {
                // Generic text field - just validate non-empty if required
                value = message.trim();
                if ((!value || value.length < 2) && currentStep.required) {
                    await channel.sendMessage(socio.externalId, getStepRetryMessage(stepField, socioLang));
                    break;
                }
            }

            // Store the value in the appropriate field
            const updateData: Record<string, unknown> = {};
            if (value) {
                updateData[stepField] = value;
            }

            // Move to next step or complete
            const nextStepIndex = currentStepIndex + 1;

            if (nextStepIndex < steps.length) {
                // More steps - update and ask next question
                updateData.promptOverrides = { ...overrides, onboardingStep: nextStepIndex };
                await repo.updateSocio(socio.id, updateData);

                const nextStep = steps[nextStepIndex];
                const nextPrompt = resolveLocalized(nextStep.prompt, socioLang);
                await channel.sendMessage(socio.externalId, nextPrompt);
            } else {
                // All steps complete - transition to ACTIVE
                // Clear onboarding step from overrides
                const cleanOverrides = { ...overrides };
                delete cleanOverrides.onboardingStep;
                updateData.promptOverrides = Object.keys(cleanOverrides).length > 0 ? cleanOverrides : null;
                updateData.status = 'ACTIVE';

                await repo.updateSocio(socio.id, updateData);
                await repo.initProgress(socio.id);

                // Send welcome message
                const participantName = value && stepField === 'name' ? value : socio.name;
                await sendWelcome(socio, meta, socioLang, participantName, channel);
            }
            break;
        }

        // AWAITING_BUSINESS is deprecated but kept for backward compatibility
        // Redirect to generic step handler
        case 'AWAITING_BUSINESS': {
            // Treat as final step before ACTIVE
            const businessDesc = message.trim();

            if (businessDesc.length >= 2) {
                await repo.updateSocio(socio.id, {
                    businessDescription: businessDesc,
                    status: 'ACTIVE',
                });
                await repo.initProgress(socio.id);
                await sendWelcome(socio, meta, socioLang, socio.name, channel);
            } else {
                await channel.sendMessage(socio.externalId, getStepRetryMessage('default', socioLang));
            }
            break;
        }

        case 'ACTIVE':
            break;
    }
}

// ── Helper: Transition to onboarding steps or ACTIVE ─────────────────────────

async function transitionToOnboardingOrActive(
    socio: Socio,
    language: SupportedLanguage,
    meta: CourseMeta | null,
    steps: typeof DEFAULT_ONBOARDING.steps,
    prefixMessage: string,
    channel: DeliveryChannel,
) {
    if (steps.length === 0) {
        // No onboarding steps - go straight to ACTIVE
        await repo.updateSocio(socio.id, { status: 'ACTIVE' });
        await repo.initProgress(socio.id);

        const welcome = prefixMessage
            ? prefixMessage + '\n\n' + buildWelcomeForSocio(meta, language, null)
            : buildWelcomeForSocio(meta, language, null);
        await channel.sendMessage(socio.externalId, welcome);
    } else {
        // Has onboarding steps - start with first step
        await repo.updateSocio(socio.id, {
            status: 'AWAITING_NAME', // Generic onboarding state
            promptOverrides: { onboardingStep: 0 },
        });

        const firstStep = steps[0];
        const prompt = resolveLocalized(firstStep.prompt, language);
        const fullMessage = prefixMessage ? prefixMessage + '\n\n' + prompt : prompt;
        await channel.sendMessage(socio.externalId, fullMessage);
    }
}

// ── Helper: Send welcome message ─────────────────────────────────────────────

async function sendWelcome(
    socio: Socio,
    meta: CourseMeta | null,
    language: SupportedLanguage,
    participantName: string | null | undefined,
    channel: DeliveryChannel,
) {
    const welcome = buildWelcomeForSocio(meta, language, participantName);
    await channel.sendMessage(socio.externalId, welcome);
}

function buildWelcomeForSocio(
    meta: CourseMeta | null,
    language: SupportedLanguage,
    participantName: string | null | undefined,
): string {
    if (meta) {
        return buildWelcomeMessage(meta, language, participantName);
    }

    // No course meta - use a minimal platform welcome
    const platformWelcome: Record<SupportedLanguage, (name?: string | null) => string> = {
        es: (name) => name
            ? `¡Hola, ${name}! 👋 Bienvenido. Escribe "comenzar" cuando estés listo para empezar.`
            : '¡Hola! 👋 Bienvenido. Escribe "comenzar" cuando estés listo para empezar.',
        en: (name) => name
            ? `Hi, ${name}! 👋 Welcome. Type "start" when you're ready to begin.`
            : 'Hi! 👋 Welcome. Type "start" when you\'re ready to begin.',
        pt: (name) => name
            ? `Olá, ${name}! 👋 Bem-vindo. Digite "começar" quando estiver pronto para iniciar.`
            : 'Olá! 👋 Bem-vindo. Digite "começar" quando estiver pronto para iniciar.',
    };

    return platformWelcome[language](participantName);
}

// ── Helper: Complete onboarding ──────────────────────────────────────────────

async function completeOnboarding(
    socio: Socio,
    meta: CourseMeta | null,
    channel: DeliveryChannel,
) {
    const overrides = (socio.promptOverrides || {}) as Record<string, unknown>;
    const cleanOverrides = { ...overrides };
    delete cleanOverrides.onboardingStep;

    await repo.updateSocio(socio.id, {
        status: 'ACTIVE',
        promptOverrides: Object.keys(cleanOverrides).length > 0 ? cleanOverrides : null,
    });
    await repo.initProgress(socio.id);
    await sendWelcome(socio, meta, lang(socio), socio.name, channel);
}
