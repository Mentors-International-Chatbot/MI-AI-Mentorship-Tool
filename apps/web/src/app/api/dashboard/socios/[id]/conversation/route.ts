import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyMentorOwnership } from '@/lib/auth/ownership';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: socioId } = await params;

  const auth = await verifyMentorOwnership(socioId);
  if (!auth.authorized) return auth.response;

  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 50);

  const messages = await prisma.message.findMany({
    where: { socioId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      sentiment: {
        select: {
          confusion: true,
          frustration: true,
          urgency: true,
          sentiment: true,
        },
      },
    },
  });

  return NextResponse.json({
    messages: messages.reverse().map((m) => ({
      id: m.id,
      role: m.role,
      senderType: m.senderType,
      content: m.content,
      createdAt: m.createdAt,
      sentiment: m.sentiment ?? undefined,
    })),
  });
}
