import { HumanMessage, SystemMessage, AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { repo } from '@/lib/repo';
import { Socio, Message, SocioProgress as RepoSocioProgress } from '@/lib/repo/types';
import {
    buildSystemPrompt,
    determineMode,
    parseMarkers,
    InteractionMode,
    type ParsedMarkers,
    type DetermineModeResult,
    type StanceDecision,
} from './prompts';
import { sanitizeForDelivery } from '@/lib/ai/sanitizer';
import { createStreamingSanitizer } from '@/lib/ai/streamingSanitizer';
import { DEFAULT_LANGUAGE, AI_ERROR_FALLBACK, type SupportedLanguage } from '@/lib/i18n/languages';
import { logEvent } from '@/lib/logging/logger';
import {
    senseAndScore,
    updateDimensionState,
    getDimensionStateMap,
    type DimensionStateMap,
    type SensedDimension,
} from './sensing';

import { getLessonData, hasLessonData } from '@/lib/lessons/db-lesson-service';
import { resolveAnalysisPolicy, type AnalysisPolicy } from '@/lib/ai/analysisPolicy';
import type { SentimentResult } from '@/lib/sentiment/analyzer';
import { createOpenRouterChat, resolveOpenRouterModel } from '@/lib/ai/openrouter';
import { invokeTraced } from '@/lib/ai/trace/invokeTraced';
import { CORE_PROMPT_VERSION } from './prompts/layers/core';
import { CONTEXT_PROMPT_VERSION } from './prompts/layers/context';
import { TASK_PROMPT_VERSION } from './prompts/layers/task';
import { getContentIdentity } from './prompts/layers/content';
import type { PromptVersionSink } from './prompts/loadPrompt';
import { playerTutorGrounding, type ValidatedPlayerContext } from '@/lib/player/service';
import { playerRuntimeRepo } from '@/lib/repo/playerRuntimeRepo';
import { programVersionConfigSchema } from '@/lib/journey-package/program-version-config.schema';
import type { ResponseStyle } from '@/lib/journey-package/journey-package.schema';
import {
    buildResponseStyleInstruction,
    buildResponseStyleRepairInstruction,
    responseStyleViolations,
    resolvePlayerMaxTokens,
} from '@/lib/player/responseStyle';
import { assembleOrderedModelMessages } from '@/lib/ai/modelMessages';


/**
 * Ceiling on one LLM attempt in the interactive path.
 *
 * Was 30s. A learner staring at a blank chat for half a minute is worse served
 * than one who gets the honest fallback at 12s and can retry — and a turn that
 * has not produced a first token in 12s is not about to produce a good one.
 * Batch work (summaries, crons) does not come through here.
 *
 * ── The threshold and the metric are not the same thing ───────────────────
 * The reasoning above is stated in time-to-FIRST-token terms, but this budget
 * has always been enforced against time-to-LAST-token — it is raced against
 * the whole generation, on the streaming path exactly as on the non-streaming
 * one. That was an identity while a reply arrived all at once. It no longer is:
 * `ttftMs` now measures the quantity the argument is actually about, and a slow
 * stream can hand back its first token in 400ms and still be killed at 12s.
 * If TTFT ever becomes a user-facing SLO, this constant is what has to be
 * revisited, and it likely splits into two budgets rather than moving.
 */
const AI_TIMEOUT_MS = 12000;

async function invokeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        ),
    ]);
}

/**
 * The narrowing `invokeWithRetry` has always applied to a message's `.content`,
 * which is `string | ContentBlock[]`. Extracted verbatim so the streaming path
 * applies the same rule per chunk and to the accumulated message instead of
 * inventing a second one.
 */
export function contentToText(content: unknown): string {
    return typeof content === 'string' ? content : JSON.stringify(content);
}

/**
 * One retry, not two. With a 12s per-attempt ceiling and a 1s backoff, the old
 * `maxRetries = 2` meant a worst case the learner experienced as a hang. One
 * retry still absorbs the transient 5xx that motivated retrying at all.
 */
