/**
 * Session token layer: signing, verification, lifetimes, and cookie attributes.
 *
 * Deliberately free of `next/headers` so the request proxy (edge/middleware)
 * can import it directly instead of re-declaring the secret and cookie name.
 * Cookie-store helpers live in `session.ts`.
 */
import { SignJWT, jwtVerify } from 'jose';

export const COOKIE_NAME = 'mi_session';

const DEV_SECRET = 'dev-secret-change-in-production';

function resolveSecret(): Uint8Array {
  const fromEnv = process.env.AUTH_SECRET;
  if (!fromEnv) {
    // A missing secret in production means every session token is signed with a
    // publicly-known string — anyone could forge an admin session. Fail loudly.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'AUTH_SECRET is not set. Refusing to sign session tokens with the development fallback in production.',
      );
    }
    return new TextEncoder().encode(DEV_SECRET);
  }
  return new TextEncoder().encode(fromEnv);
}

export const SECRET = resolveSecret();

/** Session lifetime when "remember me" is off. */
export const SESSION_DEFAULT_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/** Session lifetime when "remember me" is on. */
export const SESSION_REMEMBER_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Hard ceiling measured from original issuance. Sliding refresh stops here so a
 * continuously-used session cannot live forever without a real re-login.
 */
export const SESSION_ABSOLUTE_CAP = 60 * 60 * 24 * 90; // 90 days

/** Fraction of the lifetime that must elapse before a refresh is issued. */
export const SESSION_REFRESH_THRESHOLD = 0.5;

/**
 * `course_lead` designs and configures one or more programs. Distinct from
 * `mentor` (who works with learners but does not shape the course) and from
 * `admin` (who is unscoped). A course lead's reach is defined by their
 * ProgramMembership rows, never by the role alone.
 */
export type SessionRole = 'socio' | 'mentor' | 'admin' | 'course_lead';

/** The caller-supplied half of a session — who the user is. */
export type SessionIdentity = {
  userId: string;
  role: SessionRole;
  name: string;
};

export type SessionPayload = SessionIdentity & {
  /** Persisted so a sliding refresh re-issues with the original lifetime. */
  rememberMe: boolean;
  /** Original issuance (epoch seconds). Never reset by refresh — the cap measures this. */
  sessionStart: number;
};

export type VerifiedSession = SessionPayload & { iat?: number; exp?: number };

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function sessionMaxAge(rememberMe: boolean | undefined): number {
  return rememberMe ? SESSION_REMEMBER_MAX_AGE : SESSION_DEFAULT_MAX_AGE;
}

/**
 * Every cookie attribute lives here, in one place. Canvas LTI will eventually
 * need `sameSite: 'none'` for the third-party-cookie iframe case — that branch
 * belongs in this function and nowhere else.
 */
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge,
    path: '/',
  };
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  const maxAge = sessionMaxAge(payload.rememberMe);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(SECRET);
}

/**
 * Verify a JWT string. Tokens issued before `rememberMe`/`sessionStart` existed
 * are normalized rather than rejected, so a deploy does not log everyone out.
 */
export async function verifyToken(token: string): Promise<VerifiedSession | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const claims = payload as unknown as Partial<VerifiedSession>;
    return {
      ...(claims as VerifiedSession),
      rememberMe: claims.rememberMe ?? false,
      sessionStart: claims.sessionStart ?? nowSeconds(),
    };
  } catch {
    return null;
  }
}

/**
 * True once a session is past `SESSION_REFRESH_THRESHOLD` of its lifetime — the
 * trigger for re-issuing it on an active request, so an in-use session never
 * expires out from under the user.
 */
export function shouldRefresh(
  session: VerifiedSession,
  now: number = nowSeconds(),
): boolean {
  if (!session.exp) return false;
  const remaining = session.exp - now;
  if (remaining <= 0) return false;
  return remaining < sessionMaxAge(session.rememberMe) * SESSION_REFRESH_THRESHOLD;
}

/**
 * True once the session has been sliding for longer than the absolute cap.
 * Past this point refresh stops and the token is allowed to expire naturally,
 * forcing a real re-login.
 */
export function isPastAbsoluteCap(
  session: VerifiedSession,
  now: number = nowSeconds(),
): boolean {
  return now - session.sessionStart >= SESSION_ABSOLUTE_CAP;
}

/** Build the payload for a refreshed token: identity and clock preserved. */
export function refreshedPayload(session: VerifiedSession): SessionPayload {
  return {
    userId: session.userId,
    role: session.role,
    name: session.name,
    rememberMe: session.rememberMe,
    sessionStart: session.sessionStart,
  };
}
