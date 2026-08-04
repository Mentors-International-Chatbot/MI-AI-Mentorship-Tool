'use client';

import { useEffect, useState } from 'react';
import type { SessionRole } from '@/lib/auth/token';

const PAGE_OPTIONS = [
  { value: 'chat', label: 'Web Chat (/chat)' },
  { value: 'dashboard-socios', label: 'Mentor Dashboard — Socios List' },
  { value: 'dashboard-socio-detail', label: 'Mentor Dashboard — Socio Detail' },
  { value: 'admin-overview', label: 'Admin — Overview' },
  { value: 'admin-config', label: 'Admin — Config' },
  { value: 'admin-prompts', label: 'Admin — Prompts' },
  { value: 'admin-socios', label: 'Admin — Socios' },
  { value: 'admin-mentors', label: 'Admin — Mentors' },
  { value: 'whatsapp', label: 'WhatsApp Bot (not a page — general bot feedback)' },
  { value: 'other', label: 'Other / General' },
];

type FeedbackButtonProps = {
  /** When `socio`, page is fixed to `chat` and the page dropdown is hidden. */
  userRole?: SessionRole | null;
};

export default function FeedbackButton({ userRole }: FeedbackButtonProps) {
  const isSocio = userRole === 'socio';

  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(isSocio ? 'chat' : '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setPage(isSocio ? 'chat' : '');
  }, [isSocio]);

  function reset() {
    setPage(isSocio ? 'chat' : '');
    setSubject('');
    setBody('');
    setError('');
    setSubmitted(false);
  }

  function handleClose() {
    setOpen(false);
    setTimeout(reset, 200);
  }

  async function handleSubmit() {
    const effectivePage = isSocio ? 'chat' : page;
    if (!effectivePage || !subject.trim() || !body.trim()) {
      setError('Please fill in all fields.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: effectivePage,
          subject: subject.trim(),
          body: body.trim(),
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to submit');
      }

      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Floating button — always visible */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-[#1B2A4A] text-white px-4 py-2.5 rounded-full shadow-lg hover:bg-[#263a5e] transition-colors text-sm font-medium flex items-center gap-2"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        Feedback
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={handleClose}
          />

          {/* Modal */}
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
            {submitted ? (
              /* Success state */
              <div className="text-center py-8">
                <div className="text-4xl mb-3">&#x2705;</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  Thank you for your feedback!
                </h3>
                <p className="text-sm text-gray-500 mb-6">
                  Your feedback has been recorded and will be reviewed by the team.
                </p>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-[#1B2A4A] text-white rounded-lg text-sm hover:bg-[#263a5e]"
                >
                  Close
                </button>
              </div>
            ) : (
              /* Form */
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Send Feedback
                  </h3>
                  <button
                    onClick={handleClose}
                    className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                  >
                    &times;
                  </button>
                </div>

                <p className="text-sm text-gray-500 mb-4">
                  Help us improve! Tell us what&apos;s working, what&apos;s broken, or what you&apos;d change.
                </p>

                {/* Page — hidden for socios (they only use Web Chat) */}
                {!isSocio && (
                  <>
                    <label
                      htmlFor="feedback-page"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      Which page is this about?
                    </label>
                    <select
                      id="feedback-page"
                      value={page}
                      onChange={(e) => setPage(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 mb-4 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
                    >
                      <option value="">Select a page...</option>
                      {PAGE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                {/* Subject */}
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject
                </label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Bug with lesson progress display"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 mb-4 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
                />

                {/* Body */}
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Feedback
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Describe what you noticed, what you expected, or what you'd improve..."
                  rows={5}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 mb-4 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30 resize-y"
                />

                {error && (
                  <p className="text-sm text-red-600 mb-3">{error}</p>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="px-4 py-2 bg-[#1B2A4A] text-white rounded-lg text-sm hover:bg-[#263a5e] disabled:opacity-50"
                  >
                    {submitting ? 'Submitting...' : 'Submit Feedback'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
