import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { computeSocioHealth } from '@/lib/health';
import { requireMentorAuth } from '@/lib/auth/mentorAuth';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = requireMentorAuth(request);
    if (authError) return authError;

    const { id } = await params;
    const socio = await repo.getSocioById(id);
    if (!socio) {
        return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
    }

    const [health, progress, flags, lessonProgress, messages] = await Promise.all([
        computeSocioHealth(id),
        repo.getSocioProgress(id),
        repo.getFlags(id),
        repo.getLessonProgressAll(id),
        repo.getMessages(id, 50),
    ]);

    return NextResponse.json({
        socio,
        health,
        progress,
        flags,
        lessonProgress,
        messages,
    });
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = requireMentorAuth(request);
    if (authError) return authError;

    const { id } = await params;
    const socio = await repo.getSocioById(id);
    if (!socio) {
        return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
    }

    const body = await request.json();
    const currentOverrides = (socio.promptOverrides ?? {}) as Record<string, unknown>;
    const newOverrides = { ...currentOverrides };

    if (body.complexity !== undefined) newOverrides.complexity = body.complexity;
    if (body.warmth !== undefined) newOverrides.warmth = body.warmth;
    if (body.positivity !== undefined) newOverrides.positivity = body.positivity;
    if (body.toneOverride !== undefined) newOverrides.toneOverride = body.toneOverride;

    const updated = await repo.updateSocio(id, { promptOverrides: newOverrides });

    return NextResponse.json({ socio: updated });
}
