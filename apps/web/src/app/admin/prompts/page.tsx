'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PROMPT_CATEGORIES, getPromptCategoryMeta } from '@/lib/ai/prompts/categories';

type Prompt = {
  id: string;
  version: string;
  content: string;
  category: string;
  active: boolean;
  authorId: string;
  createdAt: string;
};

// Rendered from the registry, never a literal. The previous hardcoded list had
// drifted: it offered `core` and `onboarding` (which nothing read) while hiding
// lesson_start, checkin, reminder, mentor_handoff and post_mentor (which are read).
const CATEGORIES = PROMPT_CATEGORIES.map((c) => c.category);

type Course = {
  organizationId: string;
  collectionKey: string;
  programId: string;
  displayName: string;
};

export default function AdminPromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>('');

  function loadPrompts() {
    const params = new URLSearchParams();
    if (filter) params.set('category', filter);
    if (selectedCourse) params.set('collectionKey', selectedCourse);
    const qs = params.toString();
    fetch(qs ? `/api/admin/prompts?${qs}` : '/api/admin/prompts')
      .then((r) => r.json())
      .then((data) => {
        setPrompts(data.prompts ?? []);
        setCourses(data.courses ?? []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadPrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, selectedCourse]);

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

      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="prompt-course-scope" className="text-sm font-medium text-gray-700">
          Course
        </label>
        <select
          id="prompt-course-scope"
          value={selectedCourse}
          onChange={(e) => setSelectedCourse(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm text-gray-900 min-w-[16rem]"
        >
          <option value="">Platform defaults (all courses)</option>
          {courses.map((c) => (
            <option key={c.collectionKey} value={c.collectionKey}>
              {c.displayName}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500">
          {selectedCourse
            ? 'Showing prompts that override the platform default for this course.'
            : 'Showing platform defaults, inherited by every course without an override.'}
        </span>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 mb-6 flex-wrap">
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
            {getPromptCategoryMeta(cat)?.label ?? cat}
          </button>
        ))}
      </div>

      {showCreate && (
        <CreatePromptForm
          collectionKey={selectedCourse}
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
            <div className="mb-3 border-b pb-2">
              <h3 className="text-lg font-semibold text-gray-700">
                {getPromptCategoryMeta(category)?.label ?? category.replace(/_/g, ' ')}
                {getPromptCategoryMeta(category)?.scope === 'platform' && (
                  <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-normal text-amber-800">
                    platform-wide &middot; admin only
                  </span>
                )}
              </h3>
              {getPromptCategoryMeta(category)?.description && (
                <p className="mt-0.5 text-sm text-gray-500">
                  {getPromptCategoryMeta(category)!.description}
                </p>
              )}
            </div>
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
  collectionKey,
}: {
  onCreated: () => void;
  onCancel: () => void;
  /** Empty string creates a platform default; a course key creates an override. */
  collectionKey: string;
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
      body: JSON.stringify({ version, category, content, collectionKey: collectionKey || null }),
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
              <option key={c} value={c}>
                {getPromptCategoryMeta(c)?.label ?? c}
              </option>
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
