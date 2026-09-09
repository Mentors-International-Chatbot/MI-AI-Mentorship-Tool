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
import { resolvePrincipalForSession, PrincipalNotFoundError } from '@/lib/auth/principal';

// Routes that don't require authentication. '/login' must stay public —
// removing it would redirect an unauthenticated visitor to /login?redirect=
// /login, looping forever. That also means a session-aware "already
// authenticated, bounce away from /login" check placed after the public-path
// early return below can never run for this path — L1.e found one written
// exactly there and removed it as dead code; that redirect is real and
// correctly implemented, but only in login/page.tsx (a server component,
// checked directly against homePathForRole), not here.
const PUBLIC_PATHS = [
  '/login',
  '/api/auth',
  '/api/webhook',
  '/api/feedback',
  '/api/chat',
  '/api/cron',
  '/api/lti',
  '/api/learn',
  '/learn',
  '/lti',
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
 * the session eventually expires and forces a real re-login.
 *
 * Also resolves the session's current Principal on every refresh and writes
 * its id into the re-signed token (`refreshedPayload`'s second argument) —
 * this, not a fresh login, is what actually retires a claim-less
 * (pre-Principal) session: an actively-used one refreshes well before the
 * 90-day absolute cap, so it acquires a real `principalId` within days
 * instead of waiting for the cap to force re-authentication.
 *
 * `PrincipalNotFoundError` (a `principalId` claim that no longer resolves —
 * a deleted row, or a database restored to a point before it existed) is
 * rethrown for `proxy()` to turn into a sign-out-and-redirect, deliberately
 * NOT swallowed here: unlike a signing hiccup, the session's identity is
 * actually gone, and continuing to serve the stale cookie would just defer
 * the same failure to the next authenticated action. Any other failure
 * (resolving the principal, signing) is non-fatal: the existing cookie is
 * still valid.
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
    const principal = await resolvePrincipalForSession(session);
    const token = await signSessionToken(refreshedPayload(session, principal.id));
    res.cookies.set(
      COOKIE_NAME,
      token,
      cookieOptions(sessionMaxAge(session.rememberMe)),
    );
  } catch (error) {
    if (error instanceof PrincipalNotFoundError) throw error;
    // Keep serving the request on the current cookie.
  }

  return res;
}

/**
 * The session's Principal is gone (see `withRefreshedSession`) — clear the
 * cookie and send the user to log in again, same shape as the no-session
 * redirect below. The alternative (letting the error propagate) is a 500 for
 * every active user simultaneously if this ever fires from a real incident
 * (e.g. a Neon branch restore), which is the worst possible time for it.
 */
function redirectToLoginAndClearSession(req: NextRequest, pathname: string): NextResponse {
  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('redirect', pathname);
  const res = NextResponse.redirect(loginUrl);
  res.cookies.delete(COOKIE_NAME);
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

  // Route-level role checks
  // /chat: allowed for all authenticated roles (socio app + mentor/admin can try web AI)

  if (pathname.startsWith('/dashboard')) {
    if (session.role === 'socio') {
      return NextResponse.redirect(new URL('/chat', req.url));
    }
  }

  // /admin: administrators, plus course leads limited to the configuration
  // pages below.
  //
  // Mentors are NOT admitted. They were, on the comment "MVP: mentor signups are
  // staff" — an assumption nobody explicitly chose, and one that stopped being
  // survivable once every /api/admin route began enforcing its own role. A
  // mentor could still open /admin, and then every fetch on the page returned
  // 403 and they saw a broken shell. A page a role can open must be a page that
  // role can use, so the two now agree: this list mirrors the guards in
  // src/lib/auth/adminGuard.ts exactly.
  //
  // Self-service mentor signup is still open (POST /api/auth/signup accepts
  // userType: 'mentor'), which is the other reason not to hand mentors the
  // admin surface. Invite-based creation via EnrollmentInvitation is the real
  // fix for that.
  if (pathname.startsWith('/admin')) {
    if (session.role === 'socio') {
      return NextResponse.redirect(new URL('/chat', req.url));
    }
    if (session.role !== 'admin' && session.role !== 'course_lead') {
      return NextResponse.redirect(new URL('/dashboard/learners', req.url));
    }
    // A course lead configures courses; they are not a platform administrator.
    // Learner records, mentor management and user accounts stay admin-only.
    //
    // This is defence in depth, not the enforcement point: middleware sees page
    // paths, and the real guarantee lives in the route handlers themselves
    // (`requireSystemAdmin` / `requireCourseConfigurer` in src/lib/auth/adminGuard.ts),
    // because /api/* never matches these prefixes.
    if (session.role === 'course_lead') {
      const allowed = ['/admin/config', '/admin/prompts'];
      if (!allowed.some((p) => pathname.startsWith(p))) {
        return NextResponse.redirect(new URL('/admin/config', req.url));
      }
    }
  }

  try {
    return await withRefreshedSession(NextResponse.next(), session);
  } catch (error) {
    if (error instanceof PrincipalNotFoundError) {
      return redirectToLoginAndClearSession(req, pathname);
    }
    throw error;
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