async function invokeWithRetry(
    chat: { invoke: (messages: (SystemMessage | HumanMessage | AIMessage)[]) => Promise<{ content: unknown; response_metadata?: unknown }> },
    messages: (SystemMessage | HumanMessage | AIMessage)[],
    maxRetries: number = 1,
): Promise<{ content: unknown; response_metadata?: unknown }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await invokeWithTimeout(
                chat.invoke(messages),
                AI_TIMEOUT_MS,
                `AI request timeout after ${AI_TIMEOUT_MS}ms`
            );
            return response;
        } catch (error) {
            lastError = error as Error;
            console.error(`[AI] Attempt ${attempt + 1}/${maxRetries + 1} failed:`, error);

            // Don't retry on timeout errors - fail fast
            if (error instanceof Error && error.message.includes('timeout')) {
                throw error;
            }

            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError ?? new Error('AI invoke failed');
}

/**
 * A prompt is a preference; the configured response style is a release
 * contract. Styled player turns therefore get up to four model rewrites when
 * the completed, sanitized draft violates that contract. No text is truncated
 * and the same model/token cap is used for every attempt.
 */
export async function invokeStyledPlayerResponse(
    chat: { invoke: (messages: (SystemMessage | HumanMessage | AIMessage)[]) => Promise<{ content: unknown; response_metadata?: unknown }> },
    messages: (SystemMessage | HumanMessage | AIMessage)[],
    style: ResponseStyle,
    expanded: boolean,
): Promise<{ content: unknown; response_metadata?: unknown }> {
    let currentMessages = messages;
    let response = await invokeWithRetry(chat, currentMessages);

    for (let repair = 0; ; repair++) {
        const raw = contentToText(response.content);
        const delivered = sanitizeForDelivery(parseMarkers(raw).cleanText);
        const violations = responseStyleViolations(delivered, style, expanded);
        if (violations.length === 0) return response;
        // Never deliver an unchecked final rewrite. The old bounded loop made
        // four repairs but returned repair four even when it still violated
        // the contract. Throwing here enters the existing player fallback
        // path; the acceptance runner may retry the logical sample, while a
        // real learner receives the normal recoverable error message.
        if (repair === 4) {
            throw new Error(`Player response style contract failed after 4 repairs: ${violations.join(', ')}`);
        }
        // Repair is copy-editing, not a second teaching turn. Re-sending the
        // full multi-thousand-token course prompt made a tiny format correction
        // as slow and failure-prone as regenerating the lesson. The draft
        // already contains the grounded substance; this minimal context asks
        // only for a faithful rewrite under the same output cap.
        currentMessages = [
            new SystemMessage("You are a precise copy editor. Preserve the draft's meaning and system markers; change only what the stated output contract requires."),
            new HumanMessage(`${buildResponseStyleRepairInstruction(style, expanded, violations, repair >= 2)}\n\nDRAFT TO REWRITE:\n${raw}`),
        ];
        response = await invokeWithRetry(chat, currentMessages);
    }
    return response;
}

/** Structural, like invokeWithRetry's — keeps LangChain's client type out of here. */
type StreamingChat = {
    stream: (
        messages: (SystemMessage | HumanMessage | AIMessage)[],
    ) => Promise<AsyncIterable<AIMessageChunk>>;
};

/**
 * The streaming twin of invokeWithRetry.
 *
 * Returns the ACCUMULATED AIMessageChunk rather than a string, and only once
 * the stream is drained. Two things depend on that: invokeTraced's latencyMs
 * stays time-to-last-token instead of collapsing to time-to-stream-handle, and
 * its usage_metadata / contentLength extraction reads the same shape it reads
 * from a non-streaming reply. Nothing in invokeTraced needed to change.
 *
 * ── Retry, and why it is narrower here ────────────────────────────────────
 * A retry re-runs generation from scratch. On the non-streaming path nobody
 * has seen the first attempt, so that is free. Once a token has been emitted
 * the learner is already reading attempt one, and appending attempt two's
 * different wording onto it corrupts the message in place. So a stream is
 * retried only while nothing has reached the client. That keeps the case the
 * retry existed for — the transient 5xx, which happens at connection time
 * before any token — and drops only the case that would double-send.
 */
