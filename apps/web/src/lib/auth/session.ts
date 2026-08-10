import { cookies } from 'next/headers';
import {
  COOKIE_NAME,
  SECRET,
  cookieOptions,
  nowSeconds,
  sessionMaxAge,
  signSessionToken,
  verifyToken,
  type SessionIdentity,
  type SessionPayload,
  type VerifiedSession,
} from './token';

export type { SessionIdentity, SessionPayload, VerifiedSession };

/** Post-login landing path for each role (dashboard, admin, or socio chat). */
export function homePathForRole(role: SessionPayload['role']): string {
  if (role === 'socio') return '/home';
  if (role === 'admin') return '/admin';
  return '/dashboard/learners';
}

export async function createSession(
  identity: SessionIdentity,
  rememberMe: boolean = false,
): Promise<string> {
  const payload: SessionPayload = {
    ...identity,
    rememberMe,
    sessionStart: nowSeconds(),
  };
  const token = await signSessionToken(payload);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, cookieOptions(sessionMaxAge(rememberMe)));

  return token;
}

export async function verifySession(): Promise<VerifiedSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/**
 * Verify a JWT token string directly (for use in proxy / Edge runtime).
 * Does NOT read cookies — caller passes the token.
 */
export { verifyToken };

export { COOKIE_NAME, SECRET };
