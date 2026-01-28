import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { handleOnboarding } from '@/lib/onboarding/service';
import { sendWhatsAppMessage } from '@/lib/whatsapp/client';

const prisma = new PrismaClient();

// Verify Webhook (GET)
export async function GET(req: NextRequest) {
    const mode = req.nextUrl.searchParams.get('hub.mode');
    const token = req.nextUrl.searchParams.get('hub.verify_token');
    const challenge = req.nextUrl.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
        return new NextResponse(challenge, { status: 200 });
    }
    return new NextResponse('Forbidden', { status: 403 });
}

// Handle Events (POST)
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        // Check if it's a WhatsApp message event
        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry) {
                for (const change of entry.changes) {
                    if (change.value.messages) {
                        const message = change.value.messages[0];
                        const senderPhone = message.from; // e.g. "15550001234"
                        const textBody = message.text?.body;

                        if (!textBody) continue; // Skip non-text messages for MVP

                        // 1. Lookup Socio
                        let socio = await prisma.socio.findUnique({
                            where: { whatsappPhoneNumber: senderPhone },
                        });

                        // 2. New Socio? Create them.
                        if (!socio) {
                            socio = await prisma.socio.create({
                                data: {
                                    whatsappPhoneNumber: senderPhone,
                                    status: 'NEW',
                                },
                            });
                            // Immediate onboarding trigger
                            await handleOnboarding(socio, textBody);
                            continue;
                        }

                        // 3. Existing Socio: Route based on status
                        if (socio.status !== 'ACTIVE') {
                            await handleOnboarding(socio, textBody);
                        } else {
                            // TODO: AI Conversation Logic (LangChain) goes here
                            await sendWhatsAppMessage(senderPhone, "Bot is Active! (AI integration pending)");
                        }
                    }
                }
            }
        }

        return new NextResponse('EVENT_RECEIVED', { status: 200 });
    } catch (error) {
        console.error('Webhook Error:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
