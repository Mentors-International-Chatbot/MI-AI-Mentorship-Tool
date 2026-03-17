'use client';

import { useEffect, useState } from 'react';

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
};

export default function AdminOverviewPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/analytics')
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">Loading analytics...</p>;
  if (!data) return <p className="text-red-500">Failed to load analytics.</p>;

  const redFlags = data.flagCounts.find((f) => f.level === 'RED')?.count ?? 0;
  const yellowFlags = data.flagCounts.find((f) => f.level === 'YELLOW')?.count ?? 0;
  const weekDelta = data.activeThisWeek - data.activeLastWeek;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Admin Overview</h2>

      {/* Top-level metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Total Socios" value={data.totalSocios} />
        <MetricCard label="Active Socios" value={data.activeSocioCount} />
        <MetricCard
          label="Active This Week"
          value={data.activeThisWeek}
          delta={weekDelta !== 0 ? (weekDelta > 0 ? `+${weekDelta}` : `${weekDelta}`) : undefined}
          deltaColor={weekDelta >= 0 ? 'text-green-600' : 'text-red-600'}
        />
        <MetricCard label="Messages This Week" value={data.messagesThisWeek} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Total Messages" value={data.totalMessages} />
        <MetricCard label="Avg Msgs/Socio/Week" value={data.avgMessagesPerSocio} />
        <MetricCard
          label="Red Flags"
          value={redFlags}
          valueColor={redFlags > 0 ? 'text-red-600' : undefined}
        />
        <MetricCard
          label="Yellow Flags"
          value={yellowFlags}
          valueColor={yellowFlags > 0 ? 'text-yellow-600' : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Socios by Status */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-4">Socios by Status</h3>
          <div className="space-y-2">
            {data.sociosByStatus.map((s) => (
              <div key={s.status} className="flex items-center gap-3">
                <span className="text-sm font-mono w-36 text-gray-600">{s.status}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-4">
                  <div
                    className="bg-blue-500 h-4 rounded-full"
                    style={{
                      width: `${data.totalSocios > 0 ? (s.count / data.totalSocios) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="text-sm font-bold text-gray-900 w-8 text-right">{s.count}</span>
              </div>
            ))}
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
                return (
                  <div key={l.lessonNumber} className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-600 w-20">
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
              {data.avgUnderstandingByLesson.map((l) => (
                <div key={l.lessonNumber} className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-600 w-20">
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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  delta,
  deltaColor,
  valueColor,
}: {
  label: string;
  value: number | string;
  delta?: string;
  deltaColor?: string;
  valueColor?: string;
}) {
  return (
    <div className="bg-white rounded-lg border p-4">
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
