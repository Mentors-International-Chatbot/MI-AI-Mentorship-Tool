import { NextRequest, NextResponse } from 'next/server';
import { handleIncomingMessage } from '@/lib/messaging/handler';
import { WebChannel } from '@/lib/delivery';
import { verifySession } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
    try {
        const session = await verifySession();
        if (!session) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const { message, language } = await req.json();

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
            language: language || 'es',
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
            { error: 'Internal Server Error' },
            { status: 500 },
        );
    }
}
