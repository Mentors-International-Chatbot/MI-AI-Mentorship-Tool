import { NextRequest, NextResponse } from 'next/server';

export function requireMentorAuth(request: NextRequest): NextResponse | null {
    const key = process.env.MENTOR_API_KEY;
    if (!key) return null; // dev mode: no key configured, allow access

    const authHeader = request.headers.get('authorization');
    if (authHeader === `Bearer ${key}`) return null;

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
