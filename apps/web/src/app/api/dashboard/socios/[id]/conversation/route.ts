import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { verifyMentorOwnership } from '@/lib/auth/ownership';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: socioId } = await params;

  const auth = await verifyMentorOwnership(socioId);
  if (!auth.authorized) return auth.response;

  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 50);
  const since = req.nextUrl.searchParams.get('since');

  const messages = await repo.getMessagesWithSentiment(socioId, {
    limit,
    since: since ? new Date(since) : undefined,
  });

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      senderType: m.senderType,
      content: m.content,
      createdAt: m.createdAt,
      sentiment: m.sentiment ?? undefined,
    })),
  });
}
