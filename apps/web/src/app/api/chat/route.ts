import { NextRequest, NextResponse } from 'next/server';
import { handleIncomingMessage } from '@/lib/messaging/handler';
import { WebChannel } from '@/lib/delivery';
import { verifySession } from '@/lib/auth/session';
import { type SupportedLanguage } from '@/lib/i18n/languages';

const FRIENDLY_ERROR: Record<SupportedLanguage, string> = {
    es: 'Lo siento, estamos teniendo problemas en este momento. Por favor intenta de nuevo en un momento.',
    en: "I'm sorry, we're having some issues right now. Please try again in a moment.",
    pt: 'Desculpe, estamos com alguns problemas no momento. Por favor tente novamente em um instante.',
};

export async function POST(req: NextRequest) {
    let language: SupportedLanguage = 'es';
    try {
        const session = await verifySession();
        if (!session) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const body = await req.json();
        const { message } = body;
        language = (body.language || 'es') as SupportedLanguage;

        if (!message) {
            return NextResponse.json(
                { error: 'Missing required field: message' },
                { status: 400 },
            );
        }

        const webChannel = new WebChannel();

        const result = await handleIncomingMessage({
            externalId: session.userId,
            channelType: 'web',
            message,
            channel: webChannel,
            language,
            userName: session.role === 'socio' ? session.name : undefined,
        });

        const response = result.responseText
            || webChannel.getMessages().join('\n');

        return NextResponse.json({
            response,
            mode: result.mode,
            markers: result.markers,
            socioId: result.socioId,
            isNewSocio: result.isNewSocio,
            isError: result.isError ?? false,
        });
    } catch (error) {
        console.error('Chat API Error:', error);
        return NextResponse.json(
            { error: FRIENDLY_ERROR[language] ?? FRIENDLY_ERROR['es'] },
            { status: 500 },
        );
    }
}
