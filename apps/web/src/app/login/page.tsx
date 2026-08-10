import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { homePathForRole, verifySession } from '@/lib/auth/session';
import LoginForm from './LoginForm';

function testSessionSwitcherEnabled(requested: boolean): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return requested && process.env.ENABLE_TEST_LOGIN === 'true';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ test?: string }>;
}) {
  const params = await searchParams;
  const testSessionSwitcher = testSessionSwitcherEnabled(params.test === '1');
  const session = await verifySession();
  if (session && !testSessionSwitcher) {
    redirect(homePathForRole(session.role));
  }

  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
