import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';

export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    ...session,
  });
}
