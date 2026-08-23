import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';
import { repo } from '@/lib/repo';
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { createTenantContext } from '@/lib/repo/tenantContext';
import type { Socio } from '@/lib/repo/types';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/languages';
import { logEvent } from '@/lib/logging/logger';
import { resolveCourseCode, getAvailableCourseCodes, getAvailableCourses } from '@/lib/courses/resolver';
import { preloadCollection } from '@/lib/lessons/db-lesson-service';
import { prisma } from '@/lib/db';
import { resolveDelivery } from '@/lib/journey-package/delivery';
import { resolveLearnerHome } from '@/lib/courses/learnerHome';
import { selectPublishedPlayerVersion } from '@/lib/courses/selectPublishedPlayerVersion';

export const dynamic = 'force-dynamic';

/**
 * Give the socio a ParticipantProfile — the tenancy anchor every org-scoped
 * query filters on. A socio without one is invisible to every mentor dashboard.
 *
 * Course selection is the first moment an organization becomes knowable: before
 * it there is no signal at all, and ParticipantProfile.organizationId is
 * non-nullable, so a placeholder-now-fill-later row is not possible.
 *
 * Fails closed on tier 3. `source === 'default'` means the socio is an orphan
 * that landed in whatever DEFAULT_ORGANIZATION_ID names — that is a guess, and
 * writing it would forge a tenant claim that later reads treat as authoritative
 * (tier 1 short-circuits, so a wrong anchor is permanent). An unanchored socio
 * stays unanchored, matching resolveDashboardPanels and feedback attribution.
 *
 * Never throws: a failed profile write leaves a backfillable socio, while a
 * failed course selection is a dead end for the user.
 *
 * Both failure paths go through logEvent → SystemLog → /admin/logs rather than
 * the console. An unanchored socio is invisible to every mentor dashboard, and
 * Vercel function logs are not somewhere anyone looks.
 */
async function anchorParticipantProfile(socio: Socio, collectionKey: string): Promise<void> {
    try {
        const { organizationId, source } = await tenantPrismaRepo.resolveOrganizationForSocio(socio.id);

        if (source === 'default') {
            // No wrapper needed: this call sits inside the try above, so a throw
            // from logEvent degrades into the catch below rather than escaping.
            await logEvent(
                'warn',
                'system',
                `[Curriculum] socio ${socio.id} selected "${collectionKey}" but resolved only to ` +
                    `the default organization — no ParticipantProfile created. This socio will not ` +
                    `appear in org-scoped queries until its tenant is established.`,
                { socioId: socio.id, collectionKey, resolutionSource: source },
            );
            return;
        }

        await tenantPrismaRepo.createParticipant(createTenantContext(organizationId), {
            socioId: socio.id,
            displayName: socio.name ?? null,
            preferredLang: socio.language || DEFAULT_LANGUAGE,
            metadata: null,
        });
    } catch (error) {
        // This block's only job is to keep a profile-write failure from breaking
        // course selection, so nothing in it may throw. logEvent's own try/catch
        // covers just its Prisma write — the console call and template literal
        // ahead of it are unguarded — so it gets a wrapper of its own here.
        try {
            await logEvent(
                'error',
                'system',
                `[Curriculum] could not create ParticipantProfile for socio ${socio.id} ` +
                    `(collection "${collectionKey}") — socio is unanchored and will not appear ` +
                    `in org-scoped queries until backfilled.`,
                {
                    socioId: socio.id,
                    collectionKey,
                    error: error instanceof Error ? error.message : String(error),
                },
            );
        } catch {
            // Degradation worth knowing about: if the cause was an unreachable
            // database, the SystemLog write fails for the same reason and this
            // record survives only in the console. SystemLog captures
            // application-level failures, not infrastructure ones — /admin/logs
            // is NOT a complete list of unanchored socios.
        }
    }
}

/**
 * POST /api/auth/curriculum
 * Sets the curriculum for the current socio based on course code.
 * Body: { courseCode: string }
 */
