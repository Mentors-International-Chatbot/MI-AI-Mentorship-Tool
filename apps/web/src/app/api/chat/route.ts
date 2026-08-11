import { NextRequest, NextResponse } from 'next/server';
import { handleIncomingMessage } from '@/lib/messaging/handler';
import { WebChannel } from '@/lib/delivery';
import { resolveRequestIdentity } from '@/lib/auth/requestIdentity';
import { PlayerError, preparePlayerContext, resolvePlayerAccess, type PlayerIntent, type PlayerParentIntent, type ValidatedPlayerContext } from '@/lib/player/service';
import { DEFAULT_LANGUAGE, type SupportedLanguage } from '@/lib/i18n/languages';
import { toClientMessage } from './toClientMessage';

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30; // max messages per window
const RATE_WINDOW_MS = 60 * 1000; // 1 minute

/** What both paths return: the JSON body, or the contents of the `done` frame. */
type ChatResponseData = ReturnType<typeof buildResponseData>;

// Deduplication cache: prevent duplicate requests within 10 seconds
const requestCache = new Map<string, { response: ChatResponseData; timestamp: number }>();
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

function getCachedResponse(userId: string, message: string): ChatResponseData | null {
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

function cacheResponse(userId: string, message: string, response: ChatResponseData): void {
    const key = `${userId}:${message}`;
    requestCache.set(key, { response, timestamp: Date.now() });

    // Auto-cleanup after window expires
    setTimeout(() => requestCache.delete(key), DEDUP_WINDOW_MS);
}

/**
 * The payload both paths return. On the streaming path it rides inside the
 * terminal `done` line rather than being the whole body, so the two agree
 * field for field and the client renders one shape either way.
 */
function buildResponseData(
    result: Awaited<ReturnType<typeof handleIncomingMessage>>,
    webChannel: WebChannel,
) {
    const response = result.responseText || webChannel.getMessages().join('\n');

    // Convert handler messages to client format (with id, metadata)
    const clientMessages = (result.messages ?? [])
        .map(toClientMessage)
        .filter((m): m is NonNullable<typeof m> => m !== null);

    return {
        response,
        mode: result.mode,
        markers: result.markers,
        socioId: result.socioId,
        isNewSocio: result.isNewSocio,
        isError: result.isError ?? false,
        messages: clientMessages,
    };
}

const FRIENDLY_ERROR: Record<SupportedLanguage, string> = {
    es: 'Lo siento, estamos teniendo problemas en este momento. Por favor intenta de nuevo en un momento.',
    en: "I'm sorry, we're having some issues right now. Please try again in a moment.",
    pt: 'Desculpe, estamos com alguns problemas no momento. Por favor tente novamente em um instante.',
};

/**
 * The streaming reply, as NDJSON.
 *
 * Wire format is two line kinds and nothing else:
 *
 *   {"t":"…"}        a sanitized delta, straight from the streaming sanitizer
 *   {"done": {…}}    the terminal frame, carrying the exact payload the
 *                    non-streaming path returns as its whole body
 *
 * The `t` lines are a PREFIX of `done.response`, never equal to it: the handler
 * appends the escalation confirmation and the feedback prompt after generation
 * ends. So the client replaces its provisional bubble from `done`; it must not
 * append `done` onto what it streamed.
 *
 * The dedup cache is bypassed entirely here. It stores a finished payload keyed
 * on user+message, and a stream is not a value you can hand to a second caller.
 * Double-click protection on the streaming path is the client's job.
 */
function streamResponse(params: {
    externalId: string;
    channelType: 'web' | 'canvas';
    message: string;
    language: SupportedLanguage;
    userName?: string;
    playerContext?: ValidatedPlayerContext;
}): Response {
    const { externalId, channelType, message, language, userName, playerContext } = params;
    const encoder = new TextEncoder();

    // Set by cancel(), and by a failed enqueue. Writing to a controller whose
    // consumer has gone raises, and while service.ts treats onToken as
    // best-effort, throwing once per token for the rest of a long reply is
    // waste worth skipping. Lives out here so cancel() can reach it.
    let consumerGone = false;

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const write = (frame: unknown): void => {
                if (consumerGone) return;
                try {
                    controller.enqueue(encoder.encode(JSON.stringify(frame) + '\n'));
                } catch {
                    consumerGone = true;
                }
            };

            const webChannel = new WebChannel();

            try {
                // Nothing here consults `consumerGone`. A learner who closes the
                // tab mid-reply still gets the turn generated, persisted and
                // progressed — see the requirement at the generateAIResponse
                // call site in handler.ts. The stream is a tap, not the driver.
                const result = await handleIncomingMessage({
                    externalId,
                    channelType,
                    message,
                    channel: webChannel,
                    language,
                    userName,
                    playerContext,
                    onToken: (delta) => write({ t: delta }),
                });

                write({ done: buildResponseData(result, webChannel) });
            } catch (error) {
                // The status line left minutes ago, so there is no 500 to send.
                // Closing without a `done` is the signal: the client refetches
                // history, which is authoritative and by now already holds
                // whatever the handler managed to persist.
                console.error('Chat API streaming error:', error);
            } finally {
                try {
                    controller.close();
                } catch {
                    /* already closed by cancel() */
                }
            }
        },

        cancel() {
            // The consumer went away. Generation is deliberately NOT aborted:
            // the learner's turn is finished and persisted either way.
            consumerGone = true;
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            // Proxies that buffer would defeat the whole exercise.
            'X-Accel-Buffering': 'no',
        },
    });
}

