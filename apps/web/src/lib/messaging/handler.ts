import { repo } from '@/lib/repo';
import { resolveCourseMilestones } from '@/lib/ai/prompts/courseOutcome';
import { resolvePromptScope } from '@/lib/ai/prompts/resolveScope';
import { handleOnboarding } from '@/lib/onboarding/service';
import { generateAIResponse } from '@/lib/ai/service';
import { InteractionMode, parseScore, type ParsedMarkers } from '@/lib/ai/prompts';
import { preloadCollection, getLessonCount } from '@/lib/lessons/db-lesson-service';
import { persistSentimentAndFlag } from '@/lib/sentiment/pipeline';
import type { SentimentResult } from '@/lib/sentiment/analyzer';
import { extractAndStoreContext } from '@/lib/ai/contextExtractor';
import type { AnalysisPolicy } from '@/lib/ai/analysisPolicy';
import type { DeliveryChannel, ChannelType } from '@/lib/delivery/types';
import type { Message } from '@/lib/repo/types';
import { DEFAULT_LANGUAGE, LESSON_MESSAGES, type SupportedLanguage } from '@/lib/i18n/languages';
import { getConfigNumber } from '@/lib/config/service';
import { getCourseMeta, buildWelcomeMessage } from '@/lib/courses/course-meta';
import { createAssessmentSession } from '@/lib/ai/assessment/createAssessmentSession';
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { createTenantContext } from '@/lib/repo/tenantContext';

/**
 * A turn the system started, with no learner message behind it.
 *
 * `message` on the input is then a prompt-only instruction — it steers
 * generation and is never persisted or shown to anyone, exactly as the reminder
 * cron already does with its "(the socio has not replied…)" human turn.
 */
export interface SystemInitiatedTurn {
    /** What occasioned it. Recorded on the message for later attribution. */
    kind: 'gate_resolved';
    /** The assessment session this turn answers. One follow-up per session. */
    sessionId: string;
    /**
     * Suppress the turn if the AI already spoke after this instant.
     *
     * The duplicate guard, and deliberately a fact rather than a lock: if
     * anything has been said to the learner since the gate resolved, this turn
     * is redundant. That covers both a retry of an already-answered gate (our
     * own message moves the timestamp past it) and the learner typing at the
     * same moment (their reply's turn moves it too). Two AI turns back to back
     * is the outcome worth avoiding; one arriving late is not.
     */
    suppressIfAssistantSpokeAfter: Date;
}

export interface HandleMessageInput {
    externalId: string;
    channelType: ChannelType;
    message: string;
    channel: DeliveryChannel;
    language?: SupportedLanguage;
    /** Web socios only: JWT display name so we can skip name onboarding */
    userName?: string | null;
    /** Present only when nothing the learner sent triggered this turn. */
    systemInitiated?: SystemInitiatedTurn;
    /**
     * Opt into streaming. Receives sanitized deltas as the reply is written.
     *
     * Passing this changes WHEN the caller learns the text, never WHAT gets
     * done with it — see the call site for the guarantee that carries.
     * Ignored for system-initiated turns, which have no one waiting on them.
     */
    onToken?: (delta: string) => void;
}

export interface HandleMessageResult {
    responseText: string;
    mode: InteractionMode;
    markers: ParsedMarkers;
    socioId: string;
    isNewSocio: boolean;
    isError?: boolean;
    /** Created messages with DB ids and metadata for client rendering */
    messages?: Message[];
    /**
     * A system-initiated turn that the duplicate guard dropped. Not an error:
     * it means someone had already spoken to the learner.
     */
    suppressed?: boolean;
}

/**
 * Has anything been said to the learner since `after`?
 *
 * Read immediately before generating and again immediately before persisting,
 * so the window in which two turns can race narrows from the length of an LLM
 * call to the gap between the final check and the insert. The cost of losing
 * that race is one wasted generation, which is the right way round.
 */
