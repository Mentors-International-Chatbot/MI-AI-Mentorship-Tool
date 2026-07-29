import { cookies } from 'next/headers';
import {
  COOKIE_NAME,
  SECRET,
  sessionCookieOptions,
  sessionMaxAge,
  signSession,
  verifyToken,
  type SessionPayload,
} from './sessionConfig';

export type { SessionPayload };

/** Post-login landing path for each role (dashboard, admin, or socio chat). */
export function homePathForRole(role: SessionPayload['role']): string {
  if (role === 'socio') return '/chat';
  if (role === 'admin') return '/admin';
  return '/dashboard/socios';
}

export async function createSession(
  payload: SessionPayload,
  rememberMe: boolean = false,
): Promise<string> {
  const maxAge = sessionMaxAge(rememberMe);
  const token = await signSession({ ...payload, rememberMe }, maxAge);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, sessionCookieOptions(maxAge));

  return token;
}

export async function verifySession(): Promise<SessionPayload | null> {
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
