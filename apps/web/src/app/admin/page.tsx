'use client';

import { useEffect, useState, useCallback } from 'react';

type Analytics = {
  sociosByStatus: { status: string; count: number }[];
  totalSocios: number;
  lessonFunnel: { lessonNumber: number; completedCount: number }[];
  avgUnderstandingByLesson: { lessonNumber: number; avgUnderstanding: number }[];
  activeThisWeek: number;
  activeLastWeek: number;
  flagCounts: { level: string; count: number }[];
  messagesThisWeek: number;
  totalMessages: number;
  avgMessagesPerSocio: number;
  activeSocioCount: number;
  financialSummary: {
    weekStartDate: string;
    totalRevenue: number;
    totalNetProfit: number;
    socioCount: number;
  }[];
};

type DrillSocio = {
  id: string;
  name: string | null;
  businessName: string | null;
  status: string;
  progress: { currentLessonNumber: number; lastInteractionAt: string | null } | null;
  flags: { level: string }[];
  _count?: { messages: number };
};

type DrillKey = string | null;

function buildQuery(key: string): string {
  const base = '/api/admin/socios?pageSize=10';
  switch (key) {
    case 'totalSocios':
      return base;
    case 'activeSocios':
      return `${base}&status=ACTIVE`;
    case 'activeThisWeek':
      return `${base}&activeWithin=7d`;
    case 'messagesThisWeek':
      return `${base}&sortBy=messagesThisWeek`;
    case 'redFlags':
      return `${base}&flagLevel=RED`;
    case 'yellowFlags':
      return `${base}&flagLevel=YELLOW`;
    default:
      if (key.startsWith('status:'))
        return `${base}&status=${key.split(':')[1]}`;
      if (key.startsWith('completedLesson:'))
        return `${base}&completedLesson=${key.split(':')[1]}`;
      if (key.startsWith('lessonNumber:'))
        return `${base}&lessonNumber=${key.split(':')[1]}`;
      return base;
  }
}

function buildViewAllHref(key: string): string {
  const base = '/admin/socios';
  switch (key) {
    case 'totalSocios':
      return base;
    case 'activeSocios':
      return `${base}?status=ACTIVE`;
    case 'activeThisWeek':
      return `${base}?activeWithin=7d`;
    case 'messagesThisWeek':
      return `${base}?sortBy=messagesThisWeek`;
    case 'redFlags':
      return `${base}?flagLevel=RED`;
    case 'yellowFlags':
      return `${base}?flagLevel=YELLOW`;
    default:
      if (key.startsWith('status:'))
        return `${base}?status=${key.split(':')[1]}`;
      if (key.startsWith('completedLesson:'))
        return `${base}?completedLesson=${key.split(':')[1]}`;
      if (key.startsWith('lessonNumber:'))
        return `${base}?lessonNumber=${key.split(':')[1]}`;
      return base;
  }
}

