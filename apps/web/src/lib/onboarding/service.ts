import { repo } from '@/lib/repo';
import { Socio } from '@/lib/repo/types';
import type { DeliveryChannel } from '@/lib/delivery/types';

// MVP Logic: Hardcoded toggle for now, can be database-driven later
const REQUIRE_LEGAL_CONSENT = false;

export async function handleOnboarding(socio: Socio, incomingMessage: string, channel: DeliveryChannel) {
    const message = incomingMessage.trim();

    switch (socio.status) {
        case 'NEW':
            if (REQUIRE_LEGAL_CONSENT) {
                await repo.updateSocio(socio.id, { status: 'AWAITING_CONSENT' });
                await channel.sendMessage(
                    socio.externalId,
                    "Hola, soy tu mentor virtual de Mentors International. Para continuar, por favor lee y acepta nuestros términos de uso. Responde 'ACEPTO' para iniciar."
                );
            } else {
                await repo.updateSocio(socio.id, { status: 'AWAITING_NAME' });
                await channel.sendMessage(
                    socio.externalId,
                    "¡Hola! Soy tu mentor virtual de Mentors International 🤖. Estoy aquí para ayudarte a crecer tu negocio. Para empezar, ¿cómo te llamas?"
                );
            }
            break;

        case 'AWAITING_CONSENT':
            if (message.toUpperCase() === 'ACEPTO') {
                await repo.updateSocio(socio.id, { status: 'AWAITING_NAME' });
                await channel.sendMessage(
                    socio.externalId,
                    "¡Gracias! Para empezar, ¿cómo te llamas?"
                );
            } else {
                await channel.sendMessage(
                    socio.externalId,
                    "Por favor responde 'ACEPTO' para confirmar que estás de acuerdo con los términos."
                );
            }
            break;

        case 'AWAITING_NAME':
            await repo.updateSocio(socio.id, {
                name: message,
                status: 'ACTIVE'
            });
            await repo.initProgress(socio.id);
            await channel.sendMessage(
                socio.externalId,
                `¡Mucho gusto, ${message}! 👋\n\nPara darte los mejores consejos, cuéntame: ¿Qué tipo de negocio tienes? (Ej: Panadería, Tienda de ropa, Servicios...)`
            );
            break;

        case 'ACTIVE':
            break;
    }
}
