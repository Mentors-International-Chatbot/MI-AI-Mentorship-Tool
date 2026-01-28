import { repo } from '@/lib/repo';
import { Socio } from '@/lib/repo/types';
import { sendWhatsAppMessage } from '@/lib/whatsapp/client';

// const prisma = new PrismaClient();

// MVP Logic: Hardcoded toggle for now, can be database-driven later
const REQUIRE_LEGAL_CONSENT = false;

export async function handleOnboarding(socio: Socio, incomingMessage: string) {
    const message = incomingMessage.trim();

    switch (socio.status) {
        case 'NEW':
            if (REQUIRE_LEGAL_CONSENT) {
                await repo.updateSocio(socio.id, { status: 'AWAITING_CONSENT' });
                await sendWhatsAppMessage(
                    socio.whatsappPhoneNumber,
                    "Hola, soy tu mentor virtual de Mentors International. Para continuar, por favor lee y acepta nuestros términos de uso. Responde 'ACEPTO' para iniciar."
                );
            } else {
                // Skip consent, go straight to Name
                await repo.updateSocio(socio.id, { status: 'AWAITING_NAME' });
                await sendWhatsAppMessage(
                    socio.whatsappPhoneNumber,
                    "¡Hola! Soy tu mentor virtual de Mentors International 🤖. Estoy aquí para ayudarte a crecer tu negocio. Para empezar, ¿cómo te llamas?"
                );
            }
            break;

        case 'AWAITING_CONSENT':
            if (message.toUpperCase() === 'ACEPTO') {
                await repo.updateSocio(socio.id, { status: 'AWAITING_NAME' });
                await sendWhatsAppMessage(
                    socio.whatsappPhoneNumber,
                    "¡Gracias! Para empezar, ¿cómo te llamas?"
                );
            } else {
                await sendWhatsAppMessage(
                    socio.whatsappPhoneNumber,
                    "Por favor responde 'ACEPTO' para confirmar que estás de acuerdo con los términos."
                );
            }
            break;

        case 'AWAITING_NAME':
            // MVP: Accept whatever they type as the name
            await repo.updateSocio(socio.id, {
                name: message,
                status: 'ACTIVE'
            });
            await sendWhatsAppMessage(
                socio.whatsappPhoneNumber,
                `¡Mucho gusto, ${message}! 👋\n\nPara darte los mejores consejos, cuéntame: ¿Qué tipo de negocio tienes? (Ej: Panadería, Tienda de ropa, Servicios...)`
            );
            break;

        case 'ACTIVE':
            // This function shouldn't strictly be called if Active, unless re-routing.
            // In the main webhook, we'd pass to the AI handler.
            break;
    }
}
