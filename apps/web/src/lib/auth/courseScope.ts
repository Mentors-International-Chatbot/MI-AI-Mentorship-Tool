/**
 * Which courses a caller may configure.
 * ═══════════════════════════════════════════════════════════════════════════
 * `requireCourseConfigurer` establishes that a caller may configure *something*.
 * This decides *what*. The split matters: a role check alone would let any
 * course lead rewrite another course's prompts, which is exactly the failure
 * this whole change exists to prevent.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from '@/lib/db';
import type { SessionPayload } from '@/lib/auth/session';
import type { ConfigScope } from '@/lib/ai/prompts/scope';

export type WritableScope = {
  organizationId: string;
  collectionKey: string;
  programId: string;
  /** ContentCollection.name, for the course picker. */
  displayName: string;
};

/**
 * Every course the caller may write to.
 *
 * Admins get every course on the platform. A course lead gets the collections
 * reachable from their `ProgramMembership` rows — program → versions →
 * collection. A user with no memberships gets an empty list and can therefore
 * write nothing, which is the correct fail-closed answer rather than an error.
 */
export async function writableScopesFor(session: SessionPayload): Promise<WritableScope[]> {
  if (session.role === 'admin') {
    const collections = await prisma.contentCollection.findMany({
      select: { slug: true, name: true, organizationId: true },
    });
    // Admins are not program-bound, so programId is informational here: the
    // first program in the same org, or the org id when none exists yet.
    const programs = await prisma.program.findMany({
      select: { id: true, organizationId: true },
    });
    const programByOrg = new Map(programs.map((p) => [p.organizationId, p.id]));
    return collections.map((c) => ({
      organizationId: c.organizationId,
      collectionKey: c.slug,
      programId: programByOrg.get(c.organizationId) ?? c.organizationId,
      displayName: c.name,
    }));
  }

  if (session.role !== 'course_lead') return [];

  const memberships = await prisma.programMembership.findMany({
    where: { userId: session.userId },
    select: {
      programId: true,
      program: {
        select: {
          organizationId: true,
          versions: {
            select: { collection: { select: { slug: true, name: true } } },
          },
        },
      },
    },
  });

  const seen = new Set<string>();
  const scopes: WritableScope[] = [];
  for (const m of memberships) {
    for (const v of m.program.versions) {
      if (!v.collection) continue;
      // One collection can back several versions of the same program; the
      // course is the unit of configuration, so collapse them.
      const dedupeKey = `${m.program.organizationId}:${v.collection.slug}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      scopes.push({
        organizationId: m.program.organizationId,
        collectionKey: v.collection.slug,
        programId: m.programId,
        displayName: v.collection.name,
      });
    }
  }
  return scopes;
}

/**
 * Whether `scope` is one the caller may write to.
 *
 * The platform tier (`organizationId` and `collectionKey` both absent) is
 * admin-only by construction: it is the value every course inherits, so a
 * course lead editing it would reach past their own course into everyone
 * else's — the precise thing course scoping is for.
 */
export async function canWriteScope(
  session: SessionPayload,
  scope: ConfigScope,
): Promise<boolean> {
  const org = scope.organizationId ?? null;
  const collection = scope.collectionKey ?? null;

  if (!org || !collection) return session.role === 'admin';
  if (session.role === 'admin') return true;

  const scopes = await writableScopesFor(session);
  return scopes.some((s) => s.organizationId === org && s.collectionKey === collection);
}
