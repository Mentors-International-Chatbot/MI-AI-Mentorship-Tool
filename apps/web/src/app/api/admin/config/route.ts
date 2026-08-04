import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { invalidateConfigCache } from '@/lib/config/service';
import { requireCourseConfigurer } from '@/lib/auth/adminGuard';
import { canWriteScope, writableScopesFor } from '@/lib/auth/courseScope';

/**
 * Program configuration, scoped.
 *
 * `?collectionKey=` selects a course. Rows come back with an `inherited` flag
 * so the editor can show that a value is coming from the platform tier rather
 * than pretending the course set it. Omitting the parameter reads the platform
 * tier, which is what every caller did before scoping existed.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCourseConfigurer();
  if (!auth.authorized) return auth.response;

  const collectionKey = request.nextUrl.searchParams.get('collectionKey');
  const scopes = await writableScopesFor(auth.session);

  // A course lead may only read a course they own. Returning 403 rather than an
  // empty list keeps "you may not see this" distinct from "this has no config".
  const selected = collectionKey ? scopes.find((s) => s.collectionKey === collectionKey) : null;
  if (collectionKey && !selected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const platformRows = await prisma.programConfig.findMany({
    where: { organizationId: null, collectionKey: null },
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  });

  const overrides = selected
    ? await prisma.programConfig.findMany({
        where: {
          organizationId: selected.organizationId,
          collectionKey: selected.collectionKey,
        },
      })
    : [];

  const overrideByKey = new Map(overrides.map((r) => [r.key, r]));

  // Platform rows define which keys exist; a course override replaces the value
  // but never introduces a key of its own, so the editor cannot drift into
  // showing settings nothing reads.
  const rows = platformRows.map((base) => {
    const override = overrideByKey.get(base.key);
    return {
      ...base,
      value: override?.value ?? base.value,
      inherited: !override,
      collectionKey: selected?.collectionKey ?? null,
    };
  });

  return NextResponse.json({ rows, courses: scopes, selectedCourse: selected ?? null });
}

export async function PUT(request: NextRequest) {
  const auth = await requireCourseConfigurer();
  if (!auth.authorized) return auth.response;

  const body = await request.json();
  const { key, value, collectionKey } = body as {
    key: string;
    value: string;
    collectionKey?: string | null;
  };

  if (!key || value === undefined) {
    return NextResponse.json({ error: 'key and value required' }, { status: 400 });
  }

  // Resolve the organization from the course rather than trusting the client:
  // a caller must not be able to name someone else's org in the request body.
  const scopes = await writableScopesFor(auth.session);
  const target = collectionKey ? scopes.find((s) => s.collectionKey === collectionKey) : null;
  if (collectionKey && !target) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const scope = target
    ? { organizationId: target.organizationId, collectionKey: target.collectionKey }
    : { organizationId: null, collectionKey: null };

  // Writing the platform tier is admin-only — it is what every course inherits.
  if (!(await canWriteScope(auth.session, scope))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // The key must already exist at the platform tier. Course overrides shadow a
  // known setting; they do not invent new ones.
  const base = await prisma.programConfig.findFirst({
    where: { key, organizationId: null, collectionKey: null },
  });
  if (!base) {
    return NextResponse.json({ error: `Unknown config key: ${key}` }, { status: 400 });
  }

  // Not `upsert`: Prisma cannot target a compound unique whose columns are
  // nullable, and both scope columns are. The find-then-write below has a
  // theoretical race between two concurrent writers, which the
  // `program_config_scope_key` index (NULLS NOT DISTINCT) rejects rather than
  // duplicating — the database is the real guard here, not this read.
  const existing = await prisma.programConfig.findFirst({
    where: {
      key,
      organizationId: scope.organizationId,
      collectionKey: scope.collectionKey,
    },
    select: { id: true },
  });

  const updated = existing
    ? await prisma.programConfig.update({
        where: { id: existing.id },
        data: { value: String(value), updatedBy: auth.session.userId },
      })
    : await prisma.programConfig.create({
        data: {
          key,
          value: String(value),
          // Metadata comes from the platform row so an override cannot drift
          // into a different label, type, or category than the setting it shadows.
          type: base.type,
          label: base.label,
          description: base.description,
          category: base.category,
          organizationId: scope.organizationId,
          collectionKey: scope.collectionKey,
          updatedBy: auth.session.userId,
        },
      });

  await prisma.auditLog.create({
    data: {
      actorId: auth.session.userId,
      action: 'changed_config',
      targetType: 'program_config',
      targetId: key,
      metadata: {
        newValue: value,
        organizationId: scope.organizationId,
        collectionKey: scope.collectionKey,
      },
    },
  });

  invalidateConfigCache();

  return NextResponse.json(updated);
}

/** Removes a course override so the setting falls back to the platform value. */
export async function DELETE(request: NextRequest) {
  const auth = await requireCourseConfigurer();
  if (!auth.authorized) return auth.response;

  const key = request.nextUrl.searchParams.get('key');
  const collectionKey = request.nextUrl.searchParams.get('collectionKey');
  if (!key || !collectionKey) {
    return NextResponse.json({ error: 'key and collectionKey required' }, { status: 400 });
  }

  const scopes = await writableScopesFor(auth.session);
  const target = scopes.find((s) => s.collectionKey === collectionKey);
  if (!target) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await prisma.programConfig.deleteMany({
    where: { key, organizationId: target.organizationId, collectionKey: target.collectionKey },
  });

  await prisma.auditLog.create({
    data: {
      actorId: auth.session.userId,
      action: 'changed_config',
      targetType: 'program_config',
      targetId: key,
      metadata: { reverted: true, collectionKey: target.collectionKey },
    },
  });

  invalidateConfigCache();
  return NextResponse.json({ success: true });
}
