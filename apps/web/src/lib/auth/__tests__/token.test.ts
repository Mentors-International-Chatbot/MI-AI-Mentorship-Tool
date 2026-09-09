import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import {
  SECRET,
  SESSION_ABSOLUTE_CAP,
  SESSION_DEFAULT_MAX_AGE,
  SESSION_REMEMBER_MAX_AGE,
  cookieOptions,
  isPastAbsoluteCap,
  refreshedPayload,
  sessionMaxAge,
  shouldRefresh,
  signSessionToken,
  verifyToken,
  type VerifiedSession,
} from '../token';

const DAY = 60 * 60 * 24;
const NOW = 1_800_000_000;

function session(overrides: Partial<VerifiedSession> = {}): VerifiedSession {
  return {
    userId: 'socio-1',
    role: 'socio',
    name: 'Ana',
    rememberMe: false,
    sessionStart: NOW,
    iat: NOW,
    exp: NOW + SESSION_DEFAULT_MAX_AGE,
    ...overrides,
  };
}

describe('sessionMaxAge', () => {
  it('is 7 days by default and 30 days when remembered', () => {
    expect(SESSION_DEFAULT_MAX_AGE).toBe(7 * DAY);
    expect(SESSION_REMEMBER_MAX_AGE).toBe(30 * DAY);
    expect(sessionMaxAge(false)).toBe(7 * DAY);
    expect(sessionMaxAge(undefined)).toBe(7 * DAY);
    expect(sessionMaxAge(true)).toBe(30 * DAY);
  });
});

describe('shouldRefresh', () => {
  it('is false before the halfway point of the lifetime', () => {
    // 3 days into a 7-day session — 4 days remain, more than half.
    expect(shouldRefresh(session(), NOW + 3 * DAY)).toBe(false);
  });

  it('is true past the halfway point of the lifetime', () => {
    // 4 days into a 7-day session — 3 days remain, less than half.
    expect(shouldRefresh(session(), NOW + 4 * DAY)).toBe(true);
  });

  it('uses the remembered lifetime for remembered sessions', () => {
    const remembered = session({
      rememberMe: true,
      exp: NOW + SESSION_REMEMBER_MAX_AGE,
    });
    // 10 days in: 20 days remain of 30 — not yet halfway.
    expect(shouldRefresh(remembered, NOW + 10 * DAY)).toBe(false);
    // 20 days in: 10 days remain of 30 — past halfway.
    expect(shouldRefresh(remembered, NOW + 20 * DAY)).toBe(true);
  });

  it('is false for an already-expired session', () => {
    expect(shouldRefresh(session(), NOW + 8 * DAY)).toBe(false);
  });

  it('is false when the token carries no exp', () => {
    expect(shouldRefresh(session({ exp: undefined }), NOW + 4 * DAY)).toBe(false);
  });
});

describe('isPastAbsoluteCap', () => {
  it('is false inside the 90-day cap', () => {
    expect(isPastAbsoluteCap(session(), NOW + 89 * DAY)).toBe(false);
  });

  it('is true at and beyond the 90-day cap', () => {
    expect(SESSION_ABSOLUTE_CAP).toBe(90 * DAY);
    expect(isPastAbsoluteCap(session(), NOW + SESSION_ABSOLUTE_CAP)).toBe(true);
    expect(isPastAbsoluteCap(session(), NOW + 120 * DAY)).toBe(true);
  });

  it('measures from sessionStart, not from issuance of the current token', () => {
    // Token minted moments ago, but the session began 91 days back.
    const longRunning = session({
      sessionStart: NOW - 91 * DAY,
      iat: NOW,
      exp: NOW + SESSION_DEFAULT_MAX_AGE,
    });
    expect(longRunning.iat).toBe(NOW);
    expect(isPastAbsoluteCap(longRunning, NOW)).toBe(true);
  });
});

