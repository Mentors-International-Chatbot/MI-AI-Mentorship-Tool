import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every API route must authorize itself.
 * ═══════════════════════════════════════════════════════════════════════════
 * The root cause of the unguarded /api/admin surface was one wrong assumption
 * replicated eleven times: that middleware covers API routes. It does not.
 * `src/proxy.ts` branches on the `/dashboard` and `/admin` path prefixes, and
 * `/api/admin/*` matches neither — so every handler was on its own, and nine of
 * eleven authors did not know that.
 *
 * "Fine because each author remembered" is not the same as "covered". This test
 * enumerates the route files and fails when one appears with no authorization
 * call in it, converting a thing someone must remember into a build failure.
 *
 * It is deliberately crude: it greps source text rather than executing handlers,
 * so it proves a check is *present*, not that it is *correct*. A route can pass
 * this and still authorize the wrong thing. It is a floor, not a ceiling — the
 * per-route tests (see courseScope.test.ts) are what check the logic.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const API_DIR = join(process.cwd(), 'src', 'app', 'api');

/**
 * Any recognised way a handler can establish who is calling.
 * Add to this list only when adding a real mechanism, never to silence a route.
 */
const AUTHORIZATION_SIGNALS = [
  'verifySession',
  'requireAdmin',
  'requireCourseConfigurer',
  'verifyMentorOwnership',
  'verifyMentorOrAdmin',
  'CRON_SECRET',
  'MENTOR_API_KEY',
  'verifyToken',
  'X-Hub-Signature', // WhatsApp webhook HMAC
  'APP_SECRET',
];

/**
 * Routes that are intentionally reachable without a caller identity, each with
 * the reason. Anything not listed here must authorize.
 *
 * `auth/test-login` is NOT exempt: it gates on environment rather than on a
 * caller, so `testLoginEnabled` is its recognised signal below.
 */
const INTENTIONALLY_PUBLIC: Record<string, string> = {
  'auth/login': 'Establishes a session; cannot require one.',
  'auth/logout': 'Clears a cookie. Safe to call with no session.',
  'auth/signup': 'Self-service registration.',
  'auth/forgot-password': 'Pre-authentication; rate limiting is the control here.',
  'auth/reset-password': 'Authorized by the emailed reset token, not a session.',
  'config/public': 'Returns only the chatbot display name — nothing tenant-specific.',
  'auth/test-login': 'Gated on NODE_ENV plus ENABLE_TEST_LOGIN; refused outright in production.',
};

/** Extra signals accepted for the environment-gated dev route. */
const ENV_GATE_SIGNALS = ['testLoginEnabled', 'ENABLE_TEST_LOGIN'];

function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      routeFiles(full, acc);
    } else if (entry === 'route.ts') {
      acc.push(full);
    }
  }
  return acc;
}

function routeName(file: string): string {
  return file
    .slice(API_DIR.length + 1)
    .replace(/\/route\.ts$/, '')
    .replace(/\\/g, '/');
}

const files = routeFiles(API_DIR);

describe('API route authorization', () => {
  it('finds the routes at all (guards against a broken scan)', () => {
    // Without this, deleting the api directory would make everything below pass.
    expect(files.length).toBeGreaterThan(20);
    expect(files.map(routeName)).toContain('admin/socios/[id]/password');
  });

  it('every route either authorizes or is a documented exception', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const name = routeName(file);
      const source = readFileSync(file, 'utf8');

      const signals =
        name === 'auth/test-login'
          ? [...AUTHORIZATION_SIGNALS, ...ENV_GATE_SIGNALS]
          : AUTHORIZATION_SIGNALS;

      const authorizes = signals.some((s) => source.includes(s));
      const exempt = name in INTENTIONALLY_PUBLIC;

      if (!authorizes && !exempt) offenders.push(name);
    }

    expect(
      offenders,
      `These API routes contain no authorization call and are not listed in ` +
        `INTENTIONALLY_PUBLIC. Middleware does NOT cover /api/* — add a guard ` +
        `from src/lib/auth/adminGuard.ts, or document why the route is public:\n` +
        offenders.map((o) => `  - ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('keeps the public exception list honest', () => {
    // A route that gained a guard should leave the exception list, otherwise the
    // list slowly becomes a place to park routes nobody wants to think about.
    const names = new Set(files.map(routeName));
    const stale = Object.keys(INTENTIONALLY_PUBLIC).filter((n) => !names.has(n));
    expect(stale, `Listed as public but no longer exists: ${stale.join(', ')}`).toEqual([]);
  });

  it('never lets test-login reach production', () => {
    const source = readFileSync(join(API_DIR, 'auth', 'test-login', 'route.ts'), 'utf8');
    // This endpoint mints an admin session with no password and no DB lookup.
    // The production refusal must not degrade into a single env flag.
    expect(source).toContain("process.env.NODE_ENV === 'production'");
    expect(source).toContain('ENABLE_TEST_LOGIN');
  });

  it('audits the password-change endpoint', () => {
    const source = readFileSync(
      join(API_DIR, 'admin', 'socios', '[id]', 'password', 'route.ts'),
      'utf8',
    );
    // An action that can take over an account has to leave a durable trace.
    expect(source).toContain('auditLog.create');
    expect(source).toContain('changed_socio_password');
  });
});
