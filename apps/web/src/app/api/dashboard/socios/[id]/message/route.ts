import { NextRequest, NextResponse } from 'next/server';
import { verifyMentorOwnership } from '@/lib/auth/ownership';
import { sendMentorMessage } from '@/lib/mentor/sendMentorMessage';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: socioId } = await params;

  const auth = await verifyMentorOwnership(socioId);
  if (!auth.authorized) return auth.response;

  const { content } = (await req.json()) as { content?: string };

  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  try {
    const result = await sendMentorMessage(socioId, content.trim());
    return NextResponse.json({ success: true, ...result });
  } catch {
    return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
  }
}
