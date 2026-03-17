import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get('category');

  const where = category ? { category } : {};
  const prompts = await prisma.systemPrompt.findMany({
    where,
    orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
  });

  return NextResponse.json(prompts);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { version, content, category } = body as {
    version: string;
    content: string;
    category: string;
  };

  if (!version || !content || !category) {
    return NextResponse.json(
      { error: 'version, content, and category are required' },
      { status: 400 },
    );
  }

  const prompt = await prisma.systemPrompt.create({
    data: {
      version,
      content,
      category,
      active: false,
      authorId: 'admin',
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: 'admin',
      action: 'created_prompt',
      targetType: 'system_prompt',
      targetId: prompt.id,
      metadata: { version, category },
    },
  });

  return NextResponse.json(prompt, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, active } = body as { id: string; active: boolean };

  if (!id || active === undefined) {
    return NextResponse.json({ error: 'id and active required' }, { status: 400 });
  }

  // If activating, deactivate all others in the same category first
  if (active) {
    const target = await prisma.systemPrompt.findUnique({ where: { id } });
    if (!target) {
      return NextResponse.json({ error: 'prompt not found' }, { status: 404 });
    }

    await prisma.systemPrompt.updateMany({
      where: { category: target.category, active: true },
      data: { active: false },
    });
  }

  const updated = await prisma.systemPrompt.update({
    where: { id },
    data: { active },
  });

  await prisma.auditLog.create({
    data: {
      actorId: 'admin',
      action: active ? 'activated_prompt' : 'deactivated_prompt',
      targetType: 'system_prompt',
      targetId: id,
      metadata: { category: updated.category, version: updated.version },
    },
  });

  return NextResponse.json(updated);
}