export async function POST(req: NextRequest) {
    const session = await verifySession();
    if (!session) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (session.role !== 'socio') {
        return NextResponse.json({ error: 'Only socios can set curriculum' }, { status: 403 });
    }

    const body = await req.json() as { courseCode?: string };
    const { courseCode } = body;

    if (!courseCode || typeof courseCode !== 'string') {
        return NextResponse.json({ error: 'Course code is required' }, { status: 400 });
    }

    const collectionKey = resolveCourseCode(courseCode);
    if (!collectionKey) {
        return NextResponse.json(
            { error: 'Invalid course code', availableCodes: getAvailableCourseCodes() },
            { status: 400 }
        );
    }

    const socio = await repo.getSocio('web', session.userId);
    if (!socio) {
        return NextResponse.json({
            error: 'This session belongs to a different or reset database. Clear it and sign in again.',
            code: 'session_database_mismatch',
        }, { status: 409 });
    }

    // Player courses are tenant-owned. A published version in a synthetic test
    // organization must never make the course globally joinable, and a learner
    // already anchored to one organization must not be enrolled into another.
    // Unanchored direct-web learners may select the sole non-synthetic published
    // version; its collection then establishes their tenant in the normal
    // anchorParticipantProfile path below.
    //
    // Which courses this applies to is decided by the published versions'
    // delivery metadata, never by the collection key. Gating on the key made
    // self-serve enrollment work for exactly one course: every other player
    // course set the curriculum, skipped the cohort and enrollment writes, and
    // sent the learner to a chat surface it does not use.
    const candidates = await prisma.programVersion.findMany({
        where: { status: 'published', collection: { slug: collectionKey } },
        include: { program: { include: { organization: { select: { settings: true } } } } },
        orderBy: { publishedAt: 'desc' },
    });
    const isPlayerCourse = candidates.some((candidate) => resolveDelivery(candidate.metadata).surface === 'player');
    let published: Awaited<ReturnType<typeof prisma.programVersion.findFirst>> & {
        program: { organizationId: string; organization: { settings: unknown } };
    } | null = null;
    // Read unconditionally now: the chat-surface enrollment attempt below also
    // needs the participant's org to run the same tenant-safe version pick.
    let participant = await prisma.participantProfile.findUnique({
        where: { socioId: socio.id },
        select: { id: true, organizationId: true },
    });
    if (isPlayerCourse) {
        published = selectPublishedPlayerVersion(candidates, participant?.organizationId);
        if (!published) {
            return NextResponse.json(
                { error: 'This course is not currently published for your organization' },
                { status: 409 },
            );
        }
        if (!resolveDelivery(published.metadata).supportedChannels.includes('web')) {
            return NextResponse.json({ error: 'This course is not available through web enrollment' }, { status: 403 });
        }
    }

    // Order matters: the key must be committed before resolution runs, or
    // resolveOrganizationForSocio reads the stale row and falls to tier 3.
    // These are two separate statements rather than one transaction precisely
    // so the resolution query sees the committed value.
    await repo.setSocioCurriculum(socio.id, collectionKey);

    await anchorParticipantProfile(socio, collectionKey);

    if (published) {
        const delivery = resolveDelivery(published.metadata);
        if (delivery.surface === 'player') {
            participant ??= await prisma.participantProfile.findUnique({
                where: { socioId: socio.id },
                select: { id: true, organizationId: true },
            });
            if (!participant) return NextResponse.json({ error: 'Unable to establish course tenancy' }, { status: 409 });
            if (participant.organizationId !== published.program.organizationId) {
                return NextResponse.json({ error: 'Course tenancy does not match learner tenancy' }, { status: 403 });
            }
            await tenantPrismaRepo.resolveOrCreateActiveEnrollment(createTenantContext(participant.organizationId), {
                participantId: participant.id,
                programVersionId: published.id,
                channel: 'web',
            });
        }
    } else if (!isPlayerCourse && candidates.length > 0) {
        // Chat-surface course (MI2024, pbj-basics): the branch above never runs
        // for these, which is exactly how G3 happened — this endpoint set
        // curriculumCollectionKey and anchored a ParticipantProfile, but never
        // wrote a live Enrollment row, for any chat-surface learner ever.
        //
        // Best-effort and fail-open, unlike the player branch above: chat
        // delivery does not depend on this row to render (resolveLearnerHome
        // sends surface:"chat" straight to /chat regardless), so a resolution
        // failure here must not turn an already-working chat selection into a
        // hard failure. It only needs to happen at all, eventually, for every
        // learner — which idempotent re-entry on next selection guarantees.
        try {
            const chatVersion = selectPublishedPlayerVersion(candidates, participant?.organizationId);
            if (chatVersion && resolveDelivery(chatVersion.metadata).supportedChannels.includes('web')) {
                participant ??= await prisma.participantProfile.findUnique({
                    where: { socioId: socio.id },
                    select: { id: true, organizationId: true },
                });
                if (participant && participant.organizationId === chatVersion.program.organizationId) {
                    await tenantPrismaRepo.resolveOrCreateActiveEnrollment(createTenantContext(participant.organizationId), {
                        participantId: participant.id,
                        programVersionId: chatVersion.id,
                        channel: 'web',
                    });
                }
            }
        } catch (error) {
            await logEvent(
                'error',
                'system',
                `[Curriculum] could not create Enrollment for chat-surface course "${collectionKey}" ` +
                    `(socio ${socio.id}) — course selection still succeeded; this socio needs backfill.`,
                { socioId: socio.id, collectionKey, error: error instanceof Error ? error.message : String(error) },
            );
        }
    }

    // Preload collection to warm cache for upcoming chat
    await preloadCollection(collectionKey);

    // A.5: pass published.id so this always resolves to the course the
    // learner just selected, never the ambiguous "which of your enrollments"
    // question resolveLearnerHome asks when called with no course in mind —
    // this call site already knows which course, no tie-break needed.
    const homeResolution = published ? await resolveLearnerHome(socio.id, 'web', published.id) : null;

    return NextResponse.json({
        success: true,
        collectionKey,
        // `published` is set only for player courses, so this follows the same
        // delivery-driven decision the enrollment write above does. A pinned
        // programVersionId always resolves to a single redirect (see
        // resolveLearnerHome) — 'choose' is unreachable here.
        homePath: homeResolution?.kind === 'redirect' ? homeResolution.path : (published ? null : '/chat'),
        message: `Curriculum set to ${collectionKey}`,
    });
}

/**
 * GET /api/auth/curriculum
 * Returns available courses with metadata for display.
 */
export async function GET() {
    const codes = getAvailableCourseCodes();
    const courses = getAvailableCourses();
    return NextResponse.json({ codes, courses });
}
