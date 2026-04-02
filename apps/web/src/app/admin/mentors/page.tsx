'use client';

import { useEffect, useState } from 'react';

type MentorRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  socioCount: number;
  unresolvedFlags: number;
  avgLessonNumber: number | null;
};

export default function AdminMentorsPage() {
  const [mentors, setMentors] = useState<MentorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function loadMentors() {
    fetch('/api/admin/mentors')
      .then((r) => r.json())
      .then(setMentors)
      .finally(() => setLoading(false));
  }

  async function deleteMentor(id: string, name: string) {
    if (!confirm(`Delete mentor "${name}"? Their socios will be unassigned.`)) return;
    await fetch('/api/admin/mentors', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    setLoading(true);
    loadMentors();
  }

  function toggleMentorSelected(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleSelectAllMentors() {
    const ids = mentors.map((m) => m.id);
    const allSelected =
      ids.length > 0 && ids.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...ids])]);
    }
  }

  async function deleteSelectedMentors() {
    if (selectedIds.length === 0) return;
    const labels = selectedIds.slice(0, 3).map((id) => mentors.find((m) => m.id === id)?.name ?? id);
    const suffix =
      selectedIds.length > 3 ? ` and ${selectedIds.length - 3} more` : '';
    if (
      !confirm(
        `Delete ${selectedIds.length} mentors (${labels.join(', ')}${suffix})? Their socios will be unassigned.`,
      )
    ) {
      return;
    }
    await fetch('/api/admin/mentors', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedIds }),
    });
    setSelectedIds([]);
    setLoading(true);
    loadMentors();
  }

  useEffect(() => { loadMentors(); }, []);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Mentors</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => void deleteSelectedMentors()}
            className="px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-40 disabled:pointer-events-none"
          >
            Delete selected ({selectedIds.length})
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            + Add Mentor
          </button>
        </div>
      </div>

      {showCreate && (
        <CreateMentorForm
          onCreated={() => { setShowCreate(false); loadMentors(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : mentors.length === 0 ? (
        <p className="text-gray-500">No mentors yet.</p>
      ) : (
        <div className="grid gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={
                mentors.length > 0 &&
                mentors.every((m) => selectedIds.includes(m.id))
              }
              onChange={toggleSelectAllMentors}
              aria-label="Select all mentors on this page"
              className="rounded border-gray-300"
            />
            <span>Select all</span>
          </div>
          {mentors.map((m) => (
            <div key={m.id} className="bg-white rounded-lg border p-4 flex items-center gap-4">
              <input
                type="checkbox"
                checked={selectedIds.includes(m.id)}
                onChange={() => toggleMentorSelected(m.id)}
                aria-label={`Select mentor ${m.name}`}
                className="rounded border-gray-300 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{m.name}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    m.role === 'admin'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    {m.role}
                  </span>
                </div>
                <div className="text-sm text-gray-500">{m.email}</div>
              </div>

              <div className="flex gap-6 text-center shrink-0">
                <Stat label="Socios" value={m.socioCount} />
                <Stat
                  label="Flags"
                  value={m.unresolvedFlags}
                  color={m.unresolvedFlags > 0 ? 'text-red-600' : undefined}
                />
                <Stat
                  label="Avg Lesson"
                  value={m.avgLessonNumber !== null ? m.avgLessonNumber.toFixed(1) : '-'}
                />
              </div>
              <button
                onClick={() => deleteMentor(m.id, m.name)}
                className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-600 hover:text-white transition-colors shrink-0"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <div className={`text-lg font-bold ${color ?? 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function CreateMentorForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('mentor');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/admin/mentors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, role, password }),
    });
    setSaving(false);
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border rounded-lg p-6 mb-6">
      <h3 className="text-lg font-semibold mb-4">Add New Mentor</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div>
          <label htmlFor="create-mentor-name" className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            id="create-mentor-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded px-3 py-2 text-gray-900"
            required
          />
        </div>
        <div>
          <label htmlFor="create-mentor-email" className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            id="create-mentor-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2 text-gray-900"
            required
          />
        </div>
        <div>
          <label htmlFor="create-mentor-role" className="block text-sm font-medium text-gray-700 mb-1">
            Role
          </label>
          <select
            id="create-mentor-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full border rounded px-3 py-2 text-gray-900"
          >
            <option value="mentor">Mentor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label htmlFor="create-mentor-password" className="block text-sm font-medium text-gray-700 mb-1">
            Password
          </label>
          <input
            id="create-mentor-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2 text-gray-900"
            required
            placeholder="Set initial password"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
