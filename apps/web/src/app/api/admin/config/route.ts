import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { invalidateConfigCache } from '@/lib/config/service';

export async function GET() {
  const rows = await prisma.programConfig.findMany({
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  });
  return NextResponse.json(rows);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { key, value } = body as { key: string; value: string };

  if (!key || value === undefined) {
    return NextResponse.json({ error: 'key and value required' }, { status: 400 });
  }

  const updated = await prisma.programConfig.update({
    where: { key },
    data: { value: String(value), updatedBy: 'admin' },
  });

  // Log the change
  await prisma.auditLog.create({
    data: {
      actorId: 'admin',
      action: 'changed_config',
      targetType: 'program_config',
      targetId: key,
      metadata: { newValue: value },
    },
  });

  invalidateConfigCache();

  return NextResponse.json(updated);
}
