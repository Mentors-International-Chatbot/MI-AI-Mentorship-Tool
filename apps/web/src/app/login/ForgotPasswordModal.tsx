'use client';

import { useState } from 'react';

export function ForgotPasswordLink() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function close() {
    setOpen(false);
    setSubmitted(false);
    setEmail('');
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error || 'Something went wrong');
        setLoading(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-[#1B2A4A] hover:underline"
      >
        Forgot password?
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-password-title"
        >
          <div className="bg-white rounded-xl shadow-lg border p-6 w-full max-w-sm">
            {submitted ? (
              <div className="text-center">
                <p className="text-sm text-gray-700 mb-4">
                  If an account exists with that email, a reset link has been sent.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="text-sm text-[#1B2A4A] font-medium hover:underline"
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <h3 id="forgot-password-title" className="font-semibold text-gray-900 mb-3">
                  Reset Password
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  For mentor and admin accounts. Socios sign in with phone; contact your admin if you
                  need help.
                </p>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  autoComplete="email"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 mb-3 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30 focus:border-[#1B2A4A]"
                />
                {error && (
                  <p className="text-sm text-red-600 mb-3">{error}</p>
                )}
                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    type="button"
                    onClick={close}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !email.trim()}
                    className="px-4 py-2 bg-[#1B2A4A] text-white rounded-lg text-sm font-medium hover:bg-[#263a5e] disabled:opacity-50"
                  >
                    {loading ? 'Sending…' : 'Send reset link'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
