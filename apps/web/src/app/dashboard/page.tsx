import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/auth/session';

/**
 * D.3: a mentor's default landing page is now the triage view, not the
 * roster — the plan's "main view = flag triage inbox." Scoped to `mentor`
 * only: `/dashboard/alerts` resolves its organization via
 * `getOrganizationIdByMentorId` (a `MentorProfile` lookup), which returns
 * null for a `course_lead` session and would land them on an empty page.
 */
export default async function DashboardPage() {
  const session = await verifySession();
  redirect(session?.role === 'mentor' ? '/dashboard/alerts' : '/dashboard/learners');
}
