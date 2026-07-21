import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';
import { repo } from '@/lib/repo';
import { resolveCourseCode, getAvailableCourseCodes, getAvailableCourses } from '@/lib/courses/resolver';

export const dynamic = 'force-dynamic';

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

    await repo.setSocioCurriculum(socio.id, collectionKey);

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
