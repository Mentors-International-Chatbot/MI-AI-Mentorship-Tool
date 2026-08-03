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
        return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
    }

    // Order matters: the key must be committed before resolution runs, or
    // resolveOrganizationForSocio reads the stale row and falls to tier 3.
    // These are two separate statements rather than one transaction precisely
    // so the resolution query sees the committed value.
    await repo.setSocioCurriculum(socio.id, collectionKey);

    await anchorParticipantProfile(socio, collectionKey);

    // Preload collection to warm cache for upcoming chat
    await preloadCollection(collectionKey);

    return NextResponse.json({
        success: true,
        collectionKey,
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
