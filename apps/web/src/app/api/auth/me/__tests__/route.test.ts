import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  getSocio: vi.fn(),
  updateSocio: vi.fn(),
  mentorFindUnique: vi.fn(),
  getCourseMeta: vi.fn(),
  resolveLearnerHome: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ verifySession: mocks.verifySession }));
vi.mock('@/lib/repo', () => ({ repo: { getSocio: mocks.getSocio, updateSocio: mocks.updateSocio } }));
vi.mock('@/lib/db', () => ({ prisma: { mentor: { findUnique: mocks.mentorFindUnique } } }));
vi.mock('@/lib/courses/course-meta', () => ({ getCourseMeta: mocks.getCourseMeta }));
vi.mock('@/lib/courses/learnerHome', () => ({ resolveLearnerHome: mocks.resolveLearnerHome }));

import { GET, PATCH } from '../route';

const session = {
  userId: 'learner-on-branch-a',
  role: 'socio' as const,
  name: 'Learner',
  rememberMe: false,
  sessionStart: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifySession.mockResolvedValue(session);
  mocks.getCourseMeta.mockResolvedValue({ courseName: 'AI Essentials', mentorName: 'Tutor', displayName: 'AI Essentials' });
  mocks.resolveLearnerHome.mockResolvedValue({ kind: 'redirect', path: '/learn/AIESS/first' });
});

describe('/api/auth/me session diagnostics', () => {
  it('distinguishes an absent cookie from a branch-mismatched database identity', async () => {
    mocks.verifySession.mockResolvedValueOnce(null);
    const noSession = await GET();
    expect(noSession.status).toBe(401);
    await expect(noSession.json()).resolves.toMatchObject({ code: 'no_session' });

    mocks.getSocio.mockResolvedValueOnce(null);
    const mismatch = await GET();
    expect(mismatch.status).toBe(409);
    await expect(mismatch.json()).resolves.toMatchObject({ code: 'session_database_mismatch' });
  });

  it('reports a course key whose published version or enrollment is unavailable', async () => {
    mocks.getSocio.mockResolvedValue({
      id: session.userId,
      language: 'en',
      curriculumCollectionKey: 'ai-essentials',
    });
    mocks.resolveLearnerHome.mockResolvedValue({ kind: 'redirect', path: '/join?error=no-published-course' });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      curriculumCollectionKey: 'ai-essentials',
      homePath: '/join?error=no-published-course',
      enrollmentIssue: 'no-published-course',
    });
  });

  it('A.5: more than one ACTIVE enrollment reports no homePath and no enrollmentIssue, not an error — join/page.tsx falls back to /home', async () => {
    mocks.getSocio.mockResolvedValue({
      id: session.userId,
      language: 'en',
      curriculumCollectionKey: 'ai-essentials',
    });
    mocks.resolveLearnerHome.mockResolvedValue({
      kind: 'choose',
      courses: [{ courseCode: 'AIESS', path: '/learn/AIESS/first' }, { courseCode: 'SKILLS', path: '/learn/SKILLS/first' }],
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      curriculumCollectionKey: 'ai-essentials',
      homePath: null,
      enrollmentIssue: null,
    });
  });

  it('returns the same branch-mismatch code from PATCH instead of an ambiguous 404', async () => {
    mocks.getSocio.mockResolvedValue(null);
    const request = new NextRequest('http://localhost/api/auth/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'en' }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'session_database_mismatch' });
  });
});
