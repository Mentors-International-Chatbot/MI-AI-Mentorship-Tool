'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Prompt = {
  id: string;
  version: string;
  content: string;
  category: string;
  active: boolean;
  authorId: string;
  createdAt: string;
};

const CATEGORIES = [
  'core',
  'onboarding',
  'lesson_delivery',
  'freeform',
  'reteach',
  'sentiment',
  'name_extraction',
];

export default function AdminPromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);

  function loadPrompts() {
    const url = filter
      ? `/api/admin/prompts?category=${filter}`
      : '/api/admin/prompts';
    fetch(url)
      .then((r) => r.json())
      .then(setPrompts)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadPrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function toggleActive(id: string, active: boolean) {
    await fetch('/api/admin/prompts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active }),
    });
    loadPrompts();
  }

  // Group by category
  const grouped = prompts.reduce<Record<string, Prompt[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">System Prompts</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          + New Prompt
        </button>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setFilter('')}
          className={`px-3 py-1 rounded text-sm ${
            !filter ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3 py-1 rounded text-sm ${
              filter === cat
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {showCreate && (
        <CreatePromptForm
          onCreated={() => { setShowCreate(false); loadPrompts(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loading ? (
        <p className="text-gray-500">Loading prompts...</p>
      ) : prompts.length === 0 ? (
        <p className="text-gray-500">No prompts found.</p>
      ) : (
        Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="mb-8">
            <h3 className="text-lg font-semibold text-gray-700 mb-3 border-b pb-2 capitalize">
              {category.replace(/_/g, ' ')}
            </h3>
            <div className="grid gap-3">
              {items.map((p) => (
                <div
                  key={p.id}
                  className={`bg-white rounded-lg border p-4 ${
                    p.active ? 'border-green-300 ring-1 ring-green-200' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          v{p.version}
                        </span>
                        {p.active && (
                          <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full font-medium">
                            Active
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <pre className="mt-2 text-sm text-gray-600 whitespace-pre-wrap line-clamp-3 font-sans">
                        {p.content}
                      </pre>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Link
                        href={`/admin/prompts/${p.id}`}
                        className="px-3 py-1 text-sm border rounded hover:bg-gray-50 text-gray-700"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => toggleActive(p.id, !p.active)}
                        className={`px-3 py-1 text-sm rounded ${
                          p.active
                            ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                        }`}
                      >
                        {p.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function CreatePromptForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [version, setVersion] = useState('');
  const [category, setCategory] = useState('core');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/admin/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, category, content }),
    });
    setSaving(false);
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border rounded-lg p-6 mb-6">
      <h3 className="text-lg font-semibold mb-4">Create New Prompt Version</h3>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="e.g. 2.0"
            className="w-full border rounded px-3 py-2 text-gray-900"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full border rounded px-3 py-2 text-gray-900"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Prompt Content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={12}
          className="w-full border rounded px-3 py-2 font-mono text-sm text-gray-900"
          required
        />
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
