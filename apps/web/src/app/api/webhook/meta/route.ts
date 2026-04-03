import { NextRequest, NextResponse } from 'next/server';
import { handleIncomingMessage } from '@/lib/messaging/handler';
import { WhatsAppChannel } from '@/lib/delivery';
import { logEvent } from '@/lib/logging/logger';

// Verify Webhook (GET)
export async function GET(req: NextRequest) {
    const mode = req.nextUrl.searchParams.get('hub.mode');
    const token = req.nextUrl.searchParams.get('hub.verify_token');
    const challenge = req.nextUrl.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
        // return new NextResponse(challenge, { status: 200 });
        return new Response(challenge, {
            status: 200,
            headers: {
                'Content-Type': 'text/plain',
            },
        });

    }
    // return new NextResponse('Forbidden', { status: 403 });
    return new Response('Forbidden', { status: 403 });

}

// Handle Events (POST)
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry) {
                for (const change of entry.changes) {
                    if (change.value.messages) {
                        const message = change.value.messages[0];
                        const senderPhone = message.from;
                        const textBody = message.text?.body;
                        const messageType =
                            typeof message.type === 'string' ? message.type : 'unknown';

                        if (!textBody) continue;

                        void logEvent('info', 'webhook', 'Incoming WhatsApp message', {
                            from: senderPhone,
                            messageType,
                        });

                        await handleIncomingMessage({
                            externalId: senderPhone,
                            channelType: 'whatsapp',
                            message: textBody,
                            channel: new WhatsAppChannel(),
                        });
                    }
                }
            }
        }

        return new NextResponse('EVENT_RECEIVED', { status: 200 });
    } catch (error) {
        console.error('Webhook Error:', error);
        void logEvent('error', 'webhook', 'Webhook processing failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
