import { NextRequest, NextResponse } from 'next/server';
import { handleIncomingMessage } from '@/lib/messaging/handler';
import { WebChannel } from '@/lib/delivery';

export async function POST(req: NextRequest) {
    try {
        const { message, sessionId } = await req.json();

        if (!message || !sessionId) {
            return NextResponse.json(
                { error: 'Missing required fields: message, sessionId' },
                { status: 400 },
            );
        }

        const result = await handleIncomingMessage({
            externalId: sessionId,
            channelType: 'web',
            message,
            channel: new WebChannel(),
        });

        return NextResponse.json({
            response: result.responseText,
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