export async function streamWithRetry(
    chat: StreamingChat,
    messages: (SystemMessage | HumanMessage | AIMessage)[],
    onToken: (delta: string) => void,
    markFirstToken: () => void,
    maxRetries: number = 1,
): Promise<AIMessageChunk> {
    let lastError: Error | null = null;
    let emittedAnything = false;

    /**
     * Best-effort delivery to the consumer. Generation does not depend on it.
     *
     * The client half of a stream is the least reliable part of the system: a
     * closed tab makes the route's controller throw on write. That must not
     * become a generation failure, because the reply still has to be stored,
     * its markers persisted and progression advanced — a learner who reloads
     * mid-reply gets their turn back from the DB, not from the socket.
     *
     * `emittedAnything` is set even when the consumer threw, because we cannot
     * know whether the bytes landed before it did, and a retry that guesses
     * wrong double-sends.
     */
    const emit = (delta: string) => {
        emittedAnything = true;
        try {
            onToken(delta);
        } catch (error) {
            console.error('[AI] Stream consumer threw; generation continues:', error);
        }
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // Set when this attempt loses the timeout race. Promise.race does not
        // cancel the loser, so without it an abandoned stream would keep
        // pushing tokens at a client that has already been handed the fallback.
        let abandoned = false;

        const consume = async (): Promise<AIMessageChunk> => {
            const sanitizer = createStreamingSanitizer();
            let accumulated: AIMessageChunk | null = null;

            const stream = await chat.stream(messages);
            for await (const chunk of stream) {
                // Breaking calls the iterator's return(), which cancels the
                // underlying request rather than leaving it to run to term.
                if (abandoned) break;

                accumulated = accumulated === null ? chunk : accumulated.concat(chunk);

                const raw = contentToText(chunk.content);
                // The last chunk carries usage and no content; it is not a token.
                if (raw.length === 0) continue;

                markFirstToken();
                const delta = sanitizer.push(raw);
                if (delta && !abandoned) emit(delta);
            }

            if (abandoned) throw lastError ?? new Error('AI stream abandoned');

            const tail = sanitizer.end();
            if (tail) emit(tail);

            if (accumulated === null) throw new Error('AI stream produced no chunks');
            return accumulated;
        };

        try {
            // Same 12s ceiling as the non-streaming path, over the same span:
            // the whole generation, not merely its first token.
            return await invokeWithTimeout(
                consume(),
                AI_TIMEOUT_MS,
                `AI request timeout after ${AI_TIMEOUT_MS}ms`,
            );
        } catch (error) {
            abandoned = true;
            lastError = error as Error;
            console.error(`[AI] Stream attempt ${attempt + 1}/${maxRetries + 1} failed:`, error);

            if (error instanceof Error && error.message.includes('timeout')) {
                throw error;
            }
            // Retrying now would append a second generation to text already on
            // screen. The caller's fallback handles it instead.
            if (emittedAnything) {
                throw error;
            }

            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError ?? new Error('AI stream failed');
}

/**
 * Assembles the promptVersion map recorded on a lesson-delivery trace row.
 *
 * Each layer reports the most specific identity available:
 * - core/task: the active SystemPrompt row's version when the DB overrode the
 *   code default (`db:1.0`), else the code constant. A constant that never
 *   moves when someone edits the prompt in /admin is worse than useless.
 * - content: the lesson identity, because Layer 4 is different text per lesson.
 *   Omitted for modes that inject no content block.
 * - context: a plain constant — that layer is assembled entirely in code.
 * - stance/stanceReason: which posture the router selected and why. Recorded
 *   here rather than in a dedicated column because ST2 excludes schema
 *   migrations, and because stance genuinely is a prompt-assembly input — it
 *   selects which framing text Layer 3 appends, exactly like the other keys.
 *   Without it, comparing stance behaviour across turns means re-deriving the
 *   decision from flags and gate rows that have since moved.
 */
export function buildLessonPromptVersion(params: {
    dbVersions: PromptVersionSink;
    contentIdentity: string | null;
    language: SupportedLanguage;
    stance?: StanceDecision;
}): Record<string, string> {
    const { dbVersions, contentIdentity, language, stance } = params;
    return {
        core: dbVersions.core ?? CORE_PROMPT_VERSION,
        context: CONTEXT_PROMPT_VERSION,
        task: dbVersions.task ?? TASK_PROMPT_VERSION,
        ...(contentIdentity ? { content: contentIdentity } : {}),
        ...(stance ? { stance: stance.stance, stanceReason: stance.reason } : {}),
        // Present only when a course overrode the stance framing in /admin.
        ...(dbVersions.stanceText ? { stanceText: dbVersions.stanceText } : {}),
        language,
    };
}

export interface AIResponse {
    text: string;
    markers: ParsedMarkers;
    mode: InteractionMode;
    determineModeResult: DetermineModeResult;
    dimensionState?: DimensionStateMap;
    /**
     * Which passive analysis this turn earned. Resolved here because it needs
     * the router's mode, and returned because the caller owns the two passes
     * that run after the reply (sentiment, context extraction).
     */
    analysisPolicy: AnalysisPolicy;
    /**
     * Emotion scores for the learner's message, from the merged analysis pass.
     * Present only when the policy asked for it and the model's answer parsed.
     * The caller persists it; no LLM work remains.
     */
    sentiment?: SentimentResult | null;
    /** Raw non-null player observations for enrollment-scoped evidence writes. */
    sensedDimensions?: SensedDimension[];
    isError?: boolean;
    /** Gated assessment info - present when mode is GATED_ASSESSMENT */
    gatedAssessment?: {
        sessionId?: string;
        blockId: string;
        lessonKey: string;
        prompt: string;
    };
}

export async function generateAIResponse(
    socio: Socio,
    incomingText: string,
    /** Curriculum collection key (required) */
    collectionKey: string,
    /** Optional pre-computed dimension state for testing */
    overrideDimensionState?: DimensionStateMap,
    /**
     * Opt into streaming. Absent means the exact non-streaming path as before:
     * one .invoke(), one result, nothing emitted along the way.
     *
     * Deltas are already through the delivery pipeline — the sanitizer releases
     * only text no later token can alter, so what arrives here never needs to
     * be taken back. It is still a PREFIX of the final `text`, not equal to it:
     * the caller appends to the reply after generation ends.
     */
    onToken?: (delta: string) => void,
    playerTurn?: { context: ValidatedPlayerContext; learnerText: string },
): Promise<AIResponse> {
    const startTime = performance.now();
    const timings: Record<string, number> = {};

    // Resolve course behavior before constructing the model so only configured
    // learner-visible player turns receive a token cap. MI, PB&J, sensing,
    // extraction, summaries, and gated assessments keep their existing limits.
    const playerConfig = playerTurn ? await playerRuntimeRepo.programVersion.findFirst({
        where: { id: playerTurn.context.programVersionId, status: { in: ['published', 'archived'] }, collection: { slug: collectionKey } },
        select: { config: true, program: { select: { organizationId: true } } },
    }) : null;
    const parsedPlayerConfig = playerConfig ? programVersionConfigSchema.safeParse(playerConfig.config) : null;
    const responseStyle = parsedPlayerConfig?.success ? parsedPlayerConfig.data.responseStyle : undefined;
    const expanded = playerTurn?.context.intent === 'expand';
    const maxTokens = resolvePlayerMaxTokens(responseStyle, expanded);
    const chat = createOpenRouterChat({ temperature: 0.7, ...(maxTokens ? { maxTokens } : {}) });

    // 0. State the router needs. Both reads are independent, so they go out
    //    together rather than one after the other.
    const sensingStart = performance.now();
    let priorState: DimensionStateMap = {};
    // Read once here and handed to determineMode below. The router used to
    // re-read it, which was a second round trip for a value that cannot have
    // changed in between.
    let prefetchedProgress: RepoSocioProgress | undefined;

    if (overrideDimensionState) {
        // Use override state (for testing) - no sensing call at all
        priorState = overrideDimensionState;
    } else {
        const [dimensionState, repoProgress] = await Promise.all([
            getDimensionStateMap(socio.id),
            repo.getSocioProgress(socio.id),
        ]);
        priorState = dimensionState;
        prefetchedProgress = repoProgress;
    }

    // 1. Determine interaction mode from real progress data + PRIOR dimension
    //    state. Gate detection does not read dimension state; only the reteach
    //    heuristic does, and a one-turn lag on an EMA signal is immaterial.
    const modeStart = performance.now();
    const modeResult = await determineMode(
        socio, playerTurn?.learnerText ?? incomingText, collectionKey, priorState, prefetchedProgress,
    );
    timings.determineMode = performance.now() - modeStart;

    // 1b. Kick off the sensing pass, if this turn is worth sensing.
    //
    //     It is NOT awaited here: dimension state is a slow-moving EMA, so this
    //     turn's reply is generated against the PRIOR state while sensing
    //     computes the new one concurrently. Turn latency drops from
    //     sensing + llm to roughly max(sensing, llm).
    //
    //     Dispatched AFTER the router rather than before it, which costs
    //     nothing — `determineMode` is DB-only and already had to finish before
    //     the LLM call — and buys the policy a mode to decide on. A learner
    //     typing "next" to advance a lesson is not reporting comprehension, and
    //     sensing it was a Haiku round trip spent to learn nothing.
    const basePolicy = resolveAnalysisPolicy({
        mode: modeResult.routerResult.mode,
        message: playerTurn?.learnerText ?? incomingText,
    });
    const policy: AnalysisPolicy = playerTurn?.context.intent === 'expand'
        ? { sensing: false, sentiment: false, contextExtraction: false }
        : playerTurn && playerTurn.context.intent !== 'lesson_entry'
        ? { sensing: true, sentiment: true, contextExtraction: false }
        : basePolicy;
    const playerDimensions = parsedPlayerConfig?.success
        ? parsedPlayerConfig.data.trackedDimensions.map((item) => ({ key: item.key, label: item.label, min: item.scale.min, max: item.scale.max }))
        : undefined;

    //     One call, both signals. Comprehension and emotion used to be two
    //     Haiku round trips scoring the same sentence, with `confusion` graded
    //     twice and no guarantee the answers agreed.
    let analysisPromise: Promise<{ state: DimensionStateMap; sentiment: SentimentResult | null; dimensions: SensedDimension[] }>;
    if (overrideDimensionState || !policy.sensing) {
        analysisPromise = Promise.resolve({ state: priorState, sentiment: null, dimensions: [] });
    } else {
        const repoProgress = prefetchedProgress ?? modeResult.repoProgress;
        const lessonContext = playerTurn?.context.lessonKey ?? (hasLessonData(collectionKey, repoProgress.currentLessonNumber)
            ? getLessonData(collectionKey, repoProgress.currentLessonNumber).titleEs
            : 'Conversación general de mentoría');

        const stateAtDispatch = priorState;
        analysisPromise = senseAndScore({
            incomingText: playerTurn?.learnerText ?? incomingText,
            priorState: stateAtDispatch,
            lessonContext,
            socioId: socio.id,
            organizationId: playerConfig?.program.organizationId,
            dimensions: playerDimensions,
        }).then(async (result) => {
            // Trivial or unreadable: nothing to fold in, so the prior state
            // carries forward untouched rather than being pulled toward neutral.
            const state = result.dimensions.length > 0
                ? await updateDimensionState(socio.id, result.dimensions)
                : stateAtDispatch;
            return { state, sentiment: result.sentiment, dimensions: result.dimensions };
        }).catch((error) => {
            console.error('[AI] Analysis pass failed, keeping prior state:', error);
            return { state: stateAtDispatch, sentiment: null, dimensions: [] };
        });
    }

    // ── Handle gated assessment mode early ──────────────────────────────────
    // When student reaches a gate, we return the assessment prompt instead of
    // normal AI generation. The client should switch to assessment mode.
    if (modeResult.routerResult.mode === InteractionMode.GATED_ASSESSMENT) {
        const gateState = modeResult.routerResult.gatedAssessment!;
        const lang = (socio.language || DEFAULT_LANGUAGE) as SupportedLanguage;

        // Build assessment intro message
        const introText = lang === 'en'
            ? `Before moving on, let's check your understanding.\n\n${gateState.prompt}`
            : lang === 'pt'
            ? `Antes de continuar, vamos verificar sua compreensão.\n\n${gateState.prompt}`
            : `Antes de continuar, verifiquemos tu comprensión.\n\n${gateState.prompt}`;

        console.log(`[GatedAssessment] Reached gate ${gateState.blockId} in lesson ${gateState.lessonKey}`);

        // Let the in-flight sensing pass finish and persist before returning.
        const { state: gateLiveState } = await analysisPromise;

        return {
            text: introText,
            markers: { cleanText: introText, flags: [], lessonsCompleted: [], escalations: [], financials: [], milestones: [] },
            mode: InteractionMode.GATED_ASSESSMENT,
            determineModeResult: modeResult,
            dimensionState: gateLiveState,
            analysisPolicy: policy,
            gatedAssessment: {
                sessionId: gateState.sessionId,
                blockId: gateState.blockId,
                lessonKey: gateState.lessonKey,
                prompt: gateState.prompt,
            },
        };
    }

    // 2. Assemble 4-layer system prompt with real progress + dimension state.
    //    dbPromptVersions collects the versions of any DB-backed layers the
    //    build actually used — no extra queries, it rides along the existing ones.
    //    The history fetch does not depend on the prompt, so the two run
    //    concurrently rather than back to back.
    const promptStart = performance.now();
    const dbPromptVersions: PromptVersionSink = {};
    const modelHistoryPromise = expanded && playerTurn?.context.parentAssistantMessageId
        ? playerRuntimeRepo.message.findFirst({
            where: {
                id: playerTurn.context.parentAssistantMessageId,
                socioId: socio.id,
                role: 'assistant',
            },
            select: { role: true, content: true },
        }).then((message) => message ? [message] : [])
        : repo.getMessages(socio.id, 10);
    const [baseSystemPrompt, modelHistory, playerGrounding] = await Promise.all([
        buildSystemPrompt(
            socio,
            modeResult.routerResult,
            modeResult.progress,
            collectionKey,
            priorState,
            dbPromptVersions,
            modeResult.activeFlags,
            modeResult.reachedMilestoneKeys,
            modeResult.gateRecency,
        ),
        modelHistoryPromise,
        playerTurn ? playerTutorGrounding(playerTurn.context) : Promise.resolve(null),
    ]);
    const groundedSystemPrompt = playerGrounding
        ? `${baseSystemPrompt}\n\nPLAYER COURSE CONTEXT (authoritative; do not reveal hidden quiz answers):\n${playerGrounding}\n- This verified player context overrides conflicting legacy lesson numbers, titles, and progress text elsewhere in the prompt.\n- Discuss only this verified lesson or capstone in the reply.`
        : baseSystemPrompt;
    const responseInstruction = buildResponseStyleInstruction(responseStyle, expanded);
    const systemPrompt = responseInstruction ? `${groundedSystemPrompt}\n\n${responseInstruction}` : groundedSystemPrompt;
    timings.buildPrompt = performance.now() - promptStart;
    timings.fetchHistory = 0; // folded into buildPrompt above

    // An expansion targets the exact assistant row validated by
    // preparePlayerContext. Global recent history may contain a newer reply
    // from another lesson or capstone turn, so the validated parent is the only
    // conversational history the model sees. The direct id lookup also works
    // when that parent has fallen outside the ordinary ten-message window.
    const expansionTarget = expanded ? modelHistory[0]?.content : undefined;
    const modelIncomingText = expansionTarget
        ? `${incomingText}\n\nVALIDATED EXPANSION TARGET (quote supplied by the server):\n${expansionTarget}\n\nExpand that target only; do not claim it is missing.`
        : incomingText;
    const messages = assembleOrderedModelMessages(systemPrompt, modelHistory as Message[], modelIncomingText).map((message) => {
        if (message.role === 'system') return new SystemMessage(message.content);
        if (message.role === 'assistant') return new AIMessage(message.content);
        return new HumanMessage(message.content);
    });

    // 4. Call LLM with retry
    try {
        const invokeStart = performance.now();
        // One trace row per logical turn: retries inside invokeWithRetry are part
        // of the same traced call, so latencyMs covers the whole attempt chain.
        const { content: rawMessageContent } = await invokeTraced({
            operation: 'lesson_delivery',
            model: resolveOpenRouterModel(),
            promptVersion: buildLessonPromptVersion({
                dbVersions: dbPromptVersions,
                contentIdentity: getContentIdentity(modeResult.routerResult, collectionKey),
                language: (socio.language || DEFAULT_LANGUAGE) as SupportedLanguage,
                stance: modeResult.routerResult.stance,
            }),
            systemPrompt,
            socioId: socio.id,
            // The exact router mode (RETEACH, FREEFORM_QUESTION, ...) lives here;
            // operation stays coarse so the whole chat path is queryable as one.
            mode: modeResult.routerResult.mode,
            context: playerTurn ? {
                surface: 'player',
                courseCode: playerTurn.context.courseCode,
                collectionKey: playerTurn.context.collectionKey,
                programVersionId: playerTurn.context.programVersionId,
                lessonKey: playerTurn.context.lessonKey,
                ...(playerTurn.context.blockId ? { blockId: playerTurn.context.blockId } : {}),
                intent: playerTurn.context.intent,
                ...(playerTurn.context.parentIntent ? { parentIntent: playerTurn.context.parentIntent } : {}),
            } : undefined,
            // markFirstToken is what stamps ttftMs; only the streaming branch
            // ever calls it, so non-streaming rows keep a null TTFT.
            invoke: async (markFirstToken): Promise<{ content: unknown }> => {
                if (responseStyle) {
                    // Buffer configured player replies until the output
                    // contract is validated. Streaming an invalid first draft
                    // would make a later rewrite impossible to retract.
                    const response = await invokeStyledPlayerResponse(chat, messages, responseStyle, expanded);
                    if (onToken) {
                        markFirstToken();
                        onToken(sanitizeForDelivery(parseMarkers(contentToText(response.content)).cleanText));
                    }
                    return response;
                }
                return onToken
                    ? await streamWithRetry(chat, messages, onToken, markFirstToken)
                    : await invokeWithRetry(chat, messages);
            },
        });
        const rawContent = contentToText(rawMessageContent);
        timings.llmInvoke = performance.now() - invokeStart;

        // 4b. Join the concurrent sensing pass. By now it has usually already
        //     settled, so sensingJoinWait should be near zero on a normal turn -
        //     that number is how much sensing still costs after parallelization.
        const joinStart = performance.now();
        const { state: liveState, sentiment, dimensions } = await analysisPromise;
        timings.sensingJoinWait = performance.now() - joinStart;
        timings.sensing = performance.now() - sensingStart;

        // 5. Parse markers from the response
        const parseStart = performance.now();
        const markers = parseMarkers(rawContent);
        const sanitized = sanitizeForDelivery(markers.cleanText);
        timings.parseAndSanitize = performance.now() - parseStart;

        const totalTime = performance.now() - startTime;

        void logEvent('info', 'ai', 'AI response generated', {
            socioId: socio.id,
            mode: modeResult.routerResult.mode,
            stance: modeResult.routerResult.stance?.stance,
            stanceReason: modeResult.routerResult.stance?.reason,
            promptTokensApprox: systemPrompt.length,
            responseLength: rawContent.length,
            totalMs: Math.round(totalTime),
            timings: {
                sensing: Math.round(timings.sensing),
                sensingJoinWait: Math.round(timings.sensingJoinWait),
                determineMode: Math.round(timings.determineMode),
                buildPrompt: Math.round(timings.buildPrompt),
                fetchHistory: Math.round(timings.fetchHistory),
                llmInvoke: Math.round(timings.llmInvoke),
                parseAndSanitize: Math.round(timings.parseAndSanitize),
            },
            dimensionState: liveState,
            reteachFromDimension: modeResult.reteachFromDimension,
        });

        return {
            text: sanitized,
            markers,
            mode: modeResult.routerResult.mode,
            determineModeResult: modeResult,
            dimensionState: liveState,
            analysisPolicy: policy,
            sentiment,
            sensedDimensions: dimensions,
        };
    } catch (error) {
        console.error('[AI] All retry attempts failed:', error);

        // Still join sensing so its state write lands before the request ends.
        await analysisPromise;

        void logEvent('error', 'ai', 'AI generation failed after retries', {
            socioId: socio.id,
            error: error instanceof Error ? error.message : String(error),
        });

        const language = (socio.language || DEFAULT_LANGUAGE) as SupportedLanguage;
        return {
            text: AI_ERROR_FALLBACK[language] ?? AI_ERROR_FALLBACK['es'],
            markers: { cleanText: '', flags: [], lessonsCompleted: [], escalations: [], financials: [], milestones: [] },
            mode: modeResult.routerResult.mode,
            determineModeResult: modeResult,
            // The reply failed, so there is no AI turn to extract context from.
            // Sentiment still stands on the learner's own message.
            analysisPolicy: { ...policy, contextExtraction: false },
            isError: true,
        };
    }
}
