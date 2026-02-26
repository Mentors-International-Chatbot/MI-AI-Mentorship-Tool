import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { handleOnboarding } from '@/lib/onboarding/service';
import { sendWhatsAppMessage } from '@/lib/whatsapp/client';
import { generateAIResponse } from '@/lib/ai/service';
import { InteractionMode, parseScore } from '@/lib/ai/prompts';

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

        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry) {
                for (const change of entry.changes) {
                    if (change.value.messages) {
                        const message = change.value.messages[0];
                        const senderPhone = message.from;
                        const textBody = message.text?.body;

                        if (!textBody) continue;

                        let socio = await repo.getSocio(senderPhone);

                        if (!socio) {
                            socio = await repo.createSocio(senderPhone);
                            await handleOnboarding(socio, textBody);
                            continue;
                        }

                        if (socio.status !== 'ACTIVE') {
                            await handleOnboarding(socio, textBody);
                        } else {
                            await repo.addMessage({
                                socioId: socio.id,
                                role: 'user',
                                content: textBody,
                            });

                            // Track that the socio is active
                            await repo.touchInteraction(socio.id);

                            const aiResponse = await generateAIResponse(socio, textBody);

                            await repo.addMessage({
                                socioId: socio.id,
                                role: 'assistant',
                                content: aiResponse.text,
                            });

                            // ── Process markers ──
                            if (aiResponse.markers.flags.length > 0) {
                                console.log(`[Flags] socio=${socio.id}`, aiResponse.markers.flags);
                            }
                            if (aiResponse.markers.escalations.length > 0) {
                                console.log(`[Escalation] socio=${socio.id}`, aiResponse.markers.escalations);
                            }

                            // ── Handle lesson completion ──
                            for (const lessonNum of aiResponse.markers.lessonsCompleted) {
                                const score = parseScore(textBody);
                                await repo.completeLesson(socio.id, lessonNum, {
                                    understanding: score ?? undefined,
                                });
                                console.log(`[LessonComplete] socio=${socio.id} lesson=${lessonNum} score=${score}`);
                            }

                            // ── Advance message index for lesson modes ──
                            const isLessonMode =
                                aiResponse.mode === InteractionMode.LESSON_DELIVERY ||
                                aiResponse.mode === InteractionMode.LESSON_START;

                            if (aiResponse.markers.lessonsCompleted.length === 0 && isLessonMode) {
                                await repo.advanceMessage(socio.id);
                            }

                            // Reset reminder counter when socio re-engages in a lesson
                            if (isLessonMode || aiResponse.mode === InteractionMode.REMINDER) {
                                await repo.resetReminders(socio.id);
                            }

                            await sendWhatsAppMessage(senderPhone, aiResponse.text);
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
