import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/auth/session';
import { resolveLearnerHome } from '@/lib/courses/learnerHome';

/**
 * Generic post-auth landing. Handles ?redirect=/home from login and direct visits.
 */
export default async function HomePage() {
  const session = await verifySession();
  if (!session) {
    redirect('/login?redirect=/home');
  }
  if (session.role === 'socio') {
    const resolution = await resolveLearnerHome(session.userId);
    if (resolution.kind === 'redirect') {
      redirect(resolution.path);
    }
    // A.5 (Platform Restructure Phase A, Stage 5): more than one ACTIVE
    // enrollment. No course-picker UI exists yet (that's D4/Phase B/D
    // territory) — this is deliberately the simplest possible list, not a
    // designed page. Ugly is acceptable here; silently picking one course
    // and hiding the other enrollment is not.
    return (
      <ul>
        {resolution.courses.map((course) => (
          <li key={course.courseCode}>
            <a href={course.path}>{course.courseCode}</a>
          </li>
        ))}
      </ul>
    );
  }
  if (session.role === 'admin') {
    redirect('/admin');
  }
  redirect('/dashboard/learners');
}
