'use client';

import { useEffect, useState } from 'react';

type FeedbackRow = {
  id: string;
  page: string;
  subject: string;
  body: string;
  createdAt: string;
};

function fenceBody(body: string): string {
  const fence = body.includes('```') ? '````' : '```';
  return `${fence}text\n${body}\n${fence}`;
}

/** Markdown suitable for pasting into Claude to prioritize fixes by page/context. */
function buildFeedbackMarkdown(rows: FeedbackRow[], scopeLabel: string): string {
  const generated = new Date();
  const iso = generated.toISOString();
  const readable = generated.toLocaleString();

  const lines: string[] = [
    '# Beta feedback export',
    '',
    `- **Generated:** ${iso} (${readable})`,
    `- **Scope:** ${scopeLabel}`,
    `- **Count:** ${rows.length}`,
    '',
    '## How to use this file',
    '',
    'Each item is user-reported feedback. The **Page** field indicates where in the app the issue was observed—use it to locate relevant routes and components. Prioritize fixes that align with the described behavior and context.',
    '',
    '## Feedback items',
    '',
  ];

  rows.forEach((f, i) => {
    const d = new Date(f.createdAt);
    lines.push(`### ${i + 1}. ${f.subject.replace(/\n/g, ' ')}`);
    lines.push('');
    lines.push(`- **Page:** ${f.page}`);
    lines.push(`- **Date:** ${d.toISOString()} (${d.toLocaleString()})`);
    lines.push(`- **ID:** \`${f.id}\``);
    lines.push('');
    lines.push(fenceBody(f.body));
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

function downloadMarkdownFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportFilename(scope: 'all' | 'filtered'): string {
  const day = new Date().toISOString().slice(0, 10);
  return scope === 'all'
    ? `feedback-export-${day}.md`
    : `feedback-export-filtered-${day}.md`;
}

export default function AdminFeedbackPage() {
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetch('/api/feedback')
      .then(async (r) => {
        // Mentors can reach /admin but the feedback API is admin-only, so a
        // 403 here is expected rather than an error. Guard the array shape too:
        // an error body would otherwise blow up the .map below.
        if (!r.ok) {
          setDenied(true);
          return;
        }
        const data = await r.json();
        setFeedback(Array.isArray(data) ? data : []);
      })
      .catch(() => setDenied(true))
      .finally(() => setLoading(false));
  }, []);

  const uniquePages = ['all', ...new Set(feedback.map((f) => f.page))];
  const filtered = filter === 'all' ? feedback : feedback.filter((f) => f.page === filter);

  if (loading) return <p className="text-gray-500">Loading feedback...</p>;

  if (denied) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Beta Feedback</h2>
        <p className="text-sm text-gray-500 mt-2">
          Feedback submissions are visible to admins only.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Beta Feedback</h2>
          <p className="text-sm text-gray-500 mt-1">
            {feedback.length} submission{feedback.length !== 1 ? 's' : ''} total
          </p>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:max-w-none sm:justify-end">
          <select
            aria-label="Filter feedback by page"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="min-w-0 flex-1 border rounded-lg px-3 py-2 text-sm text-gray-900 sm:flex-initial sm:min-w-[10rem]"
          >
            {uniquePages.map((p) => (
              <option key={p} value={p}>
                {p === 'all' ? 'All pages' : p}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const md = buildFeedbackMarkdown(feedback, 'All submissions');
              downloadMarkdownFile(exportFilename('all'), md);
            }}
            className="shrink-0 rounded-lg border border-[#1B2A4A] bg-[#1B2A4A] px-3 py-2 text-sm font-medium text-white hover:bg-[#263a5e]"
          >
            Export all (Markdown)
          </button>
          {filter !== 'all' && (
            <button
              type="button"
              disabled={filtered.length === 0}
              onClick={() => {
                const md = buildFeedbackMarkdown(
                  filtered,
                  `Filtered by page: ${filter}`,
                );
                downloadMarkdownFile(exportFilename('filtered'), md);
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export filtered ({filtered.length})
            </button>
          )}
        </div>
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
