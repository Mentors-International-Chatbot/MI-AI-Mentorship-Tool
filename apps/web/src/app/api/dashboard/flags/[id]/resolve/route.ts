import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { verifyMentorOrAdmin } from '@/lib/auth/ownership';
import { prisma } from '@/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await verifyMentorOrAdmin();
  if (!auth.authorized) return auth.response;

  // For mentors, verify the flag belongs to one of their socios
  if (auth.session.role === 'mentor') {
    const flag = await prisma.socioFlag.findUnique({
      where: { id },
      include: { socio: { select: { mentorId: true } } },
    });
    if (!flag || flag.socio.mentorId !== auth.session.userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  const flag = await repo.resolveFlag(id, auth.session.userId);
  return NextResponse.json(flag);
}