async function assistantSpokeAfter(socioId: string, after: Date): Promise<boolean> {
    try {
        const lastAt = await repo.getLastAssistantMessageAt(socioId);
        return lastAt !== null && lastAt > after;
    } catch (error) {
        // Failing open would double-message the learner. Failing closed only
        // costs them the unprompted turn, which they can trigger by typing.
        console.error(`[Handler] Duplicate-guard read failed for socio ${socioId}:`, error);
        return true;
    }
}

/**
 * Fires the two post-reply analysis passes the turn earned.
 *
 * Both are fire-and-forget by design — a learner should never wait on a
 * sentiment score — but "fire-and-forget" is not "free": each is an LLM round
 * trip plus a trace write on the same instance serving the next request. The
 * policy is what decides whether the turn was worth them.
 */
function runPassiveAnalysis(params: {
    policy: AnalysisPolicy;
    socioId: string;
    userMessageId: string;
    userMessage: string;
    aiResponse: string;
    /** Already scored by the merged analysis pass. No LLM work left to do. */
    sentiment?: SentimentResult | null;
}): void {
    const { policy, socioId, userMessageId, userMessage, aiResponse, sentiment } = params;

    // Sentiment is no longer computed here. It rides along with the sensing
    // call that already had to run (see ai/sensing/senseAndScore.ts), so this
    // is a write, not a round trip. A null means the model's answer could not
    // be read — nothing to record, and inventing neutral scores would put a
    // false "calm" reading on a message nobody actually scored.
    if (policy.sentiment && sentiment) {
        persistSentimentAndFlag(userMessageId, socioId, sentiment).catch(err =>
            console.error('[Sentiment] Persisting scores failed:', err)
        );
    }

    if (policy.contextExtraction) {
        extractAndStoreContext(socioId, userMessage, aiResponse).catch(err =>
            console.error('[ContextExtractor] Background extraction failed:', err)
        );
    }
}

