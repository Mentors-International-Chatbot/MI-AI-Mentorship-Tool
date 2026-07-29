import { NextRequest, NextResponse } from 'next/server';
import {
  COOKIE_NAME,
  sessionCookieOptions,
  sessionMaxAge,
  shouldRefresh,
  signSession,
  verifyToken,
  type VerifiedSession,
} from '@/lib/auth/sessionConfig';

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
 * actively-used session never expires out from under the user. Re-signing
 * failures are non-fatal: the existing cookie is still valid.
 */
async function withRefreshedSession(
  res: NextResponse,
  session: VerifiedSession,
): Promise<NextResponse> {
  if (!shouldRefresh(session, Math.floor(Date.now() / 1000))) return res;

  try {
    const maxAge = sessionMaxAge(session.rememberMe);
    const token = await signSession(
      {
        userId: session.userId,
        role: session.role,
        name: session.name,
        rememberMe: session.rememberMe,
      },
      maxAge,
    );
    res.cookies.set(COOKIE_NAME, token, sessionCookieOptions(maxAge));
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
    const home = session.role === 'socio' ? '/chat' : '/dashboard/socios';
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
      return NextResponse.redirect(new URL('/dashboard/socios', req.url));
    }
  }

  return withRefreshedSession(NextResponse.next(), session);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