describe('refresh round-trip', () => {
  it('preserves rememberMe so a 30-day session does not downgrade to 7 days', async () => {
    const remembered = session({
      rememberMe: true,
      exp: NOW + SESSION_REMEMBER_MAX_AGE,
    });

    const token = await signSessionToken(refreshedPayload(remembered, 'principal-1'));
    const verified = await verifyToken(token);

    expect(verified?.rememberMe).toBe(true);
    expect(sessionMaxAge(verified?.rememberMe)).toBe(SESSION_REMEMBER_MAX_AGE);
    // exp reflects the 30-day lifetime, not the 7-day one.
    const lifetime = verified!.exp! - verified!.iat!;
    expect(lifetime).toBe(SESSION_REMEMBER_MAX_AGE);
  });

  it('preserves sessionStart so the absolute cap keeps counting', async () => {
    // Anchored to the real clock so the freshly-signed `iat` is comparable.
    const startedAt = Math.floor(Date.now() / 1000) - 40 * DAY;
    const original = session({ sessionStart: startedAt });

    const token = await signSessionToken(refreshedPayload(original, 'principal-1'));
    const verified = await verifyToken(token);

    expect(verified?.sessionStart).toBe(startedAt);
    // iat moved forward, sessionStart did not.
    expect(verified!.iat).toBeGreaterThan(verified!.sessionStart);
  });

  it('preserves identity claims', async () => {
    const original = session({ userId: 'mentor-9', role: 'admin', name: 'Rosa' });
    const verified = await verifyToken(await signSessionToken(refreshedPayload(original, 'principal-1')));

    expect(verified?.userId).toBe('mentor-9');
    expect(verified?.role).toBe('admin');
    expect(verified?.name).toBe('Rosa');
  });

  it('sets principalId from the argument, not merely from whatever the session already carried', async () => {
    // A claim-less session (principalId undefined) refreshing must still come
    // out the other side WITH a principalId — the caller resolved one for
    // this request and refreshedPayload's job is to write it in, not to
    // leave the field exactly as it found it.
    const claimless = session({ principalId: undefined });
    const verified = await verifyToken(await signSessionToken(refreshedPayload(claimless, 'principal-resolved')));
    expect(verified?.principalId).toBe('principal-resolved');

    // And a session already carrying a (possibly stale) principalId gets the
    // freshly-resolved one, not whatever it walked in with.
    const stale = session({ principalId: 'principal-old' });
    const reVerified = await verifyToken(await signSessionToken(refreshedPayload(stale, 'principal-current')));
    expect(reVerified?.principalId).toBe('principal-current');
  });
});

describe('refusal past the absolute cap', () => {
  it('refuses to refresh a session that is due for refresh but past the cap', () => {
    // 4 days into the current 7-day token (due), session started 91 days ago.
    const capped = session({ sessionStart: NOW - 91 * DAY });
    const now = NOW + 4 * DAY;

    expect(shouldRefresh(capped, now)).toBe(true);
    expect(isPastAbsoluteCap(capped, now)).toBe(true);
    // The proxy's guard is `shouldRefresh && !isPastAbsoluteCap`.
    expect(shouldRefresh(capped, now) && !isPastAbsoluteCap(capped, now)).toBe(false);
  });

  it('still refreshes a due session inside the cap', () => {
    const inside = session({ sessionStart: NOW - 10 * DAY });
    const now = NOW + 4 * DAY;

    expect(shouldRefresh(inside, now) && !isPastAbsoluteCap(inside, now)).toBe(true);
  });
});

describe('legacy tokens', () => {
  it('verifies a token with neither rememberMe nor sessionStart', async () => {
    const legacy = await new SignJWT({
      userId: 'socio-legacy',
      role: 'socio',
      name: 'Legacy',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${SESSION_DEFAULT_MAX_AGE}s`)
      .sign(SECRET);

    const verified = await verifyToken(legacy);

    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe('socio-legacy');
    expect(verified?.role).toBe('socio');
    // Missing fields are normalized, not rejected.
    expect(verified?.rememberMe).toBe(false);
    expect(typeof verified?.sessionStart).toBe('number');
    // sessionStart defaults to "now", so a legacy session is not instantly capped.
    expect(isPastAbsoluteCap(verified!)).toBe(false);
  });

  it('returns null for a token signed with a different secret', async () => {
    const forged = await new SignJWT({ userId: 'x', role: 'admin', name: 'X' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('some-other-secret'));

    expect(await verifyToken(forged)).toBeNull();
  });
});

describe('cookieOptions', () => {
  it('is the single source of cookie attributes', () => {
    expect(cookieOptions(SESSION_REMEMBER_MAX_AGE)).toEqual({
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_REMEMBER_MAX_AGE,
      path: '/',
    });
  });
});
