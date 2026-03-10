import { NextRequest, NextResponse } from 'next/server';
import { handleIncomingMessage } from '@/lib/messaging/handler';
import { WebChannel } from '@/lib/delivery';

export async function POST(req: NextRequest) {
    try {
        const { message, sessionId, language } = await req.json();

        if (!message || !sessionId) {
            return NextResponse.json(
                { error: 'Missing required fields: message, sessionId' },
                { status: 400 },
            );
        }

        const webChannel = new WebChannel();

        const result = await handleIncomingMessage({
            externalId: sessionId,
            channelType: 'web',
            message,
            channel: webChannel,
            language,
        });

        const response = result.responseText
            || webChannel.getMessages().join('\n');

        return NextResponse.json({
            response,
            mode: result.mode,
            markers: result.markers,
            socioId: result.socioId,
            isNewSocio: result.isNewSocio,
        });
    } catch (error) {
        console.error('Chat API Error:', error);
        return NextResponse.json(
            { error: 'Internal Server Error' },
            { status: 500 },
        );
    }
}
