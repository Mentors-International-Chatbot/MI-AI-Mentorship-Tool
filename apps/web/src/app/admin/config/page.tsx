'use client';

import { useEffect, useState } from 'react';

type ConfigRow = {
  id: string;
  key: string;
  value: string;
  type: string;
  label: string;
  description: string | null;
  category: string;
  /** True when the value comes from the platform tier, not this course. */
  inherited: boolean;
};

type Course = {
  organizationId: string;
  collectionKey: string;
  programId: string;
  displayName: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  lesson_pacing: 'Lesson Pacing',
  ai_behavior: 'AI Behavior',
  flagging: 'Flagging Thresholds',
  reminders: 'Reminders',
  onboarding: 'Onboarding',
  sentiment: 'Sentiment',
  summaries: 'Weekly summaries',
};

const SUMMARY_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Português' },
];

export default function AdminConfigPage() {
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function load(collectionKey: string) {
    setLoading(true);
    const url = collectionKey
      ? `/api/admin/config?collectionKey=${encodeURIComponent(collectionKey)}`
      : '/api/admin/config';
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setConfigs(data.rows ?? []);
        setCourses(data.courses ?? []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function handleChange(key: string, value: string) {
    setConfigs((prev) =>
      prev.map((c) => (c.key === key ? { ...c, value } : c)),
    );
  }

  async function handleSave(key: string, value: string) {
    setSaving(key);
    setSaved(null);
    await fetch('/api/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, collectionKey: selected || null }),
    });
    setSaving(null);
    setSaved(key);
    // Saving a course value turns an inherited row into an override; reflect
    // that immediately rather than waiting for the next page load.
    setConfigs((prev) =>
      prev.map((c) => (c.key === key && selected ? { ...c, inherited: false } : c)),
    );
    setTimeout(() => setSaved((s) => (s === key ? null : s)), 2000);
  }

  /** Drops the course override so the setting inherits the platform value again. */
  async function handleRevert(key: string) {
    if (!selected) return;
    setSaving(key);
    await fetch(
      `/api/admin/config?key=${encodeURIComponent(key)}&collectionKey=${encodeURIComponent(selected)}`,
      { method: 'DELETE' },
    );
    setSaving(null);
    load(selected);
  }

  // Group by category
  const grouped = configs.reduce<Record<string, ConfigRow[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c);
    return acc;
  }, {});

  if (loading) {
    return <p className="text-gray-500">Loading configuration...</p>;
  }

  if (configs.length === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Program Configuration</h2>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h3 className="font-semibold mb-2">No configuration loaded</h3>
          <p className="text-sm mb-3">
            The <code className="bg-amber-100 px-1 rounded">program_config</code> table is empty.
            Run the database seed from <code className="bg-amber-100 px-1 rounded">apps/web</code> to populate it:
          </p>
          <pre className="text-sm bg-amber-100 p-3 rounded font-mono">npx prisma db seed</pre>
          <p className="text-xs mt-3 text-amber-700">
            This creates default entries for lesson pacing, AI behavior, flagging, reminders, onboarding, and sentiment thresholds.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Program Configuration</h2>
      <p className="text-sm text-gray-600 mb-4">
        {selected
          ? 'Values you change here apply to this course only. Settings marked “inherited” are using the platform default.'
          : 'Editing platform defaults. Every course inherits these unless it sets its own value.'}
      </p>

      <div className="mb-6 flex items-center gap-3">
        <label htmlFor="course-scope" className="text-sm font-medium text-gray-700">
          Course
        </label>
        <select
          id="course-scope"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm text-gray-900 min-w-[16rem]"
        >
          <option value="">Platform defaults (all courses)</option>
          {courses.map((c) => (
            <option key={c.collectionKey} value={c.collectionKey}>
              {c.displayName}
            </option>
          ))}
        </select>
      </div>

      {Object.entries(grouped).map(([category, rows]) => (
        <div key={category} className="mb-8">
          <h3 className="text-lg font-semibold text-gray-700 mb-3 border-b pb-2">
            {CATEGORY_LABELS[category] ?? category}
          </h3>
          <div className="grid gap-4">
            {rows.map((cfg) => (
              <ConfigField
                key={cfg.key}
                config={cfg}
                onChange={handleChange}
                onSave={handleSave}
                onRevert={selected ? handleRevert : undefined}
                isSaving={saving === cfg.key}
                isSaved={saved === cfg.key}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfigField({
  config,
  onChange,
  onSave,
  onRevert,
  isSaving,
  isSaved,
}: {
  config: ConfigRow;
  onChange: (key: string, value: string) => void;
  onSave: (key: string, value: string) => void;
  /** Present only when a course is selected — there is nothing to revert to at the platform tier. */
  onRevert?: (key: string) => void;
  isSaving: boolean;
  isSaved: boolean;
}) {
  const { key, value, type, label, description, inherited } = config;

  return (
    <div className="bg-white rounded-lg border p-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900">
          {label}
          {onRevert && inherited && (
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
              inherited
            </span>
          )}
          {onRevert && !inherited && (
            <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-normal text-blue-700">
              course override
            </span>
          )}
        </div>
        {description && (
          <div className="text-sm text-gray-500 mt-0.5">{description}</div>
        )}
        <div className="text-xs text-gray-400 font-mono mt-1">{key}</div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {type === 'boolean' ? (
          <button
            type="button"
            onClick={() => {
              const next = value === 'true' ? 'false' : 'true';
              onChange(key, next);
              onSave(key, next);
            }}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              value === 'true' ? 'bg-blue-600' : 'bg-gray-300'
            }`}
            aria-label={`${label}: ${value === 'true' ? 'on' : 'off'}`}
            title={label}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                value === 'true' ? 'translate-x-6' : ''
              }`}
            />
          </button>
        ) : type === 'string' && key === 'SUMMARY_LANGUAGE' ? (
          <select
            value={SUMMARY_LANGUAGE_OPTIONS.some((o) => o.value === value) ? value : 'es'}
            onChange={(e) => {
              const next = e.target.value;
              onChange(key, next);
              onSave(key, next);
            }}
            className="border rounded px-2 py-1.5 text-sm text-gray-900 min-w-[10rem]"
            aria-label={label}
          >
            {SUMMARY_LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              type="number"
              value={value}
              onChange={(e) => onChange(key, e.target.value)}
              onBlur={() => onSave(key, value)}
              onKeyDown={(e) => e.key === 'Enter' && onSave(key, value)}
              className="w-20 border rounded px-2 py-1 text-center text-gray-900"
              aria-label={label}
              title={label}
              placeholder={label}
            />
          </>
        )}

        {onRevert && !inherited && (
          <button
            type="button"
            onClick={() => onRevert(key)}
            className="text-xs text-gray-500 hover:text-gray-800 underline"
          >
            Reset
          </button>
        )}

        {isSaving && (
          <span className="text-xs text-gray-400">Saving...</span>
        )}
        {isSaved && (
          <span className="text-xs text-green-600 font-medium">Saved</span>
        )}
      </div>
    </div>
  );
}
