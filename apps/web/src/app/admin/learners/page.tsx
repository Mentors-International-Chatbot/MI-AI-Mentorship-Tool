'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CourseCardGrid } from '@/app/dashboard/learners/CourseCardGrid';
import type { CourseRollup } from '@/app/dashboard/learners/courseRollup';
import { getDashboardStrings } from '@/lib/i18n/dashboard';

// The admin surface has no dashboard language provider — every label on it is
// English. Pinning the card chrome to the same language keeps the page
// coherent; the strings still come from the table, not from string literals,
// so wiring real language resolution here later changes only this line.
const ADMIN_LANG = 'en' as const;
const adminStrings = getDashboardStrings(ADMIN_LANG);

type SocioRow = {
  id: string;
  name: string | null;
  businessName: string | null;
  businessDescription: string | null;
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
  latestRating: {
    rating: number | null;
    comment: string | null;
    lessonNum: number;
    createdAt: string;
  } | null;
};

type MentorOption = { id: string; name: string };

const STATUSES = [
  '',
  'NEW',
  'AWAITING_LANGUAGE',
  'AWAITING_CONSENT',
  'AWAITING_NAME',
  'AWAITING_BUSINESS',
  'ACTIVE',
];

export default function AdminSociosPage() {
  const [socios, setSocios] = useState<SocioRow[]>([]);
  const [mentors, setMentors] = useState<MentorOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [mentorFilter, setMentorFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('ALL');
  const [rollups, setRollups] = useState<CourseRollup[]>([]);

  // Everything except pagination — the rollups share these so the cards always
  // describe the same set the table is drawn from.
  const filterQuery = `${search ? `&search=${encodeURIComponent(search)}` : ''}${
    statusFilter ? `&status=${encodeURIComponent(statusFilter)}` : ''
  }${mentorFilter ? `&mentorId=${encodeURIComponent(mentorFilter)}` : ''}${
    courseFilter !== 'ALL' ? `&collectionKey=${encodeURIComponent(courseFilter)}` : ''
  }`;

  useEffect(() => {
    fetch(`/api/admin/socios?page=${page}&pageSize=50${filterQuery}`)
      .then((r) => r.json())
      .then((data) => {
        setSocios(data.socios);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      })
      .finally(() => setLoading(false));
  }, [page, filterQuery, refreshTick]);

  // Course selection is not applied to the rollups themselves: selecting a card
  // should narrow the table, not collapse the grid to the one card you clicked.
  const rollupQuery = `${search ? `&search=${encodeURIComponent(search)}` : ''}${
    statusFilter ? `&status=${encodeURIComponent(statusFilter)}` : ''
  }${mentorFilter ? `&mentorId=${encodeURIComponent(mentorFilter)}` : ''}`;

  useEffect(() => {
    fetch(`/api/admin/socios/rollups?${rollupQuery}`)
      .then((r) => r.json())
      .then((data) => setRollups(data.rollups ?? []))
      .catch(() => setRollups([]));
  }, [rollupQuery, refreshTick]);

  useEffect(() => {
    fetch('/api/admin/mentors')
      .then((r) => r.json())
      .then((data) => setMentors(data.map((m: MentorOption) => ({ id: m.id, name: m.name }))));
  }, []);

  function toggleSocioSelected(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleSelectAllOnPage() {
    const pageIds = socios.map((s) => s.id);
    const allSelected =
      pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...pageIds])]);
    }
  }

  async function deleteSelectedSocios() {
    if (selectedIds.length === 0) return;
    const labels = selectedIds.slice(0, 3).map((id) => {
      const row = socios.find((s) => s.id === id);
      return row?.name ?? id;
    });
    const suffix =
      selectedIds.length > 3 ? ` and ${selectedIds.length - 3} more` : '';
    if (
      !confirm(
        `Delete ${selectedIds.length} learners (${labels.join(', ')}${suffix})? This will remove all their messages, flags, progress, and summaries.`,
      )
    ) {
      return;
    }
    await fetch('/api/admin/socios', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socioIds: selectedIds }),
    });
    setSelectedIds([]);
    setLoading(true);
    setRefreshTick((v) => v + 1);
  }

  async function deleteSocio(socioId: string, name: string | null) {
    if (!confirm(`Delete learner "${name ?? 'unnamed'}"? This will remove all their messages, flags, progress, and summaries.`)) return;
    await fetch('/api/admin/socios', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socioId }),
    });
    setSelectedIds((prev) => prev.filter((id) => id !== socioId));
    setLoading(true);
    setRefreshTick((v) => v + 1);
  }

  async function assignMentor(socioId: string, mentorId: string | null) {
    await fetch('/api/admin/socios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socioId, mentorId: mentorId || null }),
    });
    setLoading(true);
    setRefreshTick((v) => v + 1);
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">
          All Learners <span className="text-gray-400 font-normal text-lg">({total})</span>
        </h2>
        <button
          type="button"
          disabled={selectedIds.length === 0}
          onClick={() => void deleteSelectedSocios()}
          className="px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-40 disabled:pointer-events-none"
        >
          Delete selected ({selectedIds.length})
        </button>
      </div>

      <div className="mb-4">
        <CourseCardGrid
          rollups={rollups}
          selectedKey={courseFilter}
          onSelect={(key) => {
            setLoading(true);
            setCourseFilter((current) => (current === key ? 'ALL' : key));
            setPage(1);
          }}
          t={adminStrings}
          lang={ADMIN_LANG}
        />
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => { setLoading(true); setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name, business, or phone..."
          aria-label="Search learners by name, business, or phone"
          className="flex-1 border rounded px-3 py-2 text-sm text-gray-900"
        />
        <select
          aria-label="Filter by onboarding status"
          value={statusFilter}
          onChange={(e) => { setLoading(true); setStatusFilter(e.target.value); setPage(1); }}
          className="border rounded px-3 py-2 text-sm text-gray-900"
        >
          <option value="">All statuses</option>
          {STATUSES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Filter by mentor"
          value={mentorFilter}
          onChange={(e) => { setLoading(true); setMentorFilter(e.target.value); setPage(1); }}
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
                  <th className="w-10 px-2 py-3">
                    <input
                      type="checkbox"
                      checked={
                        socios.length > 0 &&
                        socios.every((s) => selectedIds.includes(s.id))
                      }
                      onChange={toggleSelectAllOnPage}
                      aria-label="Select all learners on this page"
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Business</th>
                  <th className="text-left px-4 py-3">Onboarding</th>
                  <th className="text-left px-4 py-3">Lesson</th>
                  <th className="px-4 py-3 text-center">Rating</th>
                  <th className="text-left px-4 py-3">Last Active</th>
                  <th className="text-left px-4 py-3">Mentor</th>
                  <th className="text-left px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {socios.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-2 py-3 align-middle">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(s.id)}
                        onChange={() => toggleSocioSelected(s.id)}
                        aria-label={`Select learner ${s.name ?? s.id}`}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-3">{flagBadge(s.flags)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {s.name ?? <span className="text-gray-400">No name</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate" title={s.businessName || s.businessDescription || undefined}>
                      {s.businessName || s.businessDescription || '—'}
                    </td>
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
                    <td className="px-4 py-3 text-center">
                      {s.latestRating?.rating != null ? (
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                            s.latestRating.rating >= 8
                              ? 'bg-green-100 text-green-700'
                              : s.latestRating.rating >= 5
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                          }`}
                          title={
                            s.latestRating.createdAt
                              ? `Latest: ${new Date(s.latestRating.createdAt).toLocaleString()}`
                              : undefined
                          }
                        >
                          {s.latestRating.rating}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {s.progress?.lastInteractionAt
                        ? new Date(s.progress.lastInteractionAt).toLocaleDateString()
                        : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Assign mentor for ${s.name ?? s.id}`}
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
                    <td className="px-4 py-3 flex gap-2">
                      <Link
                        href={`/admin/learners/${s.id}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        Detail
                      </Link>
                      <button
                        onClick={() => deleteSocio(s.id, s.name)}
                        className="px-2 py-1 text-xs text-red-600 bg-red-50 rounded hover:bg-red-600 hover:text-white transition-colors"
                      >
                        Delete
                      </button>
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
                onClick={() => { setLoading(true); setPage((p) => Math.max(1, p - 1)); }}
                disabled={page === 1}
                className="px-3 py-1 border rounded text-sm disabled:opacity-30"
              >
                Prev
              </button>
              <span className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => { setLoading(true); setPage((p) => Math.min(totalPages, p + 1)); }}
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
