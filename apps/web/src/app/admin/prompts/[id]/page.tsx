'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';

type Prompt = {
  id: string;
  version: string;
  content: string;
  category: string;
  active: boolean;
  authorId: string;
  createdAt: string;
};

export default function PromptEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [allVersions, setAllVersions] = useState<Prompt[]>([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);

  // Test sandbox state
  const [testMessage, setTestMessage] = useState('Hola, quiero aprender sobre finanzas para mi tienda');
  const [testResponse, setTestResponse] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch('/api/admin/prompts')
      .then((r) => r.json())
      .then((all: Prompt[]) => {
        const found = all.find((p: Prompt) => p.id === id);
        if (found) {
          setPrompt(found);
          setContent(found.content);
          // Get all versions in same category for sidebar
          setAllVersions(
            all
              .filter((p: Prompt) => p.category === found.category)
              .sort(
                (a: Prompt, b: Prompt) =>
                  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
              ),
          );
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSaveAsNew() {
    if (!prompt) return;
    // Parse version and bump
    const parts = prompt.version.split('.');
    const major = parts[0] ?? '1';
    const minor = Number(parts[1] ?? 0) + 1;
    const newVersion = `${major}.${minor}`;

    const res = await fetch('/api/admin/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: newVersion,
        category: prompt.category,
        content,
      }),
    });
    const created = await res.json();
    router.push(`/admin/prompts/${created.id}`);
  }

  async function handleActivate() {
    if (!prompt) return;
    await fetch('/api/admin/prompts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: prompt.id, active: true }),
    });
    setPrompt({ ...prompt, active: true });
    setAllVersions((prev) =>
      prev.map((p) => ({
        ...p,
        active: p.id === prompt.id ? true : false,
      })),
    );
  }

  async function handleTest() {
    setTesting(true);
    setTestResponse('');
    try {
      const res = await fetch('/api/admin/prompts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptContent: content, testMessage }),
      });
      const data = await res.json();
      setTestResponse(data.response ?? data.error ?? 'No response');
    } catch {
      setTestResponse('Error calling AI');
    }
    setTesting(false);
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (!prompt) return <p className="text-red-500">Prompt not found.</p>;

  const hasChanges = content !== prompt.content;

  return (
    <div className="grid grid-cols-[1fr_280px] gap-6">
      {/* Main editor */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => router.push('/admin/prompts')}
            className="text-sm text-blue-600 hover:underline"
          >
            &larr; Back
          </button>
          <h2 className="text-2xl font-bold text-gray-900">
            {prompt.category} v{prompt.version}
          </h2>
          {prompt.active && (
            <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full font-medium">
              Active
            </span>
          )}
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={20}
          className="w-full border rounded-lg px-4 py-3 font-mono text-sm text-gray-900 mb-4"
        />

        <div className="flex gap-2 mb-8">
          <button
            onClick={handleSaveAsNew}
            disabled={!hasChanges}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
          >
            Save as New Version
          </button>
          {!prompt.active && (
            <button
              onClick={handleActivate}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
            >
              Activate This Version
            </button>
          )}
        </div>

        {/* Test sandbox */}
        <div className="border rounded-lg p-4 bg-gray-50">
          <h3 className="font-semibold text-gray-900 mb-3">Test Sandbox</h3>
          <div className="mb-3">
            <label className="block text-sm text-gray-600 mb-1">Sample learner message:</label>
            <input
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm text-gray-900"
            />
          </div>
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50 mb-3"
          >
            {testing ? 'Testing...' : 'Test This Prompt'}
          </button>
          {testResponse && (
            <div className="bg-white border rounded p-3 mt-2">
              <div className="text-xs text-gray-400 mb-1">AI Response:</div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{testResponse}</p>
            </div>
          )}
        </div>
      </div>

      {/* Version history sidebar */}
      <div className="border-l pl-6">
        <h3 className="font-semibold text-gray-700 mb-3">Version History</h3>
        <div className="space-y-2">
          {allVersions.map((v) => (
            <button
              key={v.id}
              onClick={() => router.push(`/admin/prompts/${v.id}`)}
              className={`w-full text-left p-2 rounded text-sm ${
                v.id === id
                  ? 'bg-blue-50 border border-blue-200'
                  : 'hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">v{v.version}</span>
                {v.active && (
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                )}
              </div>
              <div className="text-xs text-gray-400">
                {new Date(v.createdAt).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