export async function POST(req: NextRequest) {
    let language: SupportedLanguage = 'es';
    try {
        const identity = await resolveRequestIdentity(req);
        if (!identity) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        if (isRateLimited(identity.userId)) {
            return NextResponse.json(
                { error: 'Demasiados mensajes. Por favor espera un momento.' },
                { status: 429 },
            );
        }

        let body: {
            message?: string; language?: string; stream?: boolean;
            context?: { surface?: string; courseCode?: string; lessonKey?: string; blockId?: string; intent?: string; parentIntent?: string };
        };
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { error: 'Invalid JSON body' },
                { status: 400 },
            );
        }

        let { message } = body;
        language = (body.language || DEFAULT_LANGUAGE) as SupportedLanguage;

        let playerContext: ValidatedPlayerContext | undefined;
        if (body.context) {
            const candidate = body.context;
            const intents: PlayerIntent[] = ['question', 'teach_back', 'lesson_entry', 'capstone', 'expand'];
            const parentIntents: PlayerParentIntent[] = ['question', 'teach_back', 'lesson_entry', 'capstone'];
            if (candidate.surface !== 'player' || candidate.courseCode !== 'AIESS' || typeof candidate.lessonKey !== 'string' || !intents.includes(candidate.intent as PlayerIntent)) {
                return NextResponse.json({ error: 'Invalid player context' }, { status: 400 });
            }
            if (candidate.intent === 'expand' && !parentIntents.includes(candidate.parentIntent as PlayerParentIntent)) {
                return NextResponse.json({ error: 'Invalid expansion context' }, { status: 400 });
            }
            const access = await resolvePlayerAccess(identity, candidate.courseCode);
            playerContext = await preparePlayerContext(access, {
                lessonKey: candidate.lessonKey,
                blockId: typeof candidate.blockId === 'string' ? candidate.blockId : undefined,
                intent: candidate.intent as PlayerIntent,
                parentIntent: candidate.intent === 'expand' ? candidate.parentIntent as PlayerParentIntent : undefined,
            }, identity.ltiContextId);
            if (!message && playerContext.intent === 'lesson_entry') message = 'Introduce this lesson.';
            if (!message && playerContext.intent === 'expand') message = 'Explain more.';
        }

        if (!message) {
            return NextResponse.json(
                { error: 'Missing required field: message' },
                { status: 400 },
            );
        }

        const wantsStream = body.stream === true;

        // Every rejection above this line — 401, 429, 400 — has already been
        // answered as ordinary JSON with a real status code. Nothing below can
        // change a status, because the headers go out the moment the stream
        // opens, so the checks stay where they are.
        if (wantsStream) {
            return streamResponse({
                externalId: identity.externalId,
                channelType: identity.channel,
                message,
                language,
                userName: identity.role === 'socio' ? identity.name : undefined,
                playerContext,
            });
        }

        // Check for duplicate request (prevents double-click spam)
        const requestIdentity = `${playerContext?.programVersionId ?? ''}:${playerContext?.lessonKey ?? ''}:${playerContext?.blockId ?? ''}:${playerContext?.intent ?? ''}:${playerContext?.parentIntent ?? ''}:${message}`;
        const cachedResponse = getCachedResponse(identity.userId, requestIdentity);
        if (cachedResponse) {
            console.log(`[Chat] Returning cached response for duplicate request from ${identity.userId}`);
            return NextResponse.json(cachedResponse);
        }

        const webChannel = new WebChannel();

        const result = await handleIncomingMessage({
            externalId: identity.externalId,
            channelType: identity.channel,
            message,
            channel: webChannel,
            language,
            userName: identity.role === 'socio' ? identity.name : undefined,
            playerContext,
        });

        const responseData = buildResponseData(result, webChannel);

        // Cache response to prevent duplicate processing
        cacheResponse(identity.userId, requestIdentity, responseData);

        return NextResponse.json(responseData);
    } catch (error) {
        if (error instanceof PlayerError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }
        console.error('Chat API Error:', error);
        return NextResponse.json(
            { error: FRIENDLY_ERROR[language] ?? FRIENDLY_ERROR['es'] },
            { status: 500 },
        );
    }
}
