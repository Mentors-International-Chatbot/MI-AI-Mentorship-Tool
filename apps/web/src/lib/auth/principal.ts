/**
 * L1.a (Auth & Login Restructure) — Principal resolvers.
 *
 * `Principal` is the stable identity a session ultimately resolves to,
 * independent of which provider authenticated it. Two resolvers, two
 * different callers:
 *
 * - `findOrCreatePrincipal` — login-time. Every provider (password today;
 *   LTI/CAS once L1.b/c land) calls this after it has independently
 *   verified the caller's identity, to get-or-create the Principal that
 *   identity maps to and mint a session carrying its id.
 * - `resolvePrincipalForSession` — request-time. Given a verified session,
 *   returns the Principal it identifies. See that function's own comment
 *   for the explicit "resolve on the fly vs. invalidate at cutover"
 *   decision — this file does not merely implement both options, it picks
 *   one.
 */
import { prisma } from '@/lib/db';
import type { SessionRole } from './token';

export type PrincipalProvider = 'password' | 'lti' | 'cas';
export type PrincipalStatus = 'PENDING' | 'ACTIVE';

export type PrincipalRecord = {
  id: string;
  provider: PrincipalProvider;
  subject: string;
  role: SessionRole;
  status: PrincipalStatus;
  socioId: string | null;
  mentorId: string | null;
};

/**
 * A session claims a `principalId` that no longer resolves — a deleted row,
 * or (now that migrations take a Neon branch snapshot first) a database
 * restored to a point before the row was created. Distinguished from other
 * failures so a caller can tell "this identity is gone, re-authenticate"
 * apart from a transient DB error, which should not force a logout. The
 * request boundary (`src/proxy.ts`) is where this becomes a redirect to
 * `/login` with the cookie cleared, not a 500 — every active session would
 * otherwise land on an error page it can't navigate out of, and precisely
 * during the kind of incident (a restore) where that's worst.
 */
export class PrincipalNotFoundError extends Error {
  constructor(principalId: string) {
    super(`Principal ${principalId} referenced by session not found`);
    this.name = 'PrincipalNotFoundError';
  }
}

function toPrincipalRecord(row: {
  id: string;
  provider: string;
  subject: string;
  role: string;
  status: string;
  socioId: string | null;
  mentorId: string | null;
}): PrincipalRecord {
  return {
    id: row.id,
    provider: row.provider as PrincipalProvider,
    subject: row.subject,
    role: row.role as SessionRole,
    status: row.status as PrincipalStatus,
    socioId: row.socioId,
    mentorId: row.mentorId,
  };
}

/**
 * Login-time resolver. Idempotent: the same (provider, subject) always
 * resolves to the same row — callers do not need to check for an existing
 * Principal before calling this, and calling it twice for the same identity
 * is always safe.
 *
 * Exactly one of socioId/mentorId is expected, matching the account the
 * caller just authenticated (mirrors LtiIdentity's existing socioId/mentorId
 * shape rather than inventing a second convention for the same idea).
 */
export async function findOrCreatePrincipal(input: {
  provider: PrincipalProvider;
  subject: string;
  role: SessionRole;
  socioId?: string;
  mentorId?: string;
  status?: PrincipalStatus;
}): Promise<PrincipalRecord> {
  const existing = await prisma.principal.findUnique({
    where: { provider_subject: { provider: input.provider, subject: input.subject } },
  });
  if (existing) return toPrincipalRecord(existing);

  const created = await prisma.principal.create({
    data: {
      provider: input.provider,
      subject: input.subject,
      role: input.role,
      status: input.status ?? 'ACTIVE',
      socioId: input.socioId ?? null,
      mentorId: input.mentorId ?? null,
    },
  });
  return toPrincipalRecord(created);
}

/**
 * Session-time resolver.
 *
 * DECISION (2026-09-08): resolve on the fly, not invalidate at cutover.
 *
 * A claim-less session (issued before `principalId` existed — up to 90 days
 * live, per SESSION_ABSOLUTE_CAP in token.ts) is never ambiguous: it already
 * carries `userId` + `role` from a password login, the only provider that
 * exists today. It backfills deterministically to a `provider: "password"`
 * Principal keyed on that userId — the same identity every time, via the
 * (provider, subject) unique constraint. Forcing every mentor/admin/socio
 * with a live session to re-login the moment this ships would be a real,
 * user-visible disruption for an internal identity-model change nobody
 * asked for; that cost isn't justified before a second provider (LTI/CAS)
 * even exists to make the old path's absence load-bearing.
 *
 * This is deliberately NOT the "fall back forever" trap the alternative
 * risks: the fallback is a single deterministic upsert, not a parallel
 * identity path that can silently diverge from the real one, and it is not
 * meant to be how sessions carry identity going forward. From L1.b onward,
 * every *new* login goes through `findOrCreatePrincipal` at issuance and
 * signs `principalId` directly into the token, so the `else` branch below
 * only runs for tokens signed before that point — and even those stop
 * needing it within days, not the full 90-day absolute cap: `proxy.ts`'s
 * sliding refresh calls this resolver on every refresh cycle and writes the
 * result into the re-signed token via `refreshedPayload`, so an actively-
 * used claim-less session acquires a real `principalId` at its first
 * refresh rather than waiting for a fresh login. Nobody needs to remember
 * to delete this branch on a deadline, unlike an unbounded fallback would
 * require.
 *
 * A `principalId` claim that fails to resolve throws `PrincipalNotFoundError`
 * rather than falling through to re-derive: re-deriving would silently mint
 * a second Principal for the same account, masking a bug (a deleted Principal, or a token forged
 * against a different environment's ids) instead of surfacing it.
 */
export async function resolvePrincipalForSession(session: {
  principalId?: string;
  userId: string;
  role: SessionRole;
}): Promise<PrincipalRecord> {
  if (session.principalId) {
    const byId = await prisma.principal.findUnique({ where: { id: session.principalId } });
    if (!byId) {
      throw new PrincipalNotFoundError(session.principalId);
    }
    return toPrincipalRecord(byId);
  }

  return findOrCreatePrincipal({
    provider: 'password',
    subject: session.userId,
    role: session.role,
    socioId: session.role === 'socio' ? session.userId : undefined,
    mentorId: session.role !== 'socio' ? session.userId : undefined,
  });
}
