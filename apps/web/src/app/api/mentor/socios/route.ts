import { NextRequest, NextResponse } from 'next/server';
import { repo, tenantRepo } from '@/lib/repo';
import { computeSocioHealth } from '@/lib/health';
import { verifyMentorOrAdmin } from '@/lib/auth/ownership';

const HEALTH_ORDER: Record<string, number> = { RED: 0, YELLOW: 1, GREEN: 2 };

export async function GET(request: NextRequest) {
    const auth = await verifyMentorOrAdmin();
    if (!auth.authorized) return auth.response;

    let socios;
    if (auth.session.role === 'admin') {
        // Platform admin is the one legitimate cross-tenant reader.
        socios = await repo.getSociosAcrossAllOrganizations();
    } else {
        // Mentors are scoped to their own organization. A mentor with no
        // MentorProfile has no resolvable tenant, so they see nothing — never
        // an unscoped fallback.
        const organizationId = await tenantRepo.getOrganizationIdByMentorId(auth.session.userId);
        socios = organizationId
            ? await tenantRepo.getSociosForMentor(organizationId, auth.session.userId)
            : [];
    }

    const results = await Promise.all(
        socios.map(async (socio) => {
            const [health, progress, lessonProgress] = await Promise.all([
                computeSocioHealth(socio.id),
                repo.getSocioProgress(socio.id),
                repo.getLessonProgressAll(socio.id),
            ]);
            return {
                id: socio.id,
                name: socio.name,
                channelType: socio.channelType,
                language: socio.language,
                health,
                currentLesson: progress.currentLessonNumber,
                completedLessons: progress.completedLessons.length,
                lastInteractionAt: progress.lastInteractionAt,
                lessonProgressCount: lessonProgress.length,
            };
        })
    );

    results.sort((a, b) => (HEALTH_ORDER[a.health.status] ?? 2) - (HEALTH_ORDER[b.health.status] ?? 2));

    return NextResponse.json(results);
}
