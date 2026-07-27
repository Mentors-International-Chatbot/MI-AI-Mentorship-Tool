import { NextRequest, NextResponse } from 'next/server';
import { handleIncomingMessage } from '@/lib/messaging/handler';
import { WebChannel } from '@/lib/delivery';
import { verifySession } from '@/lib/auth/session';
import { DEFAULT_LANGUAGE, type SupportedLanguage } from '@/lib/i18n/languages';
import { toClientMessage } from './toClientMessage';

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30; // max messages per window
const RATE_WINDOW_MS = 60 * 1000; // 1 minute

// Deduplication cache: prevent duplicate requests within 10 seconds
const requestCache = new Map<string, { response: any; timestamp: number }>();
const DEDUP_WINDOW_MS = 10 * 1000; // 10 seconds

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

function getCachedResponse(userId: string, message: string): any | null {
    const now = Date.now();
    const key = `${userId}:${message}`;
    const cached = requestCache.get(key);

    if (cached && now - cached.timestamp < DEDUP_WINDOW_MS) {
        return cached.response;
    }

    // Cleanup expired entries
    if (cached) {
        requestCache.delete(key);
    }

    return null;
}

function cacheResponse(userId: string, message: string, response: any): void {
    const key = `${userId}:${message}`;
    requestCache.set(key, { response, timestamp: Date.now() });

    // Auto-cleanup after window expires
    setTimeout(() => requestCache.delete(key), DEDUP_WINDOW_MS);
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

        let body: { message?: string; language?: string };
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { error: 'Invalid JSON body' },
                { status: 400 },
            );
        }

        const { message } = body;
        language = (body.language || DEFAULT_LANGUAGE) as SupportedLanguage;

        if (!message) {
            return NextResponse.json(
                { error: 'Missing required field: message' },
                { status: 400 },
            );
        }

        // Check for duplicate request (prevents double-click spam)
        const cachedResponse = getCachedResponse(session.userId, message);
        if (cachedResponse) {
            console.log(`[Chat] Returning cached response for duplicate request from ${session.userId}`);
            return NextResponse.json(cachedResponse);
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

        // Convert handler messages to client format (with id, metadata)
        const clientMessages = (result.messages ?? [])
            .map(toClientMessage)
            .filter((m): m is NonNullable<typeof m> => m !== null);

        const responseData = {
            response,
            mode: result.mode,
            markers: result.markers,
            socioId: result.socioId,
            isNewSocio: result.isNewSocio,
            isError: result.isError ?? false,
            messages: clientMessages,
        };

        // Cache response to prevent duplicate processing
        cacheResponse(session.userId, message, responseData);

        return NextResponse.json(responseData);
    } catch (error) {
        console.error('Chat API Error:', error);
        return NextResponse.json(
            { error: FRIENDLY_ERROR[language] ?? FRIENDLY_ERROR['es'] },
            { status: 500 },
        );
    }
}
