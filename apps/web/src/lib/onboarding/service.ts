import { repo } from '@/lib/repo';
import { Socio } from '@/lib/repo/types';
import type { DeliveryChannel } from '@/lib/delivery/types';
import {
    ONBOARDING,
    parseLanguageChoice,
    DEFAULT_LANGUAGE,
    type SupportedLanguage,
} from '@/lib/i18n/languages';
import { extractName } from './extractName';

const REQUIRE_LEGAL_CONSENT = false;

function lang(socio: Socio): SupportedLanguage {
    return (socio.language || DEFAULT_LANGUAGE) as SupportedLanguage;
}

export async function handleOnboarding(socio: Socio, incomingMessage: string, channel: DeliveryChannel) {
    const message = incomingMessage.trim();

    switch (socio.status) {
        case 'NEW': {
            await repo.updateSocio(socio.id, { status: 'AWAITING_LANGUAGE' });
            await channel.sendMessage(
                socio.externalId,
                ONBOARDING[DEFAULT_LANGUAGE].languagePicker,
            );
            break;
        }

        case 'AWAITING_LANGUAGE': {
            const chosen = parseLanguageChoice(message);
            if (!chosen) {
                await channel.sendMessage(
                    socio.externalId,
                    ONBOARDING[DEFAULT_LANGUAGE].languagePicker,
                );
                break;
            }

            await repo.updateSocio(socio.id, { language: chosen });
            const strings = ONBOARDING[chosen];

            if (REQUIRE_LEGAL_CONSENT) {
                await repo.updateSocio(socio.id, { status: 'AWAITING_CONSENT' });
                await channel.sendMessage(socio.externalId, strings.languageConfirmed + '\n\n' + strings.consentPrompt);
            } else {
                await repo.updateSocio(socio.id, { status: 'AWAITING_NAME' });
                await channel.sendMessage(socio.externalId, strings.languageConfirmed + '\n\n' + strings.namePrompt);
            }
            break;
        }

        case 'AWAITING_CONSENT': {
            const strings = ONBOARDING[lang(socio)];
            if (message.toUpperCase() === strings.consentAcceptKeyword) {
                await repo.updateSocio(socio.id, { status: 'AWAITING_NAME' });
                await channel.sendMessage(socio.externalId, strings.namePrompt);
            } else {
                await channel.sendMessage(socio.externalId, strings.consentRetry);
            }
            break;
        }

        case 'AWAITING_NAME': {
            const strings = ONBOARDING[lang(socio)];
            const name = await extractName(message, lang(socio));

            if (!name) {
                await channel.sendMessage(socio.externalId, strings.nameRetry);
                break;
            }

            await repo.updateSocio(socio.id, {
                name,
                status: 'ACTIVE',
            });
            await repo.initProgress(socio.id);
            await channel.sendMessage(socio.externalId, strings.welcome(name));
            break;
        }

        case 'ACTIVE':
            break;
    }
}
