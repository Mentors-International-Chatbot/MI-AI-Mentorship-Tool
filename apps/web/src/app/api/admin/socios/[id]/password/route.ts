import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  return NextResponse.json({ success: true, socioId: socio.id });
}
