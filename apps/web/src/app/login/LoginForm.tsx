'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect');

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [userType, setUserType] = useState<'socio' | 'mentor'>('mentor');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function switchMode() {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = mode === 'signin' ? '/api/auth/login' : '/api/auth/signup';
    const payload: Record<string, unknown> = {
      userType,
      identifier: identifier.trim(),
      password,
      rememberMe,
    };
    if (mode === 'signup') {
      payload.name = name.trim();
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        setLoading(false);
        return;
      }

      if (redirect && !redirect.startsWith('/login')) {
        router.push(redirect);
      } else if (data.role === 'socio') {
        router.push('/chat');
      } else if (data.role === 'admin') {
        router.push('/admin');
      } else {
        router.push('/dashboard/socios');
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  async function handleTestLogin(role: 'socio' | 'mentor' | 'admin') {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Test login failed');
        setLoading(false);
        return;
      }
      if (data.role === 'socio') router.push('/chat');
      else if (data.role === 'admin') router.push('/admin');
      else router.push('/dashboard/socios');
    } catch {
      setError('Test login failed');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-[#1B2A4A] flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">
            MI
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Mentors International
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            AI Mentorship Platform
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          {/* Sign In / Sign Up toggle */}
          <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(''); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === 'signin'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(''); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === 'signup'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Role Selector */}
          <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
            <button
              type="button"
              onClick={() => {
                setUserType('socio');
                setIdentifier('');
                setError('');
              }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                userType === 'socio'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Socio
            </button>
            <button
              type="button"
              onClick={() => {
                setUserType('mentor');
                setIdentifier('');
                setError('');
              }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                userType === 'mentor'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Mentor / Admin
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Name field (sign up only) */}
            {mode === 'signup' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30 focus:border-[#1B2A4A]"
                />
              </div>
            )}

            {/* Identifier field */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {userType === 'socio' ? 'Phone Number' : 'Email'}
              </label>
              {userType === 'socio' ? (
                <input
                  type="tel"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="573001234567"
                  autoComplete="tel"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30 focus:border-[#1B2A4A]"
                />
              ) : (
                <input
                  type="email"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="mentor@mentorsinternational.org"
                  autoComplete="email"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30 focus:border-[#1B2A4A]"
                />
              )}
            </div>

            {/* Password */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'signup' ? 6 : undefined}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30 focus:border-[#1B2A4A]"
              />
              {mode === 'signin' && userType === 'mentor' && (
                <div className="text-right mt-1">
                  <a href="/forgot-password" className="text-xs text-[#1B2A4A] hover:underline">
                    Forgot password?
                  </a>
                </div>
              )}
            </div>

            {/* Remember Me */}
            <div className="flex items-center mb-6">
              <input
                id="remember"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]/30"
              />
              <label htmlFor="remember" className="ml-2 text-sm text-gray-600">
                Remember me for 30 days
              </label>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#1B2A4A] text-white rounded-lg text-sm font-medium hover:bg-[#263a5e] transition-colors disabled:opacity-50"
            >
              {loading
                ? (mode === 'signin' ? 'Signing in...' : 'Creating account...')
                : (mode === 'signin' ? 'Sign In' : 'Create Account')}
            </button>
          </form>

          {/* Toggle link */}
          <p className="text-center text-sm text-gray-500 mt-4">
            {mode === 'signin' ? (
              <>
                Don&apos;t have an account?{' '}
                <button onClick={switchMode} className="text-[#1B2A4A] font-medium hover:underline">
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button onClick={switchMode} className="text-[#1B2A4A] font-medium hover:underline">
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        {/* Test Bypass Buttons */}
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-medium text-amber-700 mb-3 text-center">
            Demo / Testing Quick Access
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleTestLogin('socio')}
              disabled={loading}
              className="flex-1 py-2 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              Test Socio
            </button>
            <button
              type="button"
              onClick={() => handleTestLogin('mentor')}
              disabled={loading}
              className="flex-1 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              Test Mentor
            </button>
            <button
              type="button"
              onClick={() => handleTestLogin('admin')}
              disabled={loading}
              className="flex-1 py-2 text-xs font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              Test Admin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
