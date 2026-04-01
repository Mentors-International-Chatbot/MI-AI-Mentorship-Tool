import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { homePathForRole, verifySession } from '@/lib/auth/session';
import LoginForm from './LoginForm';

export default async function LoginPage() {
  const session = await verifySession();
  if (session) {
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
