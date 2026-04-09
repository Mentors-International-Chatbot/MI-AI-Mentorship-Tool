import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { handleIncomingMessage } from '@/lib/messaging/handler';
import { WhatsAppChannel } from '@/lib/delivery';
import { logEvent } from '@/lib/logging/logger';

function verifyMetaSignature(rawBody: string, signature: string | null): boolean {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
        console.warn('[Webhook] META_APP_SECRET not set — skipping signature verification');
        return true; // Allow in dev; set META_APP_SECRET in production
    }
    if (!signature) return false;
    const expectedSig =
        'sha256=' +
        crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
    if (signature.length !== expectedSig.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
}

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
        const rawBody = await req.text();
        const signature = req.headers.get('x-hub-signature-256');

        if (!verifyMetaSignature(rawBody, signature)) {
            return new NextResponse('Invalid signature', { status: 403 });
        }

        const whatsappChannel = new WhatsAppChannel();

        const body = JSON.parse(rawBody) as {
            object?: string;
            entry?: {
                changes?: {
                    value?: { messages?: Array<{ from?: string; text?: { body?: string }; type?: string }> };
                }[];
            }[];
        };

        if (body.object === 'whatsapp_business_account' && body.entry) {
            for (const entry of body.entry) {
                for (const change of entry.changes ?? []) {
                    const messages = change.value?.messages;
                    if (messages?.length) {
                        const message = messages[0];
                        const senderPhone = message.from;
                        const textBody = message.text?.body;
                        const messageType =
                            typeof message.type === 'string' ? message.type : 'unknown';

                        if (!senderPhone) continue;

                        if (!textBody) {
                            if (messageType !== 'text') {
                                void whatsappChannel.sendMessage(
                                    senderPhone,
                                    'Hola! Por ahora solo puedo leer mensajes de texto. ¿Podrías escribirme tu pregunta? 😊',
                                );
                            }
                            continue;
                        }

                        void logEvent('info', 'webhook', 'Incoming WhatsApp message', {
                            from: senderPhone,
                            messageType,
                        });

                        // Fire-and-forget so Meta gets 200 OK immediately
                        void handleIncomingMessage({
                            externalId: senderPhone,
                            channelType: 'whatsapp',
                            message: textBody,
                            channel: whatsappChannel,
                        }).catch(err =>
                            console.error('[Webhook] handleIncomingMessage failed:', err)
                        );
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
