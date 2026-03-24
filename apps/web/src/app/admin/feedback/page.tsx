'use client';

import { useEffect, useState } from 'react';

type FeedbackRow = {
  id: string;
  page: string;
  subject: string;
  body: string;
  createdAt: string;
};

export default function AdminFeedbackPage() {
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetch('/api/feedback')
      .then((r) => r.json())
      .then(setFeedback)
      .finally(() => setLoading(false));
  }, []);

  const uniquePages = ['all', ...new Set(feedback.map((f) => f.page))];
  const filtered = filter === 'all' ? feedback : feedback.filter((f) => f.page === filter);

  if (loading) return <p className="text-gray-500">Loading feedback...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Beta Feedback</h2>
          <p className="text-sm text-gray-500 mt-1">
            {feedback.length} submission{feedback.length !== 1 ? 's' : ''} total
          </p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          {uniquePages.map((p) => (
            <option key={p} value={p}>
              {p === 'all' ? 'All pages' : p}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No feedback yet. The button is live — testers will see it on every page.
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((f) => (
            <div key={f.id} className="bg-white border rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-medium mr-2">
                    {f.page}
                  </span>
                  <span className="font-semibold text-gray-900">{f.subject}</span>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {new Date(f.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{f.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