export async function handleIncomingMessage(input: HandleMessageInput): Promise<HandleMessageResult> {
    const startTime = performance.now();
    const { externalId, channelType, message, channel, language, userName, systemInitiated, onToken } = input;

    let socio = await repo.getSocio(channelType, externalId);
    const isNewSocio = !socio;

    if (!socio) {
        socio = await repo.createSocio(channelType, externalId);

        if (channelType === 'web' && userName !== undefined) {
            const displayName = userName?.trim() ? userName.trim() : null;
            const socioLang = (language || DEFAULT_LANGUAGE) as SupportedLanguage;

            await repo.updateSocio(socio.id, {
                language: socioLang,
                name: displayName,
                status: 'ACTIVE',
            });
            await repo.initProgress(socio.id);
            socio = { ...socio, language: socioLang, name: displayName, status: 'ACTIVE' };

            // Get course-specific welcome message
            let welcomeMsg: string;
            if (socio.curriculumCollectionKey) {
                const meta = await getCourseMeta(socio.curriculumCollectionKey);
                welcomeMsg = buildWelcomeMessage(meta, socioLang, displayName);
            } else {
                // Fallback for socios without curriculum (shouldn't happen on web)
                const langStrings = LESSON_MESSAGES[socioLang] ?? LESSON_MESSAGES['es'];
                welcomeMsg = displayName
                    ? langStrings.welcomeWithName(displayName)
                    : langStrings.welcomeAnonymous;
            }

            await repo.addMessage({
                socioId: socio.id,
                role: 'user',
                content: message,
            });

            await repo.addMessage({
                socioId: socio.id,
                role: 'assistant',
                content: welcomeMsg,
                senderType: 'ai',
            } as Parameters<typeof repo.addMessage>[0]);

            await channel.sendMessage(externalId, welcomeMsg);

            return {
                responseText: welcomeMsg,
                mode: InteractionMode.LESSON_START,
                markers: {
                    cleanText: welcomeMsg,
                    flags: [],
                    lessonsCompleted: [],
                    escalations: [],
                    financials: [],
                    milestones: [],
                },
                socioId: socio.id,
                isNewSocio: true,
            };
        }

        if (language) {
            await repo.updateSocio(socio.id, { language, status: 'AWAITING_NAME' });
            socio = { ...socio, language, status: 'AWAITING_NAME' };
        }

        await handleOnboarding(socio, message, channel);
        return {
            responseText: '',
            mode: InteractionMode.LESSON_START,
            markers: { cleanText: '', flags: [], lessonsCompleted: [], escalations: [], financials: [], milestones: [] },
            socioId: socio.id,
            isNewSocio: true,
        };
    }

    if (socio.status !== 'ACTIVE') {
        await handleOnboarding(socio, message, channel);
        return {
            responseText: '',
            mode: InteractionMode.LESSON_START,
            markers: { cleanText: '', flags: [], lessonsCompleted: [], escalations: [], financials: [], milestones: [] },
            socioId: socio.id,
            isNewSocio,
        };
    }

    // Update language if the client sends a different one (e.g. language switcher)
    if (language && language !== socio.language) {
        await repo.updateSocio(socio.id, { language });
        socio = { ...socio, language };
    }

    // ── System-initiated turn: nothing of the learner's to record ───────────
    // No user message is persisted (there wasn't one) and the interaction clock
    // is not touched (the learner did not interact). The first duplicate check
    // happens here so an already-answered gate costs a single query, not a
    // generation.
    if (systemInitiated) {
        if (await assistantSpokeAfter(socio.id, systemInitiated.suppressIfAssistantSpokeAfter)) {
            console.log(
                `[Handler] Suppressed ${systemInitiated.kind} turn for socio ${socio.id} ` +
                `(session ${systemInitiated.sessionId}) — already spoken to since.`,
            );
            return {
                responseText: '',
                mode: InteractionMode.FREEFORM_QUESTION,
                markers: { cleanText: '', flags: [], lessonsCompleted: [], escalations: [], financials: [], milestones: [] },
                socioId: socio.id,
                isNewSocio,
                suppressed: true,
            };
        }
    }

    // Independent writes, so they go out together.
    const [userMsg] = systemInitiated
        ? [null]
        : await Promise.all([
            repo.addMessage({
                socioId: socio.id,
                role: 'user',
                content: message,
            }),
            repo.touchInteraction(socio.id),
        ]);

    // Sentiment analysis used to fire here, unconditionally, on every message
    // from an ACTIVE socio — including "ok", "siguiente" and the bare numeric
    // replies to the feedback prompt. It now runs after the router, gated by
    // the analysis policy, because the policy needs a mode to decide on. See
    // `runPassiveAnalysis` at the end of this function.
    //
    // Moving it later also makes a race deterministic: a RED flag written from
    // THIS message could previously land before `determineMode` read the flag
    // table, flipping stance to coach mid-turn some of the time. It now always
    // takes effect on the next turn.

    if (socio.aiPaused) {
        return {
            responseText: '',
            mode: InteractionMode.LESSON_DELIVERY,
            markers: { cleanText: '', flags: [], lessonsCompleted: [], escalations: [], financials: [], milestones: [] },
            socioId: socio.id,
            isNewSocio,
        };
    }

    const promptOverridesRaw = socio.promptOverrides as Record<string, unknown> | null;
    if (promptOverridesRaw?.awaitingFeedback === true) {
        const scoreMatch = message.match(/\b(\d{1,2})\b/);
        const parsed = scoreMatch ? parseInt(scoreMatch[1], 10) : NaN;
        const rating = Number.isFinite(parsed) ? parsed : NaN;
        const lessonNum =
            typeof promptOverridesRaw.feedbackLessonNum === 'number'
                ? promptOverridesRaw.feedbackLessonNum
                : Number(promptOverridesRaw.feedbackLessonNum) || 0;

        if (rating >= 1 && rating <= 10) {
            await repo.createFeedback({
                socioId: socio.id,
                lessonNum,
                rating,
                comment: message.trim() || null,
            });

            const rest = { ...promptOverridesRaw };
            delete rest.awaitingFeedback;
            delete rest.feedbackLessonNum;
            await repo.updateSocio(socio.id, {
                promptOverrides:
                    Object.keys(rest).length > 0 ? (rest as Record<string, unknown>) : null,
            });

            const thankYou =
                '¡Gracias por compartir tu opinión! Lo que nos cuentas nos ayuda a mejorar. ¿En qué más te puedo ayudar hoy?';

            await repo.addMessage({
                socioId: socio.id,
                role: 'assistant',
                content: thankYou,
                senderType: 'ai',
            } as Parameters<typeof repo.addMessage>[0]);

            await channel.sendMessage(externalId, thankYou);

            return {
                responseText: thankYou,
                mode: InteractionMode.LESSON_DELIVERY,
                markers: {
                    cleanText: thankYou,
                    flags: [],
                    lessonsCompleted: [],
                    escalations: [],
                    financials: [],
                    milestones: [],
                },
                socioId: socio.id,
                isNewSocio,
            };
        }

        const nudge =
            'Por favor responde con un número del 1 al 10 (qué tan útil ha sido el programa para ti). Puedes añadir un comentario si quieres.';

        await repo.addMessage({
            socioId: socio.id,
            role: 'assistant',
            content: nudge,
            senderType: 'ai',
        } as Parameters<typeof repo.addMessage>[0]);

        await channel.sendMessage(externalId, nudge);

        return {
            responseText: nudge,
            mode: InteractionMode.LESSON_DELIVERY,
            markers: {
                cleanText: nudge,
                flags: [],
                lessonsCompleted: [],
                escalations: [],
                financials: [],
                milestones: [],
            },
            socioId: socio.id,
            isNewSocio,
        };
    }

    const collectionKey = socio.curriculumCollectionKey;

    // Require curriculum key - no silent fallback
    if (!collectionKey) {
        const socioLang = (socio.language || DEFAULT_LANGUAGE) as SupportedLanguage;
        const joinMessage = socioLang === 'en'
            ? 'Please join a course first to continue. Visit the app to select your course.'
            : socioLang === 'pt'
            ? 'Por favor, entre em um curso primeiro para continuar. Visite o app para selecionar seu curso.'
            : 'Por favor, inscríbete en un curso primero para continuar. Visita la app para seleccionar tu curso.';

        // Log for WhatsApp legacy path (should be unreachable after backfill)
        console.warn(`[MessageHandler] Socio ${socio.id} has no curriculum key. Prompting to join.`);

        await repo.addMessage({
            socioId: socio.id,
            role: 'assistant',
            content: joinMessage,
            senderType: 'ai',
        } as Parameters<typeof repo.addMessage>[0]);

        await channel.sendMessage(externalId, joinMessage);

        return {
            responseText: joinMessage,
            mode: InteractionMode.LESSON_START,
            markers: { cleanText: joinMessage, flags: [], lessonsCompleted: [], escalations: [], financials: [], milestones: [] },
            socioId: socio.id,
            isNewSocio,
        };
    }

    // Ensure collection is loaded before sync accessors are called
    await preloadCollection(collectionKey);

    // ── The stream is a tap on the output, not the driver of it ──────────────
    // Generation and every write below run to completion server-side whether or
    // not the client is still reading. A learner who closes the tab, loses
    // signal, or reloads mid-reply must end up with EXACTLY the DB state they
    // would have had by waiting: the assistant message stored, markers
    // persisted, progression advanced — all of it recoverable through
    // /api/chat/history and /api/chat/poll.
    //
    // That holds today only because nothing here consults the consumer. It is
    // written down because it is easy to break later and hard to notice when
    // broken: wiring cancellation through, or moving a write to a
    // stream-completion callback, would silently make a dropped connection cost
    // the learner their turn. `handlerStreaming.test.ts` pins it.
    //
    // Streaming is also skipped entirely for system-initiated turns — nobody is
    // holding a connection open for a turn they did not ask for.
    const aiResponse = await generateAIResponse(
        socio,
        message,
        collectionKey,
        undefined,
        systemInitiated ? undefined : onToken,
    );

    // ── Handle gated assessment mode ──────────────────────────────────────────
    // When student reaches a gated teach-back with blocking=true, we pause lesson
    // progress. The router already checked configSnapshot.blocking and only routes
    // to GATED_ASSESSMENT if blocking is true and no completed session exists.
    if (aiResponse.mode === InteractionMode.GATED_ASSESSMENT && aiResponse.gatedAssessment) {
        const gate = aiResponse.gatedAssessment;

        // Get or create session
        let sessionId = gate.sessionId; // Router returns existing open session if any
        const isReusingSession = !!sessionId;

        if (!sessionId) {
            // No open session exists - create one
            // resolveOrganizationIdForSocio never fails: tries ParticipantProfile → curriculum → default org
            const organizationId = await tenantPrismaRepo.resolveOrganizationIdForSocio(socio.id);
            const ctx = createTenantContext(organizationId);
            try {
                const newSession = await createAssessmentSession({
                    ctx,
                    repo: tenantPrismaRepo,
                    socioId: socio.id,
                    lessonKey: gate.lessonKey,
                    blockId: gate.blockId,
                    channel: socio.channelType,
                });
                sessionId = newSession.id;
                console.log(`[MessageHandler] Created assessment session ${sessionId} for socio ${socio.id}, block ${gate.blockId}, org ${organizationId}`);
            } catch (err) {
                console.error(`[MessageHandler] Failed to create assessment session:`, err);
                // Fall through - will post message without session metadata
            }
        } else {
            console.log(`[MessageHandler] Reusing existing assessment session ${sessionId} for socio ${socio.id}`);
        }

        // User message was already added at line 129 - don't duplicate

        // Only post the gate message when creating a NEW session.
        // When reusing an existing session, the gate card is already in the chat - don't duplicate it.
        const createdMessages: Message[] = [];

        if (!isReusingSession) {
            const gateMessage = await repo.addMessage({
                socioId: socio.id,
                role: 'assistant',
                content: aiResponse.text,
                senderType: 'ai',
                metadata: sessionId ? {
                    kind: 'assessment_gate',
                    sessionId,
                    lessonKey: gate.lessonKey,
                    blockId: gate.blockId,
                } : null,
            } as Parameters<typeof repo.addMessage>[0]);

            createdMessages.push(gateMessage);
            await channel.sendMessage(externalId, aiResponse.text);

            console.log(`[MessageHandler] Gated assessment triggered for socio ${socio.id}, block ${gate.blockId}, session ${sessionId ?? 'none'}`);
        }

        return {
            responseText: isReusingSession ? '' : aiResponse.text, // No response text when reusing
            mode: aiResponse.mode,
            markers: aiResponse.markers,
            socioId: socio.id,
            isNewSocio,
            isError: false,
            messages: createdMessages,
        };
    }

    for (const flag of aiResponse.markers.flags) {
        await repo.createFlag({
            socioId: socio.id,
            level: flag.level,
            reason: flag.reason,
            source: 'ai_marker',
        });
        console.log(`[Flag:${flag.level}] socio=${socio.id} reason=${flag.reason}`);
    }

    for (const lessonNum of aiResponse.markers.lessonsCompleted) {
        const score = parseScore(message);
        await repo.completeLesson(socio.id, lessonNum, {
            understanding: score ?? undefined,
        });
        await repo.upsertLessonProgress(socio.id, lessonNum, score, true);
        console.log(`[LessonComplete] socio=${socio.id} lesson=${lessonNum} score=${score}`);
    }

    // Milestones the learner reported reaching. This is the only signal in the
    // system that someone has DONE the task rather than been taught it, so it is
    // written from the learner's own report, with their words kept as evidence.
    //
    // Validated against the course's declared milestones before writing: the key
    // comes out of model output, and an unrecognised one is a hallucination, not
    // a milestone. Silently creating a row for it would put a key in the table
    // that no course defines and nothing can ever render.
    if (aiResponse.markers.milestones.length > 0) {
        const scope = await resolvePromptScope(collectionKey);
        const declared = await resolveCourseMilestones(scope);
        const declaredKeys = new Set(declared.map((m) => m.key));

        for (const key of aiResponse.markers.milestones) {
            if (!declaredKeys.has(key)) {
                console.warn(
                    `[Milestone] socio=${socio.id} AI emitted unknown key "${key}" for ` +
                    `collection=${collectionKey} — not recorded. Declared: ${[...declaredKeys].join(', ') || 'none'}`,
                );
                continue;
            }
            if (!scope.organizationId) {
                console.warn(`[Milestone] socio=${socio.id} unanchored — "${key}" not recorded.`);
                continue;
            }
            await repo.recordMilestoneReached({
                socioId: socio.id,
                organizationId: scope.organizationId,
                collectionKey,
                milestoneKey: key,
                source: 'ai_marker',
                evidence: message,
            });
            console.log(`[Milestone] socio=${socio.id} reached=${key}`);
        }
    }

    for (const fin of aiResponse.markers.financials) {
        const now = new Date();
        const day = now.getUTCDay();
        const mondayOffset = day === 0 ? 6 : day - 1;
        const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset));
        await repo.upsertFinancialSnapshot(socio.id, weekStart, {
            revenue: fin.revenue,
            netProfit: fin.netProfit,
            source: 'ai_marker',
        });
        console.log(`[Financial] socio=${socio.id} revenue=${fin.revenue} netProfit=${fin.netProfit}`);
    }

    const socioLang = ((socio.language || DEFAULT_LANGUAGE) as SupportedLanguage);
    const lm = LESSON_MESSAGES[socioLang] ?? LESSON_MESSAGES['es'];

    let responseText = aiResponse.text;

    // Prepend lesson number header when starting a new lesson
    if (aiResponse.mode === InteractionMode.LESSON_START) {
        const currentLesson = aiResponse.determineModeResult.progress?.currentLessonNumber ?? 1;
        responseText = `${lm.lessonHeader(currentLesson, getLessonCount(collectionKey))}\n\n${responseText}`;
    }

    // Periodic satisfaction check-in when a lesson finishes.
    if (aiResponse.markers.lessonsCompleted.length > 0) {
        const completedNum =
            aiResponse.markers.lessonsCompleted[aiResponse.markers.lessonsCompleted.length - 1];

        // The completion banner used to be concatenated here — a horizontal
        // rule, "✅ Lesson N complete!", and either "type next" or
        // "Congratulations on completing all the lessons!". It is gone, and the
        // AI now writes its own closing (see `buildLessonClosingNote` in
        // layers/task.ts), for three reasons:
        //
        //   - it arrived in a different voice, glued to the end of a reply the
        //     AI had just finished writing, and regularly contradicted it —
        //     assigning a commitment as the next step and then announcing the
        //     course was over
        //   - it could not tell a finished lesson from a finished course. The
        //     branch was `hasLessonData(n+1)`, so a one-lesson course got
        //     "completing all the lessons" on lesson one
        //   - a course ending is the most personal moment the program has, and
        //     it was a string constant
        //
        // The feedback prompt below is NOT part of that banner and stays: it
        // drives the `awaitingFeedback` state machine this handler reads on the
        // next turn, and removing it would silently end feedback collection.

        let feedbackInterval = 5;
        try {
            feedbackInterval = await getConfigNumber('FEEDBACK_EVERY_N_LESSONS');
        } catch {
            feedbackInterval = 5;
        }
        if (!Number.isFinite(feedbackInterval) || feedbackInterval < 1) {
            feedbackInterval = 5;
        }

        if (completedNum > 0 && completedNum % feedbackInterval === 0) {
            const feedbackPrompt = '\n\n' + lm.feedbackPrompt(completedNum);
            responseText += feedbackPrompt;

            const existingPo = (socio.promptOverrides || {}) as Record<string, unknown>;
            await repo.updateSocio(socio.id, {
                promptOverrides: {
                    ...existingPo,
                    awaitingFeedback: true,
                    feedbackLessonNum: completedNum,
                },
            });
        }
    }

    if (aiResponse.markers.escalations.length > 0) {
        for (const reason of aiResponse.markers.escalations) {
            await repo.createFlag({
                socioId: socio.id,
                level: 'RED',
                // Legacy fallback text; the rendered line comes from reasonCode.
                reason: `Solicitud de escalación: ${reason}`,
                reasonCode: 'escalation.requested',
                // The socio's own words, verbatim — never translated.
                reasonParams: { requestReason: reason },
                source: 'ai_marker',
            });
            console.log(`[Escalation Persisted] socio=${socio.id} reason=${reason}`);
        }

        const lang = (socio.language ?? DEFAULT_LANGUAGE) as SupportedLanguage;
        const langStrings = LESSON_MESSAGES[lang] ?? LESSON_MESSAGES['es'];
        const escalationConfirmation = '\n\n' + langStrings.escalationConfirmation;
        responseText = responseText + escalationConfirmation;

        if (socio.mentorId) {
            console.log(
                `[ESCALATE] Socio ${socio.id} (${socio.name ?? 'unknown'}) requested mentor contact. Mentor: ${socio.mentorId}`,
            );
        }
    }

    // Second duplicate check, deliberately as late as possible: generation is
    // the slow part, so re-reading here shrinks the race to the gap between
    // this line and the insert below. A wasted generation beats a double reply.
    if (systemInitiated) {
        if (await assistantSpokeAfter(socio.id, systemInitiated.suppressIfAssistantSpokeAfter)) {
            console.log(
                `[Handler] Discarded generated ${systemInitiated.kind} turn for socio ${socio.id} ` +
                `(session ${systemInitiated.sessionId}) — someone spoke while it was generating.`,
            );
            return {
                responseText: '',
                mode: aiResponse.mode,
                markers: aiResponse.markers,
                socioId: socio.id,
                isNewSocio,
                suppressed: true,
            };
        }
    }

    const assistantMessage = await repo.addMessage({
        socioId: socio.id,
        role: 'assistant',
        content: responseText,
        senderType: 'ai',
        // Attribution for a turn nobody asked for. Without it there is no way
        // to tell, later, which messages the system volunteered.
        ...(systemInitiated
            ? { metadata: { kind: systemInitiated.kind, sessionId: systemInitiated.sessionId } }
            : {}),
    } as Parameters<typeof repo.addMessage>[0]);

    // Sentiment + context extraction, both fire-and-forget, both gated on
    // whether this turn carried the signal they look for. A system-initiated
    // turn has no learner utterance to score or mine, so neither runs.
    if (userMsg) {
        runPassiveAnalysis({
            policy: aiResponse.analysisPolicy,
            socioId: socio.id,
            userMessageId: userMsg.id,
            userMessage: message,
            aiResponse: responseText,
            sentiment: aiResponse.sentiment,
        });
    }

    const isLessonMode =
        aiResponse.mode === InteractionMode.LESSON_DELIVERY ||
        aiResponse.mode === InteractionMode.LESSON_START;

    // Progression follows delivery, including on a system-initiated turn. A
    // gate sitting mid-lesson leaves the learner with teaching still to come,
    // so the follow-up turn routes to LESSON_DELIVERY and really does deliver
    // the next message — holding the pointer back would replay it on their next
    // turn. When the gate sits at the end of a lesson there is nothing left to
    // deliver, the router falls through to FREEFORM_QUESTION, and this branch
    // does not run at all.
    if (aiResponse.markers.lessonsCompleted.length === 0 && isLessonMode) {
        await repo.advanceMessage(socio.id);
        const progress = await repo.getSocioProgress(socio.id);
        await repo.upsertLessonProgress(socio.id, progress.currentLessonNumber, null, false);
    }

    // Reminder counters track learner silence. The AI speaking is not the
    // learner breaking it.
    if (!systemInitiated && (isLessonMode || aiResponse.mode === InteractionMode.REMINDER)) {
        await repo.resetReminders(socio.id);
    }

    await channel.sendMessage(externalId, responseText);

    const totalTime = performance.now() - startTime;
    console.log(`[MessageHandler] Total processing time: ${Math.round(totalTime)}ms for socio ${socio.id}`);

    return {
        responseText,
        mode: aiResponse.mode,
        markers: aiResponse.markers,
        socioId: socio.id,
        isNewSocio,
        isError: aiResponse.isError,
        messages: [assistantMessage],
    };
}
