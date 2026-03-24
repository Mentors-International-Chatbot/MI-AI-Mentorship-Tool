import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'mi_session';
const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'dev-secret-change-in-production',
);

// Routes that don't require authentication
const PUBLIC_PATHS = [
  '/login',
  '/api/auth',
  '/api/webhook',
  '/api/feedback',
  '/api/chat',
  '/api/test-ai',
  '/api/cron',
  '/_next',
  '/favicon.ico',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

type SessionPayload = {
  userId: string;
  role: 'socio' | 'mentor' | 'admin';
  name: string;
};

async function getSession(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
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
  if (pathname.startsWith('/chat')) {
    if (session.role !== 'socio') {
      const home = session.role === 'admin' ? '/admin' : '/dashboard/socios';
      return NextResponse.redirect(new URL(home, req.url));
    }
  }

  if (pathname.startsWith('/dashboard')) {
    if (session.role === 'socio') {
      return NextResponse.redirect(new URL('/chat', req.url));
    }
  }

  if (pathname.startsWith('/admin')) {
    if (session.role !== 'admin') {
      if (session.role === 'socio') {
        return NextResponse.redirect(new URL('/chat', req.url));
      }
      return NextResponse.redirect(new URL('/dashboard/socios', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
