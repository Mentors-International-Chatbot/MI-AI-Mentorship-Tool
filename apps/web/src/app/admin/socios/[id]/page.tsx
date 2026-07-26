import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { computeSocioHealth } from '@/lib/health/service';

export const dynamic = 'force-dynamic';

const INTERNAL_OVERRIDE_KEYS = new Set(['awaitingFeedback', 'feedbackLessonNum']);

const TONE_LABELS: Record<string, string> = {
  more_encouraging: 'More encouraging',
  more_direct: 'More direct',
  simpler_language: 'Simpler language',
  family_focused: 'Family focused',
  struggling_business: 'Struggling business support',
};

const CONCISE_LABELS: Record<string, string> = {
  very_brief: 'Very brief',
  brief: 'Brief',
  standard: 'Standard',
  detailed: 'Detailed',
  very_detailed: 'Very detailed',
};

function normalizeSliderTen(v: unknown): number {
  const n = Number(v);
  if (Number.isNaN(n)) return NaN;
  return n <= 1 ? Math.round(n * 10) : Math.round(n);
}

function PromptOverridesDetail({
  overrides,
}: {
  overrides: Record<string, unknown> | null;
}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return <p className="text-sm text-gray-500">Default settings.</p>;
  }

  const entries = Object.entries(overrides).filter(([k]) => !INTERNAL_OVERRIDE_KEYS.has(k));
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">Default settings.</p>;
  }

  const labels: Record<string, string> = {
    warmth: 'Warmth',
    complexity: 'Language Complexity',
    positivity: 'Positivity',
    toneOverride: 'Tone Override',
    conciseness: 'Conciseness',
  };

  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => {
        const isSlider = ['warmth', 'complexity', 'positivity'].includes(key);
        let displayVal: string;
        if (isSlider) {
          const ten = normalizeSliderTen(value);
          displayVal = Number.isNaN(ten) ? String(value) : `${ten}/10`;
        } else if (key === 'toneOverride') {
          displayVal = TONE_LABELS[String(value)] ?? String(value);
        } else if (key === 'conciseness') {
          displayVal = CONCISE_LABELS[String(value)] ?? String(value);
        } else if (typeof value === 'object' && value !== null) {
          displayVal = JSON.stringify(value);
        } else {
          displayVal = String(value);
        }

        return (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-600">{labels[key] ?? key}</span>
            <span className="text-sm font-medium text-gray-900 text-right shrink-0">{displayVal}</span>
          </div>
        );
      })}
    </div>
  );
}

