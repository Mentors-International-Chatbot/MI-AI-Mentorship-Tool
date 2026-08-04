import { NextRequest, NextResponse } from 'next/server';
import {
  COOKIE_NAME,
  cookieOptions,
  isPastAbsoluteCap,
  refreshedPayload,
  sessionMaxAge,
  shouldRefresh,
  signSessionToken,
  verifyToken,
  type VerifiedSession,
} from '@/lib/auth/token';

// Routes that don't require authentication
const PUBLIC_PATHS = [
  '/login',
  '/api/auth',
  '/api/webhook',
  '/api/feedback',
  '/api/chat',
  '/api/cron',
  '/_next',
  '/favicon.ico',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

async function getSession(req: NextRequest): Promise<VerifiedSession | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/**
 * Re-issue a session that is past the halfway point of its lifetime, so an
 * actively-used session never expires out from under the user. Stops at the
 * absolute cap (measured from `sessionStart`, which refresh never resets), so
 * the session eventually expires and forces a real re-login. Re-signing
 * failures are non-fatal: the existing cookie is still valid.
 *
 * Middleware cannot use `cookies()` from next/headers — the cookie is set on
 * the outgoing NextResponse.
 */
async function withRefreshedSession(
  res: NextResponse,
  session: VerifiedSession,
): Promise<NextResponse> {
  const now = Math.floor(Date.now() / 1000);
  if (!shouldRefresh(session, now)) return res;
  if (isPastAbsoluteCap(session, now)) return res;

  try {
    const token = await signSessionToken(refreshedPayload(session));
    res.cookies.set(
      COOKIE_NAME,
      token,
      cookieOptions(sessionMaxAge(session.rememberMe)),
    );
  } catch {
    // Keep serving the request on the current cookie.
  }

  return res;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Allow static files and root
  if (pathname === '/' || pathname.startsWith('/_next')) {
    return NextResponse.next();
  }

  const session = await getSession(req);

  // No session → redirect to login
  if (!session) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If logged in and visiting /login, redirect to appropriate home
  if (pathname === '/login') {
    const home = session.role === 'socio' ? '/chat' : '/dashboard/learners';
    return NextResponse.redirect(new URL(home, req.url));
  }

  // Route-level role checks
  // /chat: allowed for all authenticated roles (socio app + mentor/admin can try web AI)

  if (pathname.startsWith('/dashboard')) {
    if (session.role === 'socio') {
      return NextResponse.redirect(new URL('/chat', req.url));
    }
  }

  // /admin: admins plus mentors (MVP: mentor signups are staff; tighten with DB role if needed)
  if (pathname.startsWith('/admin')) {
    if (session.role === 'socio') {
      return NextResponse.redirect(new URL('/chat', req.url));
    }
    if (session.role !== 'admin' && session.role !== 'mentor') {
      return NextResponse.redirect(new URL('/dashboard/learners', req.url));
    }
  }

  return withRefreshedSession(NextResponse.next(), session);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
