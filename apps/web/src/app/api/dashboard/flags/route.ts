import { NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { verifyMentorOrAdmin } from '@/lib/auth/ownership';

export async function GET() {
  const auth = await verifyMentorOrAdmin();
  if (!auth.authorized) return auth.response;

  const flags = auth.session.role === 'admin'
    ? await repo.getAllUnresolvedFlags()
    : await repo.getUnresolvedFlagsByMentor(auth.session.userId);

  return NextResponse.json({ flags });
}
