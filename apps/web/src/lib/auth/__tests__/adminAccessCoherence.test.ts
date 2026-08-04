import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The roles that may OPEN /admin must equal the roles that may USE it.
 * ═══════════════════════════════════════════════════════════════════════════
 * These drifted apart the moment /api/admin routes started enforcing roles:
 * `src/proxy.ts` still admitted mentors to /admin pages while every fetch those
 * pages made returned 403, so a mentor got a shell that rendered and then failed
 * — visible in the dev log as a stream of `GET /api/admin/analytics 403`.
 *
 * A page a role can open must be a page that role can use. Middleware and the
 * route guards are separate files with no shared type between them, so this
 * compares them as text. Crude, and the same caveat as the route-authorization
 * sweep: it checks the lists agree, not that either list is right.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const proxySource = readFileSync(join(process.cwd(), 'src', 'proxy.ts'), 'utf8');
const guardSource = readFileSync(
  join(process.cwd(), 'src', 'lib', 'auth', 'adminGuard.ts'),
  'utf8',
);

describe('/admin access coherence', () => {
  it('does not admit mentors to /admin', () => {
    // The specific regression: mentors could open pages whose every API call
    // 403'd. If mentors are ever meant to have an admin surface, the guards in
    // adminGuard.ts have to allow them first.
    const adminBlock = proxySource.slice(proxySource.indexOf("pathname.startsWith('/admin')"));
    const roleCheck = adminBlock.slice(0, adminBlock.indexOf('}\n\n'));
    expect(roleCheck).not.toMatch(/session\.role === 'mentor'/);
    expect(roleCheck).not.toMatch(/session\.role !== 'mentor'/);
  });

  it('admits exactly the roles the API guards accept', () => {
    // requireCourseConfigurer is the most permissive admin-side guard.
    expect(guardSource).toMatch(/role !== 'admin' && session\.role !== 'course_lead'/);

    const adminBlock = proxySource.slice(proxySource.indexOf("pathname.startsWith('/admin')"));
    expect(adminBlock).toMatch(/role !== 'admin' && session\.role !== 'course_lead'/);
  });

  it('keeps a course lead confined to the configuration pages', () => {
    // A course lead configures courses; learner records, mentors and user
    // accounts stay admin-only, which requireAdmin enforces server-side.
    expect(proxySource).toContain("'/admin/config'");
    expect(proxySource).toContain("'/admin/prompts'");
  });

  it('still keeps learners out entirely', () => {
    const adminBlock = proxySource.slice(proxySource.indexOf("pathname.startsWith('/admin')"));
    expect(adminBlock).toMatch(/session\.role === 'socio'/);
  });
});