function flagDot(flags: { level: string }[]) {
  const hasRed = flags.some((f) => f.level === 'RED');
  const hasYellow = flags.some((f) => f.level === 'YELLOW');
  if (hasRed) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" title="Red flag" />;
  if (hasYellow) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" title="Yellow flag" />;
  return <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-400" title="No flags" />;
}

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<DrillKey>(null);

  useEffect(() => {
    fetch('/api/admin/analytics')
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const toggle = useCallback(
    (key: string) => setExpanded((prev) => (prev === key ? null : key)),
    [],
  );

  if (loading) return <p className="text-gray-500">Loading analytics...</p>;
  if (!data) return <p className="text-red-500">Failed to load analytics.</p>;

  const redFlags = data.flagCounts.find((f) => f.level === 'RED')?.count ?? 0;
  const yellowFlags = data.flagCounts.find((f) => f.level === 'YELLOW')?.count ?? 0;
  const weekDelta = data.activeThisWeek - data.activeLastWeek;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Admin Overview</h2>

      {/* Top-level metrics row 1 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
        <MetricCard
          label="Total Socios"
          value={data.totalSocios}
          drillKey="totalSocios"
          expanded={expanded}
          onClick={toggle}
        />
        <MetricCard
          label="Active Socios"
          value={data.activeSocioCount}
          drillKey="activeSocios"
          expanded={expanded}
          onClick={toggle}
        />
        <MetricCard
          label="Active This Week"
          value={data.activeThisWeek}
          delta={weekDelta !== 0 ? (weekDelta > 0 ? `+${weekDelta}` : `${weekDelta}`) : undefined}
          deltaColor={weekDelta >= 0 ? 'text-green-600' : 'text-red-600'}
          drillKey="activeThisWeek"
          expanded={expanded}
          onClick={toggle}
        />
        <MetricCard
          label="Messages This Week"
          value={data.messagesThisWeek}
          drillKey="messagesThisWeek"
          expanded={expanded}
          onClick={toggle}
        />
      </div>

      {/* Drill-down for row 1 */}
      {expanded && ['totalSocios', 'activeSocios', 'activeThisWeek', 'messagesThisWeek'].includes(expanded) && (
        <DrillDownPanel drillKey={expanded} showMessages={expanded === 'messagesThisWeek'} />
      )}

      {/* Top-level metrics row 2 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2 mt-4">
        <MetricCard label="Total Messages" value={data.totalMessages} />
        <MetricCard label="Avg Msgs/Socio/Week" value={data.avgMessagesPerSocio} />
        <MetricCard
          label="Red Flags"
          value={redFlags}
          valueColor={redFlags > 0 ? 'text-red-600' : undefined}
          drillKey="redFlags"
          expanded={expanded}
          onClick={toggle}
        />
        <MetricCard
          label="Yellow Flags"
          value={yellowFlags}
          valueColor={yellowFlags > 0 ? 'text-yellow-600' : undefined}
          drillKey="yellowFlags"
          expanded={expanded}
          onClick={toggle}
        />
      </div>

      {/* Drill-down for row 2 */}
      {expanded && ['redFlags', 'yellowFlags'].includes(expanded) && (
        <DrillDownPanel drillKey={expanded} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Socios by Status */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-4">Socios by Status</h3>
          <div className="space-y-2">
            {data.sociosByStatus.map((s) => {
              const barKey = `status:${s.status}`;
              return (
                <div key={s.status}>
                  <button
                    onClick={() => toggle(barKey)}
                    className={`w-full flex items-center gap-3 p-1 rounded cursor-pointer transition-colors hover:bg-gray-50 ${
                      expanded === barKey ? 'bg-blue-50' : ''
                    }`}
                  >
                    <span className="text-sm font-mono w-36 text-gray-600 text-left">{s.status}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4">
                      <div
                        className="bg-blue-500 h-4 rounded-full"
                        style={{
                          width: `${data.totalSocios > 0 ? (s.count / data.totalSocios) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm font-bold text-gray-900 w-8 text-right">{s.count}</span>
                  </button>
                  {expanded === barKey && <DrillDownPanel drillKey={barKey} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Lesson Completion Funnel */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-4">Lesson Completion Funnel</h3>
          {data.lessonFunnel.length === 0 ? (
            <p className="text-sm text-gray-500">No lesson completions yet.</p>
          ) : (
            <div className="space-y-2">
              {data.lessonFunnel.map((l) => {
                const maxCount = Math.max(...data.lessonFunnel.map((x) => x.completedCount), 1);
                const barKey = `completedLesson:${l.lessonNumber}`;
                return (
                  <div key={l.lessonNumber}>
                    <button
                      onClick={() => toggle(barKey)}
                      className={`w-full flex items-center gap-3 p-1 rounded cursor-pointer transition-colors hover:bg-gray-50 ${
                        expanded === barKey ? 'bg-green-50' : ''
                      }`}
                    >
                      <span className="text-sm font-medium text-gray-600 w-20 text-left">
                        Lesson {l.lessonNumber}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-4">
                        <div
                          className="bg-green-500 h-4 rounded-full"
                          style={{ width: `${(l.completedCount / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold text-gray-900 w-8 text-right">
                        {l.completedCount}
                      </span>
                    </button>
                    {expanded === barKey && <DrillDownPanel drillKey={barKey} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Avg Understanding by Lesson */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-4">Avg Understanding by Lesson</h3>
          {data.avgUnderstandingByLesson.length === 0 ? (
            <p className="text-sm text-gray-500">No understanding scores yet.</p>
          ) : (
            <div className="space-y-2">
              {data.avgUnderstandingByLesson.map((l) => {
                const barKey = `lessonNumber:${l.lessonNumber}`;
                return (
                  <div key={l.lessonNumber}>
                    <button
                      onClick={() => toggle(barKey)}
                      className={`w-full flex items-center gap-3 p-1 rounded cursor-pointer transition-colors hover:bg-gray-50 ${
                        expanded === barKey ? 'bg-yellow-50' : ''
                      }`}
                    >
                      <span className="text-sm font-medium text-gray-600 w-20 text-left">
                        Lesson {l.lessonNumber}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-4">
                        <div
                          className={`h-4 rounded-full ${
                            l.avgUnderstanding >= 7
                              ? 'bg-green-500'
                              : l.avgUnderstanding >= 4
                              ? 'bg-yellow-400'
                              : 'bg-red-500'
                          }`}
                          style={{ width: `${l.avgUnderstanding * 10}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold text-gray-900 w-8 text-right">
                        {l.avgUnderstanding}
                      </span>
                    </button>
                    {expanded === barKey && <DrillDownPanel drillKey={barKey} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Weekly Financial Trend */}
        <FinancialChart data={data.financialSummary} />
      </div>
    </div>
  );
}

/* ─── Financial Chart (Aggregate) ──────────────────────────── */

function formatPesos(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function FinancialChart({
  data,
}: {
  data: Analytics['financialSummary'];
}) {
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg border p-4 lg:col-span-2">
        <h3 className="font-semibold text-gray-900 mb-4">Weekly Financial Trend (All Socios)</h3>
        <p className="text-sm text-gray-500">No financial data reported yet.</p>
      </div>
    );
  }

  const maxVal = Math.max(...data.map((w) => Math.max(w.totalRevenue, w.totalNetProfit, w.totalRevenue - w.totalNetProfit)), 1);

  return (
    <div className="bg-white rounded-lg border p-4 lg:col-span-2">
      <h3 className="font-semibold text-gray-900 mb-4">Weekly Financial Trend (All Socios)</h3>
      <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500 inline-block" /> Revenue</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Net Profit</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-400 inline-block" /> Costs</span>
      </div>
      <div className="space-y-3">
        {data.map((w) => {
          const costs = w.totalRevenue - w.totalNetProfit;
          const weekLabel = new Date(w.weekStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          return (
            <div key={w.weekStartDate} className="text-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-gray-600 font-medium w-20">{weekLabel}</span>
                <span className="text-xs text-gray-400">{w.socioCount} socio{w.socioCount !== 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 rounded-full h-3">
                    <div className="bg-blue-500 h-3 rounded-full" style={{ width: `${(w.totalRevenue / maxVal) * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-16 text-right">{formatPesos(w.totalRevenue)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 rounded-full h-3">
                    <div className="bg-green-500 h-3 rounded-full" style={{ width: `${(w.totalNetProfit / maxVal) * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-16 text-right">{formatPesos(w.totalNetProfit)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 rounded-full h-3">
                    <div className="bg-orange-400 h-3 rounded-full" style={{ width: `${(costs / maxVal) * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-16 text-right">{formatPesos(costs)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Metric Card ───────────────────────────────────────────── */

function MetricCard({
  label,
  value,
  delta,
  deltaColor,
  valueColor,
  drillKey,
  expanded,
  onClick,
}: {
  label: string;
  value: number | string;
  delta?: string;
  deltaColor?: string;
  valueColor?: string;
  drillKey?: string;
  expanded?: DrillKey;
  onClick?: (key: string) => void;
}) {
  const clickable = drillKey && onClick;
  const isExpanded = drillKey && expanded === drillKey;

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onClick(drillKey) : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(drillKey); } : undefined}
      className={`bg-white rounded-lg border p-4 transition-all ${
        clickable
          ? 'cursor-pointer hover:ring-2 hover:ring-blue-200 active:ring-blue-300'
          : ''
      } ${isExpanded ? 'ring-2 ring-blue-400' : ''}`}
    >
      <div className="text-sm text-gray-500">{label}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={`text-2xl font-bold ${valueColor ?? 'text-gray-900'}`}>{value}</span>
        {delta && (
          <span className={`text-sm font-medium ${deltaColor ?? 'text-gray-500'}`}>{delta}</span>
        )}
      </div>
    </div>
  );
}

/* ─── Drill-Down Panel ──────────────────────────────────────── */

function DrillDownPanel({ drillKey, showMessages }: { drillKey: string; showMessages?: boolean }) {
  const [socios, setSocios] = useState<DrillSocio[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(buildQuery(drillKey))
      .then((r) => r.json())
      .then((d) => {
        setSocios(d.socios ?? []);
        setTotal(d.total ?? 0);
      })
      .finally(() => setLoading(false));
  }, [drillKey]);

  return (
    <div className="bg-gray-50 border rounded-lg p-4 mt-2 mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-3">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
          </svg>
          Loading socios…
        </div>
      ) : socios.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">No socios found.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2 w-8"></th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Business</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Lesson</th>
                {showMessages && <th className="pb-2">Msgs (7d)</th>}
                <th className="pb-2">Last Active</th>
                <th className="pb-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {socios.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-white">
                  <td className="py-2">{flagDot(s.flags ?? [])}</td>
                  <td className="py-2 font-medium text-gray-900">{s.name ?? '—'}</td>
                  <td className="py-2 text-gray-600">{s.businessName ?? '—'}</td>
                  <td className="py-2">
                    <span className="text-xs font-mono bg-gray-100 rounded px-1.5 py-0.5">{s.status}</span>
                  </td>
                  <td className="py-2 text-gray-700">{s.progress?.currentLessonNumber ?? '—'}</td>
                  {showMessages && (
                    <td className="py-2 font-medium text-gray-700">{s._count?.messages ?? '—'}</td>
                  )}
                  <td className="py-2 text-gray-500">{relativeTime(s.progress?.lastInteractionAt)}</td>
                  <td className="py-2">
                    <a
                      href={`/admin/socios/${s.id}`}
                      className="text-blue-600 hover:underline text-xs font-medium"
                    >
                      View
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > 10 && (
            <div className="mt-3 text-center">
              <a
                href={buildViewAllHref(drillKey)}
                className="text-sm text-blue-600 hover:underline font-medium"
              >
                View all {total} socios →
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
