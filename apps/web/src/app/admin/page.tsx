'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
  LineChart, Line, ReferenceLine, Dot,
} from 'recharts';

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
  /**
   * Optional so an older deployment of the analytics route — or a cached
   * response from before this field existed — renders the rest of the page
   * instead of throwing on a missing key.
   */
  tenancy?: {
    unanchoredSocios: number;
    unanchoredMentors: number;
    whatsappUnanchored: number;
  };
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
  businessDescription: string | null;
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
  const base = '/admin/learners';
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
          label="Total Learners"
          value={data.totalSocios}
          drillKey="totalSocios"
          expanded={expanded}
          onClick={toggle}
        />
        <MetricCard
          label="Active Learners"
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
        <DrillDownPanel key={expanded} drillKey={expanded} showMessages={expanded === 'messagesThisWeek'} />
      )}

      {/* Tenancy anchoring.
          Rendered only when something is unanchored: at zero this is noise, and
          a permanent "0 unanchored" tile trains people to stop reading it. An
          unanchored socio or mentor is otherwise completely silent — the socio
          just does not appear on a dashboard and the mentor just sees an empty
          roster, with no error anywhere. */}
      {data.tenancy && (data.tenancy.unanchoredSocios > 0 || data.tenancy.unanchoredMentors > 0) && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="font-semibold text-amber-900 mb-1">Unanchored records</h3>
          <p className="text-sm text-amber-800 mb-3">
            These have no organization anchor, so they are invisible to org-scoped
            queries — learners do not appear on any mentor dashboard, and mentors
            see an empty roster. Anchoring happens when a real organization signal
            first exists (course selection for learners, first learner assignment
            for mentors); it is never guessed.
          </p>
          <div className="flex flex-wrap gap-6 text-sm">
            <span className="text-amber-900">
              Learners: <strong>{data.tenancy.unanchoredSocios}</strong>
              {data.tenancy.whatsappUnanchored > 0 && (
                <span className="text-amber-700">
                  {' '}({data.tenancy.whatsappUnanchored} via WhatsApp, which has no course signal yet)
                </span>
              )}
            </span>
            <span className="text-amber-900">
              Mentors: <strong>{data.tenancy.unanchoredMentors}</strong>
            </span>
          </div>
          <p className="text-xs text-amber-700 mt-3">
            Backfill with{' '}
            <code className="bg-amber-100 px-1 rounded">
              npx tsx scripts/backfill-participant-profiles.ts --apply
            </code>{' '}
            /{' '}
            <code className="bg-amber-100 px-1 rounded">
              scripts/backfill-mentor-profiles.ts --apply
            </code>
            . Records with no organization signal are skipped by design.
          </p>
        </div>
      )}

      {/* Top-level metrics row 2 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2 mt-4">
        <MetricCard label="Total Messages" value={data.totalMessages} />
        <MetricCard label="Avg Msgs/Learner/Week" value={data.avgMessagesPerSocio} />
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
        <DrillDownPanel key={expanded} drillKey={expanded} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Learners by Status */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-4">Learners by Status</h3>
          {data.sociosByStatus.length === 0 ? (
            <p className="text-sm text-gray-500">No learners yet.</p>
          ) : (
            <>
              <div className="relative h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.sociosByStatus}
                      dataKey="count"
                      nameKey="status"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                      cursor="pointer"
                      onClick={(_: unknown, idx: number) => {
                        const s = data.sociosByStatus[idx];
                        if (s) toggle(`status:${s.status}`);
                      }}
                    >
                      {data.sociosByStatus.map((s, i) => (
                        <Cell
                          key={s.status}
                          fill={STATUS_COLORS[i % STATUS_COLORS.length]}
                          stroke={expanded === `status:${s.status}` ? '#3b82f6' : 'none'}
                          strokeWidth={expanded === `status:${s.status}` ? 2 : 0}
                        />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [value, 'Learners']} />
                    <Legend
                      formatter={(value: string) => <span className="text-xs text-gray-600">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center total */}
                <div className="absolute inset-x-0 top-0 bottom-7 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-900">{data.totalSocios}</div>
                    <div className="text-xs text-gray-500">Total</div>
                  </div>
                </div>
              </div>
              {/* Drill-down for selected status */}
              {expanded && expanded.startsWith('status:') && (
                <DrillDownPanel key={expanded} drillKey={expanded} />
              )}
            </>
          )}
        </div>

        {/* Lesson Completion Funnel */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-4">Lesson Completion Funnel</h3>
          {data.lessonFunnel.length === 0 ? (
            <p className="text-sm text-gray-500">No lesson completions yet.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={data.lessonFunnel}
                  margin={{ top: 5, right: 10, bottom: 5, left: -10 }}
                >
                  <XAxis
                    dataKey="lessonNumber"
                    tickFormatter={(v: number) => `L${v}`}
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#9ca3af' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value) => [value, 'Completed']}
                    labelFormatter={(v) => `Lesson ${v}`}
                  />
                  <Bar
                    dataKey="completedCount"
                    fill="#22c55e"
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={(entry) => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const ln = (entry as any)?.lessonNumber;
                      if (ln != null) toggle(`completedLesson:${ln}`);
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
              {expanded && expanded.startsWith('completedLesson:') && (
                <DrillDownPanel key={expanded} drillKey={expanded} />
              )}
            </>
          )}
        </div>

        {/* Avg Understanding by Lesson */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-4">Avg Understanding by Lesson</h3>
          {data.avgUnderstandingByLesson.length === 0 ? (
            <p className="text-sm text-gray-500">No understanding scores yet.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={data.avgUnderstandingByLesson}
                  margin={{ top: 5, right: 10, bottom: 5, left: -10 }}
                >
                  <XAxis
                    dataKey="lessonNumber"
                    tickFormatter={(v: number) => `L${v}`}
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 10]}
                    tick={{ fontSize: 11, fill: '#9ca3af' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value) => [value, 'Avg Score']}
                    labelFormatter={(v) => `Lesson ${v}`}
                  />
                  <ReferenceLine y={7} stroke="#d1d5db" strokeDasharray="4 4" label={{ value: '7', position: 'right', fontSize: 10, fill: '#9ca3af' }} />
                  <Line
                    type="monotone"
                    dataKey="avgUnderstanding"
                    stroke="#6366f1"
                    strokeWidth={2}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    dot={(props: any) => {
                      const { cx, cy, payload, index } = props as { cx: number; cy: number; payload: { avgUnderstanding: number; lessonNumber: number }; index: number };
                      const color = payload.avgUnderstanding >= 7 ? '#22c55e' : payload.avgUnderstanding >= 4 ? '#eab308' : '#ef4444';
                      return (
                        <Dot
                          key={index}
                          cx={cx}
                          cy={cy}
                          r={5}
                          fill={color}
                          stroke="#fff"
                          strokeWidth={2}
                          cursor="pointer"
                          onClick={() => toggle(`lessonNumber:${payload.lessonNumber}`)}
                        />
                      );
                    }}
                    activeDot={{ r: 7, cursor: 'pointer' }}
                  />
                </LineChart>
              </ResponsiveContainer>
              {expanded && expanded.startsWith('lessonNumber:') && (
                <DrillDownPanel key={expanded} drillKey={expanded} />
              )}
            </>
          )}
        </div>

        {/* Weekly Financial Trend */}
        <FinancialChart data={data.financialSummary} />
      </div>
    </div>
  );
}

/* ─── Constants ────────────────────────────────────────────── */

const STATUS_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#6b7280'];

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
        <h3 className="font-semibold text-gray-900 mb-4">Weekly Financial Trend (All Learners)</h3>
        <p className="text-sm text-gray-500">No financial data reported yet.</p>
      </div>
    );
  }

  const chartData = data.map((w) => ({
    week: new Date(w.weekStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Revenue: w.totalRevenue,
    'Net Profit': w.totalNetProfit,
    Costs: w.totalRevenue - w.totalNetProfit,
    socioCount: w.socioCount,
  }));

  return (
    <div className="bg-white rounded-lg border p-4 lg:col-span-2">
      <h3 className="font-semibold text-gray-900 mb-4">Weekly Financial Trend (All Learners)</h3>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
          <defs>
            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorCosts" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f97316" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="week"
            tick={{ fontSize: 12, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatPesos}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value, name) => [formatPesos(Number(value)), String(name)]}
          />
          <Legend
            formatter={(value: string) => <span className="text-xs text-gray-600">{value}</span>}
          />
          <Area type="monotone" dataKey="Revenue" stroke="#3b82f6" strokeWidth={2} fill="url(#colorRevenue)" />
          <Area type="monotone" dataKey="Net Profit" stroke="#22c55e" strokeWidth={2} fill="url(#colorProfit)" />
          <Area type="monotone" dataKey="Costs" stroke="#f97316" strokeWidth={2} fill="url(#colorCosts)" />
        </AreaChart>
      </ResponsiveContainer>
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
  const cardClassName = `bg-white rounded-lg border p-4 transition-all ${
    clickable
      ? 'cursor-pointer hover:ring-2 hover:ring-blue-200 active:ring-blue-300'
      : ''
  } ${isExpanded ? 'ring-2 ring-blue-400' : ''}`;

  if (clickable) {
    return (
      <button
        type="button"
        onClick={() => onClick(drillKey)}
        className={cardClassName}
      >
        <div className="text-sm text-gray-500">{label}</div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className={`text-2xl font-bold ${valueColor ?? 'text-gray-900'}`}>{value}</span>
          {delta && (
            <span className={`text-sm font-medium ${deltaColor ?? 'text-gray-500'}`}>{delta}</span>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className={cardClassName}>
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
          Loading learners…
        </div>
      ) : socios.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">No learners found.</p>
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
                  <td className="py-2 text-gray-600">{s.businessName || s.businessDescription || '—'}</td>
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
                      href={`/admin/learners/${s.id}`}
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
                View all {total} learners →
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
