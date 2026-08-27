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
    //
    // BLOCKER before building the real picker (see D15,
    // docs/Platform_Restructure_Plan_v1.2.md): LessonProgress
    // (@@unique([socioId, lessonNumber])) and SocioDimensionState
    // (@@unique([socioId, dimensionKey])) are not course-scoped. A learner
    // with two ACTIVE enrollments — exactly what this page exists to show —
    // will silently collide/merge lesson-number and dimension-state rows
    // across their two courses via upsert, no error, just wrong data. This
    // stub never triggers it (nothing here writes progress); a real
    // course-picker built on top of it is the first thing that would put a
    // real learner into the state that does. Widen both constraints to
    // include a course/enrollment dimension before designing this page for
    // real.
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
