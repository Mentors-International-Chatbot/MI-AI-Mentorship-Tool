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
    setLoading(true);
    loadMentors();
  }

  useEffect(() => { loadMentors(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Mentors</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          + Add Mentor
        </button>
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
          {mentors.map((m) => (
            <div key={m.id} className="bg-white rounded-lg border p-4 flex items-center gap-6">
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded px-3 py-2 text-gray-900"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2 text-gray-900"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full border rounded px-3 py-2 text-gray-900"
          >
            <option value="mentor">Mentor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
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
