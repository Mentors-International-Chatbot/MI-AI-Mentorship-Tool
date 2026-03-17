'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

type SocioRow = {
  id: string;
  name: string | null;
  businessName: string | null;
  status: string;
  externalId: string;
  channelType: string;
  mentorId: string | null;
  mentor: { id: string; name: string } | null;
  progress: {
    currentLessonNumber: number;
    lastInteractionAt: string | null;
  } | null;
  flags: { id: string; level: string }[];
};

type MentorOption = { id: string; name: string };

const STATUSES = ['', 'NEW', 'AWAITING_LANGUAGE', 'AWAITING_CONSENT', 'AWAITING_NAME', 'ACTIVE'];

export default function AdminSociosPage() {
  const [socios, setSocios] = useState<SocioRow[]>([]);
  const [mentors, setMentors] = useState<MentorOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [mentorFilter, setMentorFilter] = useState('');

  const loadSocios = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', '50');
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (mentorFilter) params.set('mentorId', mentorFilter);

    const res = await fetch(`/api/admin/socios?${params}`);
    const data = await res.json();
    setSocios(data.socios);
    setTotal(data.total);
    setTotalPages(data.totalPages);
    setLoading(false);
  }, [page, search, statusFilter, mentorFilter]);

  useEffect(() => {
    loadSocios();
  }, [loadSocios]);

  useEffect(() => {
    fetch('/api/admin/mentors')
      .then((r) => r.json())
      .then((data) => setMentors(data.map((m: MentorOption) => ({ id: m.id, name: m.name }))));
  }, []);

  async function assignMentor(socioId: string, mentorId: string | null) {
    await fetch('/api/admin/socios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socioId, mentorId: mentorId || null }),
    });
    loadSocios();
  }

  function flagBadge(flags: { level: string }[]) {
    const red = flags.filter((f) => f.level === 'RED').length;
    const yellow = flags.filter((f) => f.level === 'YELLOW').length;
    if (red > 0) return <span className="w-3 h-3 bg-red-500 rounded-full inline-block" title={`${red} red flags`} />;
    if (yellow > 0) return <span className="w-3 h-3 bg-yellow-400 rounded-full inline-block" title={`${yellow} yellow flags`} />;
    return <span className="w-3 h-3 bg-green-400 rounded-full inline-block" title="No flags" />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">
          All Socios <span className="text-gray-400 font-normal text-lg">({total})</span>
        </h2>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name, business, or phone..."
          className="flex-1 border rounded px-3 py-2 text-sm text-gray-900"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="border rounded px-3 py-2 text-sm text-gray-900"
        >
          <option value="">All statuses</option>
          {STATUSES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={mentorFilter}
          onChange={(e) => { setMentorFilter(e.target.value); setPage(1); }}
          className="border rounded px-3 py-2 text-sm text-gray-900"
        >
          <option value="">All mentors</option>
          <option value="unassigned">Unassigned</option>
          {mentors.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <>
          <div className="overflow-x-auto bg-white rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Business</th>
                  <th className="text-left px-4 py-3">Onboarding</th>
                  <th className="text-left px-4 py-3">Lesson</th>
                  <th className="text-left px-4 py-3">Last Active</th>
                  <th className="text-left px-4 py-3">Mentor</th>
                  <th className="text-left px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {socios.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{flagBadge(s.flags)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {s.name ?? <span className="text-gray-400">No name</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{s.businessName ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        s.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {s.progress?.currentLessonNumber ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {s.progress?.lastInteractionAt
                        ? new Date(s.progress.lastInteractionAt).toLocaleDateString()
                        : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={s.mentorId ?? ''}
                        onChange={(e) => assignMentor(s.id, e.target.value || null)}
                        className="border rounded px-2 py-1 text-xs text-gray-900"
                      >
                        <option value="">Unassigned</option>
                        {mentors.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/socios/${s.id}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border rounded text-sm disabled:opacity-30"
              >
                Prev
              </button>
              <span className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border rounded text-sm disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
