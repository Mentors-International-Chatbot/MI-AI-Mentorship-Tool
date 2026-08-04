import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/auth/session';

/**
 * Generic post-auth landing. Handles ?redirect=/home from login and direct visits.
 */
export default async function HomePage() {
  const session = await verifySession();
  if (!session) {
    redirect('/login?redirect=/home');
  }
  if (session.role === 'socio') {
    redirect('/chat');
  }
  if (session.role === 'admin') {
    redirect('/admin');
  }
  redirect('/dashboard/learners');
}
