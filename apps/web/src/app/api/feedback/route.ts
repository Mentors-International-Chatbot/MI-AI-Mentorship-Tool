import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyMentorOrAdmin } from '@/lib/auth/ownership';
import { verifySession } from '@/lib/auth/session';
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';

// The feedback widget is deliberately available logged-out, so the rate limit
// keys on IP rather than user. NOTE: this map is per-instance and resets on
// deploy — on Vercel's Fluid Compute each instance keeps its own counter, so a
// determined submitter spread across instances gets more than RATE_LIMIT. Same
// known limitation as the /api/chat limiter; swap both for Redis/KV together.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5; // max submissions per IP per window
const RATE_WINDOW_MS = 60 * 1000; // 1 minute

const MAX_PAGE = 100;
const MAX_SUBJECT = 200;
const MAX_BODY = 5000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

/**
 * Rate-limit key. Order matters, and it is a security choice, not a preference.
 *
 * `x-vercel-forwarded-for` is set by the platform and is the value to trust:
 * Vercel overwrites `x-forwarded-for` and does not forward external IPs
 * specifically to prevent spoofing, but that guarantee weakens if a proxy sits
 * on top of Vercel, or on Enterprise Trusted Proxy where a custom XFF is
 * allowed. In both of those cases a client-supplied XFF would let an attacker
 * rotate the key per request and walk straight past this limiter — which, on an
 * unauthenticated endpoint, is the entire point of having it.
 *
 * Plain `x-forwarded-for` is last and exists only so the limiter still keys on
 * something locally, where no platform header is present.
 */
function clientIp(req: NextRequest): string {
  const platformIp =
    req.headers.get('x-vercel-forwarded-for') ?? req.headers.get('x-real-ip');
  if (platformIp) return platformIp.trim();

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

/**
 * Actual URL path the report came from.
 *
 * Only `pathname` is kept — the query string and hash are dropped deliberately,
 * never stored. Reset links carry a PasswordResetToken as `?token=…` and the
 * login page carries `?redirect=…`; storing a raw Referer would put a live
 * password-reset token into a table every platform admin can read. Referer is
 * client-controlled, so treat even the path as advisory rather than as proof of
 * where the reporter actually was.
 */
function pagePathFromReferer(req: NextRequest): string | null {
  const referer = req.headers.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).pathname.slice(0, MAX_PAGE);
  } catch {
    return null;
  }
}

/**
 * Resolve the submitter's organization, but only when it is a real tenant
 * identification.
 *
 * Tier 3 (`source === 'default'`) means the socio is an orphan and landed in
 * whatever DEFAULT_ORGANIZATION_ID names — that is a guess, not an org, and
 * stamping it here would silently misattribute the row to a tenant that did not
 * produce it. Fail closed to null, matching resolveDashboardPanels. Resolution
 * failures are non-fatal: unattributed feedback beats a dropped submission.
 */
async function resolveOrgIdForSocio(socioId: string): Promise<string | null> {
  try {
    const { organizationId, source } = await tenantPrismaRepo.resolveOrganizationForSocio(socioId);
    if (source === 'default') {
      console.warn(
        `[Feedback] socio ${socioId} resolved only to the default organization — ` +
          `recording feedback with organizationId null rather than guessing a tenant.`,
      );
      return null;
    }
    return organizationId;
  } catch (error) {
    console.warn(
      `[Feedback] could not resolve organization for socio ${socioId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Mentors and admins DO have a tenancy anchor: MentorProfile.organizationId,
 * linked back to the legacy Mentor by a unique mentorId. There is no tiered
 * fallback here, so anything that resolves is authoritative; a mentor with no
 * profile simply yields null.
 */
async function resolveOrgIdForMentor(mentorId: string): Promise<string | null> {
  try {
    return await tenantPrismaRepo.getOrganizationIdByMentorId(mentorId);
  } catch (error) {
    console.warn(
      `[Feedback] could not resolve organization for mentor ${mentorId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** Best-effort org for whoever submitted. Null is always an acceptable answer. */
async function resolveOrgIdForSession(
  session: { userId: string; role: string } | null,
): Promise<string | null> {
  if (!session) return null;
  if (session.role === 'socio') return resolveOrgIdForSocio(session.userId);
  return resolveOrgIdForMentor(session.userId);
}

/**
 * POST — submit feedback.
 *
 * Intentionally public: the widget renders logged-out (login, signup, password
 * reset), and reports from people who cannot sign in are the ones worth having.
 * Attribution is therefore opportunistic — a session is read if present and
 * recorded, but its absence is not an error. `/api/feedback` stays in
 * PUBLIC_PATHS for this reason.
 */
export async function POST(req: NextRequest) {
  try {
    if (isRateLimited(clientIp(req))) {
      return NextResponse.json(
        { error: 'Too many submissions. Please try again in a moment.' },
        { status: 429 },
      );
    }

    let body: { page?: unknown; subject?: unknown; body?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { page, subject, body: feedbackBody } = body;

    if (
      typeof page !== 'string' ||
      typeof subject !== 'string' ||
      typeof feedbackBody !== 'string' ||
      !page.trim() ||
      !subject.trim() ||
      !feedbackBody.trim()
    ) {
      return NextResponse.json(
        { error: 'page, subject, and body are required' },
        { status: 400 },
      );
    }

    // Reject rather than truncate: silently storing half a bug report is worse
    // than telling the reporter it did not fit.
    if (
      page.length > MAX_PAGE ||
      subject.length > MAX_SUBJECT ||
      feedbackBody.length > MAX_BODY
    ) {
      return NextResponse.json(
        {
          error: `Feedback is too long. Limits: subject ${MAX_SUBJECT} characters, body ${MAX_BODY} characters.`,
        },
        { status: 413 },
      );
    }

    // Opportunistic attribution — no session is a valid state, not a 401.
    const session = await verifySession();
    const organizationId = await resolveOrgIdForSession(session);

    const feedback = await prisma.feedback.create({
      data: {
        page,
        pagePath: pagePathFromReferer(req),
        subject,
        body: feedbackBody,
        userId: session?.userId ?? null,
        role: session?.role ?? null,
        organizationId,
      },
    });

    return NextResponse.json(feedback, { status: 201 });
  } catch (error) {
    console.error('Feedback POST error:', error);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }
}

/**
 * GET — list feedback for the admin report.
 *
 * Admin only, and deliberately NOT tenant-scoped. Platform admin is currently
 * the only reader, and it needs the cross-tenant view: anonymous reports carry
 * no organizationId at all, so a scoped query would hide exactly the logged-out
 * submissions this endpoint exists to surface.
 *
 * This stops being correct the moment org-level admins ship. At that point
 * scope by `auth.session` → organizationId and decide separately who, if
 * anyone, sees the null-org rows.
 */
export async function GET() {
  const auth = await verifyMentorOrAdmin();
  if (!auth.authorized) return auth.response;

  if (auth.session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const feedback = await prisma.feedback.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(feedback);
  } catch (error) {
    console.error('Feedback GET error:', error);
    return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 });
  }
}