export default async function AdminSocioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const socio = await prisma.socio.findUnique({
    where: { id },
    include: { mentor: true },
  });
  if (!socio) return notFound();

  const [health, progress, flags, lessonProgress, messages, financialSnapshots, feedback] =
    await Promise.all([
      computeSocioHealth(id),
      prisma.socioProgress.findUnique({ where: { socioId: id } }),
      prisma.socioFlag.findMany({ where: { socioId: id }, orderBy: { createdAt: 'desc' } }),
      prisma.lessonProgress.findMany({ where: { socioId: id }, orderBy: { lessonNumber: 'asc' } }),
      prisma.message.findMany({ where: { socioId: id, assessmentSessionId: null }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.financialSnapshot.findMany({ where: { socioId: id }, orderBy: { weekStartDate: 'asc' }, take: 52 }),
      prisma.socioFeedback.findMany({
        where: { socioId: id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

  const healthColor =
    health.status === 'RED' ? 'bg-red-500' : health.status === 'YELLOW' ? 'bg-yellow-400' : 'bg-green-400';

  return (
    <div>
      <Link href="/admin/socios" className="text-sm text-blue-600 hover:underline">
        &larr; Back to socios
      </Link>

      {/* Header */}
      <div className="mt-4 mb-6 flex items-center gap-4">
        <span className={`w-4 h-4 rounded-full ${healthColor}`} />
        <h2 className="text-2xl font-bold text-gray-900">
          {socio.name ?? 'No name'}
        </h2>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          socio.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
        }`}>
          {socio.status}
        </span>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <InfoCard label="Business" value={socio.businessName || socio.businessDescription || '—'} />
        <InfoCard label="Channel" value={`${socio.channelType} / ${socio.externalId}`} />
        <InfoCard label="Current Lesson" value={String(progress?.currentLessonNumber ?? 1)} />
        <InfoCard label="Mentor" value={socio.mentor?.name ?? 'Unassigned'} />
        <InfoCard label="Last Interaction" value={
          progress?.lastInteractionAt
            ? new Date(progress.lastInteractionAt).toLocaleString()
            : 'Never'
        } />
        <InfoCard label="Completed Lessons" value={String(progress?.completedLessons?.length ?? 0)} />
        <InfoCard label="Language" value={socio.language} />
        <InfoCard label="Reminders Sent" value={String(progress?.remindersSent ?? 0)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Flags */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Flags ({flags.length})</h3>
          {flags.length === 0 ? (
            <p className="text-sm text-gray-500">No flags.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {flags.map((f) => (
                <div key={f.id} className={`p-2 rounded text-sm ${
                  f.level === 'RED' ? 'bg-red-50 text-red-800' : 'bg-yellow-50 text-yellow-800'
                } ${f.resolved ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{f.level}</span>
                    {f.resolved && <span className="text-xs">(resolved)</span>}
                  </div>
                  <div className="text-xs mt-0.5">{f.reason}</div>
                  <div className="text-xs opacity-60 mt-0.5">
                    {new Date(f.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Lesson Progress */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Lesson Progress</h3>
          {lessonProgress.length === 0 ? (
            <p className="text-sm text-gray-500">No progress recorded.</p>
          ) : (
            <div className="space-y-2">
              {lessonProgress.map((lp) => (
                <div key={lp.id} className="flex items-center gap-3 text-sm">
                  <span className="font-medium text-gray-700 w-20">Lesson {lp.lessonNumber}</span>
                  <div className="flex-1 h-2 min-w-0">
                    <svg
                      viewBox="0 0 100 8"
                      className="block h-2 w-full"
                      preserveAspectRatio="none"
                      role="img"
                      aria-label={`Lesson ${lp.lessonNumber} score ${lp.understanding ?? 0} of 10`}
                    >
                      <rect width="100" height="8" fill="#f3f4f6" rx="4" />
                      <rect
                        width={Math.min(100, (lp.understanding ?? 0) * 10)}
                        height="8"
                        fill={lp.completedAt ? '#22c55e' : '#60a5fa'}
                        rx="4"
                      />
                    </svg>
                  </div>
                  <span className="text-gray-500 w-8 text-right">
                    {lp.understanding ?? '-'}
                  </span>
                  {lp.completedAt && (
                    <span className="text-xs text-green-600">Done</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Socio satisfaction feedback */}
        <div className="bg-white rounded-lg border p-4 lg:col-span-2">
          <h3 className="font-semibold text-gray-900 mb-3">
            Satisfaction Ratings ({feedback.length})
          </h3>
          {feedback.length === 0 ? (
            <p className="text-sm text-gray-400">No feedback collected yet.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {feedback.map((f) => (
                <div key={f.id} className="flex items-start gap-3 text-sm">
                  <span
                    className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold flex-shrink-0 ${
                      (f.rating ?? 0) >= 8
                        ? 'bg-green-100 text-green-700'
                        : (f.rating ?? 0) >= 5
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {f.rating ?? '?'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-700">{f.comment || 'No comment'}</p>
                    <p className="text-xs text-gray-400">
                      After lesson {f.lessonNum} · {new Date(f.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prompt Overrides */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Prompt Overrides</h3>
          <PromptOverridesDetail
            overrides={
              socio.promptOverrides &&
              typeof socio.promptOverrides === 'object' &&
              !Array.isArray(socio.promptOverrides)
                ? (socio.promptOverrides as Record<string, unknown>)
                : null
            }
          />
        </div>

        {/* Recent conversation */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-3">
            Recent Messages ({messages.length})
          </h3>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {messages.reverse().map((m) => (
              <div
                key={m.id}
                className={`p-2 rounded text-sm ${
                  m.role === 'user'
                    ? 'bg-blue-50 text-blue-900'
                    : m.role === 'assistant'
                    ? 'bg-gray-50 text-gray-800'
                    : 'bg-yellow-50 text-yellow-800'
                }`}
              >
                <div className="text-xs font-medium opacity-60 mb-0.5">
                  {m.role === 'user' ? 'Socio' : m.role === 'assistant' ? 'AI' : m.role}
                  {' - '}
                  {new Date(m.createdAt).toLocaleString()}
                </div>
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Financial History */}
        <div className="bg-white rounded-lg border p-4 lg:col-span-2">
          <h3 className="font-semibold text-gray-900 mb-3">Financial History</h3>
          {financialSnapshots.length === 0 ? (
            <p className="text-sm text-gray-500">No financial data reported yet.</p>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500 inline-block" /> Revenue</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Net Profit</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-400 inline-block" /> Costs</span>
              </div>
              <div className="space-y-3">
                {(() => {
                  const maxVal = Math.max(...financialSnapshots.map((s) => Math.max(s.revenue, s.netProfit, s.revenue - s.netProfit)), 1);
                  return financialSnapshots.map((s) => {
                    const costs = s.revenue - s.netProfit;
                    const weekLabel = new Date(s.weekStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    return (
                      <div key={s.id} className="text-sm">
                        <div className="text-gray-600 font-medium mb-1">{weekLabel}</div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-3 min-w-0">
                              <svg
                                viewBox="0 0 100 12"
                                className="block h-3 w-full"
                                preserveAspectRatio="none"
                                role="img"
                                aria-label={`Revenue ${s.revenue} for week of ${weekLabel}`}
                              >
                                <rect width="100" height="12" fill="#f3f4f6" rx="6" />
                                <rect
                                  width={(s.revenue / maxVal) * 100}
                                  height="12"
                                  fill="#3b82f6"
                                  rx="6"
                                />
                              </svg>
                            </div>
                            <span className="text-xs text-gray-500 w-20 text-right">${s.revenue.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-3 min-w-0">
                              <svg
                                viewBox="0 0 100 12"
                                className="block h-3 w-full"
                                preserveAspectRatio="none"
                                role="img"
                                aria-label={`Net profit ${s.netProfit} for week of ${weekLabel}`}
                              >
                                <rect width="100" height="12" fill="#f3f4f6" rx="6" />
                                <rect
                                  width={(s.netProfit / maxVal) * 100}
                                  height="12"
                                  fill="#22c55e"
                                  rx="6"
                                />
                              </svg>
                            </div>
                            <span className="text-xs text-gray-500 w-20 text-right">${s.netProfit.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-3 min-w-0">
                              <svg
                                viewBox="0 0 100 12"
                                className="block h-3 w-full"
                                preserveAspectRatio="none"
                                role="img"
                                aria-label={`Costs ${costs} for week of ${weekLabel}`}
                              >
                                <rect width="100" height="12" fill="#f3f4f6" rx="6" />
                                <rect
                                  width={(costs / maxVal) * 100}
                                  height="12"
                                  fill="#fb923c"
                                  rx="6"
                                />
                              </svg>
                            </div>
                            <span className="text-xs text-gray-500 w-20 text-right">${costs.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium text-gray-900 mt-0.5 truncate">{value}</div>
    </div>
  );
}
