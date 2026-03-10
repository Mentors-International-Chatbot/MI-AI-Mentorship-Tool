import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { computeSocioHealth } from '@/lib/health';
import { requireMentorAuth } from '@/lib/auth/mentorAuth';

const HEALTH_ORDER: Record<string, number> = { RED: 0, YELLOW: 1, GREEN: 2 };

export async function GET(request: NextRequest) {
    const authError = requireMentorAuth(request);
    if (authError) return authError;

    const socios = await repo.getAllSocios();

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
