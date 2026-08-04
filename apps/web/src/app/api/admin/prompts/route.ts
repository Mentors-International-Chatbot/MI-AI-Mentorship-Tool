import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireCourseConfigurer } from '@/lib/auth/adminGuard';
import { canWriteScope, writableScopesFor } from '@/lib/auth/courseScope';
import { PROMPT_CATEGORY_KEYS, getPromptCategoryMeta } from '@/lib/ai/prompts/categories';
import type { SessionPayload } from '@/lib/auth/session';

/**
 * Resolves the scope a request is targeting, or an error response.
 *
 * `collectionKey` absent means the platform tier, which only an admin may
 * write. The organization is always derived from the caller's own writable
 * scopes, never read from the request body — otherwise a course lead could
 * name another tenant's organization and write into it.
 */
async function resolveTargetScope(
  session: SessionPayload,
  collectionKey: string | null | undefined,
): Promise<
  | { ok: true; organizationId: string | null; collectionKey: string | null }
  | { ok: false; response: NextResponse }
> {
  if (!collectionKey) {
    if (session.role !== 'admin') {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Only an administrator may edit platform-wide prompts.' },
          { status: 403 },
        ),
      };
    }
    return { ok: true, organizationId: null, collectionKey: null };
  }

  const scopes = await writableScopesFor(session);
  const target = scopes.find((s) => s.collectionKey === collectionKey);
  if (!target) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, organizationId: target.organizationId, collectionKey: target.collectionKey };
}

export async function GET(request: NextRequest) {
  const auth = await requireCourseConfigurer();
  if (!auth.authorized) return auth.response;

  const category = request.nextUrl.searchParams.get('category');
  const collectionKey = request.nextUrl.searchParams.get('collectionKey');
  const scopes = await writableScopesFor(auth.session);

  const selected = collectionKey ? scopes.find((s) => s.collectionKey === collectionKey) : null;
  if (collectionKey && !selected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const prompts = await prisma.systemPrompt.findMany({
    where: {
      ...(category ? { category } : {}),
      ...(selected
        ? { organizationId: selected.organizationId, collectionKey: selected.collectionKey }
        : { organizationId: null, collectionKey: null }),
    },
    orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
  });

  return NextResponse.json({ prompts, courses: scopes, selectedCourse: selected ?? null });
}

export async function POST(request: NextRequest) {
  const auth = await requireCourseConfigurer();
  if (!auth.authorized) return auth.response;

  const body = await request.json();
  const { version, content, category, collectionKey } = body as {
    version: string;
    content: string;
    category: string;
    collectionKey?: string | null;
  };

  if (!version || !content || !category) {
    return NextResponse.json(
      { error: 'version, content, and category are required' },
      { status: 400 },
    );
  }

  // Rejecting unknown categories here is what stops the drift that let the
  // admin UI offer `onboarding` for months while nothing ever read it.
  if (!PROMPT_CATEGORY_KEYS.has(category)) {
    return NextResponse.json(
      { error: `Unknown prompt category: ${category}` },
      { status: 400 },
    );
  }

  const meta = getPromptCategoryMeta(category);
  if (meta?.scope === 'platform' && auth.session.role !== 'admin') {
    return NextResponse.json(
      { error: `"${meta.label}" is platform-wide and may only be edited by an administrator.` },
      { status: 403 },
    );
  }

  const target = await resolveTargetScope(auth.session, collectionKey);
  if (!target.ok) return target.response;

  const prompt = await prisma.systemPrompt.create({
    data: {
      version,
      content,
      category,
      active: false,
      authorId: auth.session.userId,
      organizationId: target.organizationId,
      collectionKey: target.collectionKey,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: auth.session.userId,
      action: 'created_prompt',
      targetType: 'system_prompt',
      targetId: prompt.id,
      metadata: { version, category, collectionKey: target.collectionKey },
    },
  });

  return NextResponse.json(prompt, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const auth = await requireCourseConfigurer();
  if (!auth.authorized) return auth.response;

  const body = await request.json();
  const { id, active } = body as { id: string; active: boolean };

  if (!id || active === undefined) {
    return NextResponse.json({ error: 'id and active required' }, { status: 400 });
  }

  const target = await prisma.systemPrompt.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: 'prompt not found' }, { status: 404 });
  }

  // Authorize against the row's own scope, not anything the client supplied.
  const allowed = await canWriteScope(auth.session, {
    organizationId: target.organizationId,
    collectionKey: target.collectionKey,
  });
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (active) {
    // Deactivate siblings in the SAME SCOPE only. Matching on category alone
    // would switch off the platform default and every other course's prompt
    // the moment one course activated theirs.
    await prisma.systemPrompt.updateMany({
      where: {
        category: target.category,
        active: true,
        organizationId: target.organizationId,
        collectionKey: target.collectionKey,
      },
      data: { active: false },
    });
  }

  const updated = await prisma.systemPrompt.update({ where: { id }, data: { active } });

  await prisma.auditLog.create({
    data: {
      actorId: auth.session.userId,
      action: active ? 'activated_prompt' : 'deactivated_prompt',
      targetType: 'system_prompt',
      targetId: id,
      metadata: {
        category: updated.category,
        version: updated.version,
        collectionKey: updated.collectionKey,
      },
    },
  });

  return NextResponse.json(updated);
}
