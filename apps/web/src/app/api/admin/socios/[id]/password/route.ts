import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { requireSystemAdmin } from '@/lib/auth/adminGuard';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSystemAdmin();
  if (!auth.authorized) return auth.response;

  const { id } = await params;
  const { password } = await req.json();

  if (!password || password.length < 6) {
    return NextResponse.json(
      { error: 'Password must be at least 6 characters' },
      { status: 400 },
    );
  }

  const hash = await hashPassword(password);
  const socio = await prisma.socio.update({
    where: { id },
    data: { passwordHash: hash },
  });

  // An action that can take over an account must leave a trace. Before this,
  // a successful password change wrote nothing to audit_log and nothing to any
  // other durable store, so the only record was Vercel function logs and their
  // retention window — which is exactly why "was this endpoint ever abused
  // while it was unguarded?" is a question nobody can now answer.
  //
  // Never log the password or its hash: the point is who did what to whom and
  // when, not the credential itself.
  await prisma.auditLog.create({
    data: {
      actorId: auth.session.userId,
      action: 'changed_socio_password',
      targetType: 'socio',
      targetId: socio.id,
      metadata: { actorRole: auth.session.role },
    },
  });

  return NextResponse.json({ success: true, socioId: socio.id });
}
