import { NextRequest, NextResponse } from 'next/server';
import { handleIncomingMessage } from '@/lib/messaging/handler';
import { WebChannel } from '@/lib/delivery';
import { verifySession } from '@/lib/auth/session';
import { type SupportedLanguage } from '@/lib/i18n/languages';

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30; // max messages per window
const RATE_WINDOW_MS = 60 * 1000; // 1 minute

function isRateLimited(userId: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(userId);
    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
        return false;
    }
    entry.count++;
    return entry.count > RATE_LIMIT;
}

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

        if (isRateLimited(session.userId)) {
            return NextResponse.json(
                { error: 'Demasiados mensajes. Por favor espera un momento.' },
                { status: 429 },
            );
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
