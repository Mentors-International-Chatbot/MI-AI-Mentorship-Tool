'use client';

import { useCallback, useEffect, useState } from 'react';

type LogRow = {
  id: string;
  level: string;
  category: string;
  message: string;
  metadata: string | null;
  createdAt: string;
};

type Stats = { errorCount24h: number; totalEvents24h: number };

type LogKindFilter = 'all' | 'error' | 'operational';

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [logKind, setLogKind] = useState<LogKindFilter>('all');
  const [level, setLevel] = useState('');
  const [category, setCategory] = useState('');

  const buildQuery = useCallback(() => {
    const q = new URLSearchParams();
    if (logKind === 'error') q.set('type', 'error');
    else if (logKind === 'operational') q.set('type', 'operational');
    if (level) q.set('level', level);
    if (category) q.set('category', category);
    q.set('limit', '100');
    return q;
  }, [logKind, level, category]);

  useEffect(() => {
    let cancelled = false;
    const q = buildQuery();

    void (async () => {
      await Promise.resolve();
      if (!cancelled) setLoading(true);
      try {
        const res = await fetch(`/api/admin/logs?${q.toString()}`);
        const data = (await res.json()) as { logs?: LogRow[]; stats?: Stats };
        if (!cancelled) {
          setLogs(data.logs ?? []);
          setStats(data.stats ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [buildQuery]);

  async function refresh() {
    const q = buildQuery();
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/logs?${q.toString()}`);
      const data = (await res.json()) as { logs?: LogRow[]; stats?: Stats };
      setLogs(data.logs ?? []);
      setStats(data.stats ?? null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">System logs</h2>
          <p className="text-sm text-gray-500 mt-1">
            Recent structured events (console + database). For pilot visibility only.
          </p>
        </div>
        {stats && (
          <div className="flex gap-3 text-sm">
            <span className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-800">
              Last 24h: <strong>{stats.totalEvents24h}</strong> events
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-red-50 text-red-800 border border-red-200">
              Errors 24h: <strong>{stats.errorCount24h}</strong>
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div
          className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5"
          role="radiogroup"
          aria-label="Log kind"
        >
          {(
            [
              { id: 'all' as const, label: 'All' },
              { id: 'operational' as const, label: 'Operational' },
              { id: 'error' as const, label: 'Errors' },
            ] as const
          ).map(({ id, label }) => (
            <label
              key={id}
              className={
                logKind === id
                  ? 'cursor-pointer rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm'
                  : 'cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900'
              }
            >
              <input
                type="radio"
                name="admin-log-kind"
                value={id}
                checked={logKind === id}
                onChange={() => setLogKind(id)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        <select
          aria-label="Filter by level"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">All levels</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">All categories</option>
          <option value="ai">ai</option>
          <option value="webhook">webhook</option>
          <option value="auth">auth</option>
          <option value="cron">cron</option>
          <option value="system">system</option>
        </select>
        <button
          type="button"
          onClick={() => void refresh()}
          className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="text-gray-400">No log entries match filters.</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-3 py-2 whitespace-nowrap">Time</th>
                <th className="px-3 py-2">Level</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Message</th>
                <th className="px-3 py-2">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((row) => {
                const isErr = row.level === 'error';
                const isWarn = row.level === 'warn';
                return (
                  <tr
                    key={row.id}
                    className={
                      isErr
                        ? 'bg-red-50/80'
                        : isWarn
                          ? 'bg-amber-50/60'
                          : 'hover:bg-gray-50'
                    }
                  >
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap align-top">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-medium align-top">{row.level}</td>
                    <td className="px-3 py-2 align-top">{row.category}</td>
                    <td className="px-3 py-2 text-gray-900 align-top max-w-md">{row.message}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 font-mono align-top max-w-xs break-all">
                      {row.metadata ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
