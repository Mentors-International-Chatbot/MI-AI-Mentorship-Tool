/**
 * Two behaviors added alongside L1.b: the sliding refresh resolves the
 * session's current Principal and writes its id into the re-signed token
 * (so an actively-used claim-less session picks one up within days, not the
 * full 90-day absolute cap), and a `PrincipalNotFoundError` from that
 * resolution — the identity is genuinely gone, not a transient hiccup —
 * surfaces as a cleared cookie + redirect to /login, never an uncaught 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';

const mocks = vi.hoisted(() => ({
  resolvePrincipalForSession: vi.fn(),
}));

class PrincipalNotFoundError extends Error {
  constructor(principalId: string) {
    super(`Principal ${principalId} referenced by session not found`);
    this.name = 'PrincipalNotFoundError';
  }
}

vi.mock('@/lib/auth/principal', () => ({
  resolvePrincipalForSession: mocks.resolvePrincipalForSession,
  PrincipalNotFoundError,
}));

const { proxy } = await import('../proxy');
const {
  COOKIE_NAME,
  SECRET,
  SESSION_DEFAULT_MAX_AGE,
  SESSION_REFRESH_THRESHOLD,
  nowSeconds,
  signSessionToken,
} = await import('@/lib/auth/token');

function requestWithSessionCookie(token: string, pathname = '/dashboard/learners') {
  const req = new NextRequest(new URL(`http://localhost${pathname}`));
  req.cookies.set(COOKIE_NAME, token);
  return req;
}

/**
 * A token whose remaining lifetime is inside the refresh window (< 50% of
 * maxAge left) but nowhere near the 90-day absolute cap. `signSessionToken`
 * always computes a fresh `exp` from "now", so hitting the refresh window
 * requires signing the JWT directly with an explicit near-future `exp`
 * rather than going through it.
 */
async function refreshDueToken() {
  const now = nowSeconds();
  const remaining = Math.floor(SESSION_DEFAULT_MAX_AGE * (SESSION_REFRESH_THRESHOLD - 0.1)); // ~40% left
  const issuedSecondsAgo = SESSION_DEFAULT_MAX_AGE - remaining;

  return new SignJWT({
    userId: 'mentor-1',
    role: 'mentor',
    name: 'Rosa',
    rememberMe: false,
    sessionStart: now - issuedSecondsAgo,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now - issuedSecondsAgo)
    .setExpirationTime(now + remaining)
    .sign(SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('proxy: refresh writes a resolved principalId', () => {
  it('signs the refreshed cookie with the id resolvePrincipalForSession returns', async () => {
    mocks.resolvePrincipalForSession.mockResolvedValue({ id: 'principal-resolved' });

    const token = await refreshDueToken();
    const req = requestWithSessionCookie(token);

    const res = await proxy(req);

    const refreshed = res.cookies.get(COOKIE_NAME)?.value;
    expect(refreshed).toBeDefined();
    const { verifyToken } = await import('@/lib/auth/token');
    const verified = await verifyToken(refreshed!);
    expect(verified?.principalId).toBe('principal-resolved');
  });
});

describe('proxy: PrincipalNotFoundError surfaces as re-authenticate', () => {
  it('clears the cookie and redirects to /login instead of throwing', async () => {
    mocks.resolvePrincipalForSession.mockRejectedValue(new PrincipalNotFoundError('ghost-id'));

    const token = await refreshDueToken();
    const req = requestWithSessionCookie(token, '/dashboard/learners');

    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    const cleared = res.cookies.get(COOKIE_NAME);
    expect(cleared?.value === '' || cleared === undefined).toBe(true);
  });

  it('other resolution failures stay non-fatal and keep serving the existing cookie', async () => {
    mocks.resolvePrincipalForSession.mockRejectedValue(new Error('Neon connection reset'));

    const token = await refreshDueToken();
    const req = requestWithSessionCookie(token);

    const res = await proxy(req);

    // Not a redirect-to-login, not a thrown error — the request proceeds.
    expect(res.status).not.toBe(307);
  });
});

describe("proxy: /login stays public regardless of session (no redirect loop, no resurrected dead branch)", () => {
  it('passes an authenticated visit to /login straight through — the already-authenticated bounce-away lives in login/page.tsx, not here', async () => {
    const token = await signSessionToken({
      userId: 'admin-1',
      role: 'admin',
      name: 'Rosa',
      rememberMe: false,
      sessionStart: nowSeconds(),
    });
    const req = requestWithSessionCookie(token, '/login');

    const res = await proxy(req);

    // Not a redirect at all: /login is unconditionally public, checked
    // before the session is even read. A prior version had a second,
    // session-aware redirect written after that early return — dead code,
    // since it could never run — removed at L1.e rather than "fixed",
    // since the real enforcement already lives correctly in login/page.tsx
    // and a middleware-level duplicate would just be a second mechanism for
    // the same idea, waiting to drift again.
    expect(res.status).toBe(200);
  });

  it('passes an unauthenticated visit to /login straight through too — this is what removing it from PUBLIC_PATHS would break', async () => {
    const req = new NextRequest(new URL('http://localhost/login'));

    const res = await proxy(req);

    expect(res.status).toBe(200);
  });
});
