/**
 * homePathForRole was duplicated in at least four places (proxy.ts,
 * LoginForm.tsx, session.ts's original definition, and dead code in the
 * since-deleted LoginClient.tsx) before the L1.e redirect collapse. One of
 * those copies (proxy.ts's authenticated-/login redirect) had drifted and
 * silently sent an admin to /dashboard/learners instead of /admin. Locking
 * in the one shared implementation here so that regression can't recur
 * unnoticed in whichever call site next needs a role→destination mapping.
 */
import { describe, it, expect } from 'vitest';
import { homePathForRole } from '../roleDestination';

describe('homePathForRole', () => {
  it('sends socio to /home', () => {
    expect(homePathForRole('socio')).toBe('/home');
  });

  it('sends admin to /admin', () => {
    expect(homePathForRole('admin')).toBe('/admin');
  });

  it('sends mentor to /dashboard/learners', () => {
    expect(homePathForRole('mentor')).toBe('/dashboard/learners');
  });

  it('sends course_lead to /dashboard/learners', () => {
    expect(homePathForRole('course_lead')).toBe('/dashboard/learners');
  });
});
