/**
 * L1.e (Auth & Login Restructure) — the redirect collapse's shared function,
 * split into its own file rather than living in `token.ts`. `token.ts`
 * computes `SECRET` eagerly at module load (`resolveSecret()` throws outside
 * production if `AUTH_SECRET` is unset, and browsers never have it) — fine
 * for every existing importer, all server-side, but importing that module
 * from a `'use client'` component (`LoginForm.tsx`) would pull the same
 * throwing code into the browser bundle. This file has no such dependency —
 * only a type-only import of `SessionRole`, erased at compile time — so it's
 * safe from both middleware/server code and plain client components.
 * `token.ts` and `session.ts` re-export it for existing server-side callers.
 */
import type { SessionRole } from './token';

/** Post-login landing path for each role (dashboard, admin, or socio chat). */
export function homePathForRole(role: SessionRole): string {
  if (role === 'socio') return '/home';
  if (role === 'admin') return '/admin';
  return '/dashboard/learners';
}
