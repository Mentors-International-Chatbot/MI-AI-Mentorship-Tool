/**
 * Session primitives shared by the request proxy and the cookie-bound helpers
 * in `session.ts`.
 *
 * Deliberately free of `next/headers` so the proxy can import it directly
 * instead of re-declaring the secret, cookie name, and lifetimes.
 */
import { SignJWT, jwtVerify } from 'jose';

export const COOKIE_NAME = 'mi_session';

export const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'dev-secret-change-in-production',
);

/** Session lifetime when "remember me" is off. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/** Session lifetime when "remember me" is on. */
export const SESSION_MAX_AGE_REMEMBER = 60 * 60 * 24 * 30; // 30 days

export type SessionPayload = {
  userId: string;
  role: 'socio' | 'mentor' | 'admin';
  name: string;
  /** Persisted so a sliding refresh can re-issue with the original lifetime. */
  rememberMe?: boolean;
};

export type VerifiedSession = SessionPayload & { iat?: number; exp?: number };

export function sessionMaxAge(rememberMe: boolean | undefined): number {
  return rememberMe ? SESSION_MAX_AGE_REMEMBER : SESSION_MAX_AGE;
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge,
    path: '/',
  };
}

export async function signSession(
  payload: SessionPayload,
  maxAge: number,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<VerifiedSession | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as VerifiedSession;
  } catch {
    return null;
  }
}

/**
 * True once a session is past the halfway point of its lifetime — the trigger
 * for re-issuing it on an active request, so an in-use session never expires.
 */
export function shouldRefresh(session: VerifiedSession, nowSeconds: number): boolean {
  if (!session.exp) return false;
  const remaining = session.exp - nowSeconds;
  if (remaining <= 0) return false;
  return remaining < sessionMaxAge(session.rememberMe) / 2;
}
