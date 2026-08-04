import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/adminGuard';

type UserRow = {
  id: string;
  name: string | null;
  identifier: string;
  role: string;
  hasPassword: boolean;
  createdAt: string;
};

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const [mentors, socios] = await Promise.all([
    prisma.mentor.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        passwordHash: true,
        createdAt: true,
      },
    }),
    prisma.socio.findMany({
      where: { passwordHash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        whatsappPhoneNumber: true,
        externalId: true,
        passwordHash: true,
        createdAt: true,
      },
    }),
  ]);

  const users: UserRow[] = [
    ...mentors.map((m) => ({
      id: m.id,
      name: m.name,
      identifier: m.email,
      role: m.role,
      hasPassword: !!m.passwordHash,
      createdAt: m.createdAt.toISOString(),
    })),
    ...socios.map((s) => ({
      id: s.id,
      name: s.name,
      identifier: s.whatsappPhoneNumber ?? s.externalId,
      role: 'socio',
      hasPassword: !!s.passwordHash,
      createdAt: s.createdAt.toISOString(),
    })),
  ];

  users.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json(users);
}
