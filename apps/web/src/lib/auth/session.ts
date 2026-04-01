import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'dev-secret-change-in-production',
);

const COOKIE_NAME = 'mi_session';

export type SessionPayload = {
  userId: string;
  role: 'socio' | 'mentor' | 'admin';
  name: string;
};

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
  const maxAge = rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 24; // 30 days or 1 day
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(SECRET);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
    path: '/',
  });

  return token;
}

export async function verifySession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/**
 * Verify a JWT token string directly (for use in proxy / Edge runtime).
 * Does NOT read cookies — caller passes the token.
 */
export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export { COOKIE_NAME, SECRET };
