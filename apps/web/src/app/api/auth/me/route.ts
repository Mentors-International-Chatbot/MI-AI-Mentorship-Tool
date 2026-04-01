import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';
import { repo } from '@/lib/repo';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let language = 'es';
  if (session.role === 'socio') {
    const socio = await repo.getSocio('web', session.userId);
    if (socio) {
      language = socio.language || 'es';
    }
  } else {
    language = 'en';
  }

  return NextResponse.json({
    userId: session.userId,
    name: session.name,
    role: session.role,
    language,
  });
}
