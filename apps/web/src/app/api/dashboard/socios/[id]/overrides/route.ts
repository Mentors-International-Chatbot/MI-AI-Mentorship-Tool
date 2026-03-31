import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { verifyMentorOwnership } from '@/lib/auth/ownership';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await verifyMentorOwnership(id);
  if (!auth.authorized) return auth.response;

  const body = await req.json();

  const socio = await repo.getSocioById(id);
  if (!socio) {
    return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
  }

  // Merge with existing overrides (don't replace entirely)
  const existing = (socio.promptOverrides ?? {}) as Record<string, unknown>;
  const merged = { ...existing, ...body };

  const updated = await repo.updateSocio(id, { promptOverrides: merged });
  return NextResponse.json({ promptOverrides: updated.promptOverrides });
}
