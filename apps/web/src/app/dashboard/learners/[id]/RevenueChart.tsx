'use client';

import { useDashboardLang } from '../../DashboardLangContext';

export type RevenueChartPoint = {
  id: string;
  revenue: number;
  netProfit: number;
  weekStartDate: string;
};

function localeForLang(lang: string): string {
  if (lang === 'pt') return 'pt-BR';
  if (lang === 'en') return 'en-US';
  return 'es-CO';
}

export function RevenueChart({ data }: { data: RevenueChartPoint[] }) {
  const { lang, t } = useDashboardLang();
  const locale = localeForLang(lang);

  if (data.length < 2) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-gray-900 mb-3">{t.revenueTrendTitle}</h3>
        <p className="text-sm text-gray-400">{t.revenueTrendEmpty}</p>
      </div>
    );
  }

  const width = 400;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxRevenue = Math.max(...data.map((d) => d.revenue));
  const minRevenue = Math.min(...data.map((d) => d.revenue));
  const range = maxRevenue - minRevenue || 1;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((d.revenue - minRevenue) / range) * chartHeight;
    return { x, y, d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const fmtCompact = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  function formatCurrency(n: number): string {
    if (Math.abs(n) >= 1_000_000) return fmtCompact.format(n);
    if (Math.abs(n) >= 1_000) return fmtCompact.format(n);
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
  }

  function formatWeek(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
    });
  }

  const labelId = 'revenue-chart-title';

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 id={labelId} className="font-semibold text-gray-900 mb-3">
        {t.revenueTrendTitle}
      </h3>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-h-[220px]"
        role="img"
        aria-labelledby={labelId}
      >
        <text
          x={padding.left - 8}
          y={padding.top + 5}
          textAnchor="end"
          fill="#9ca3af"
          fontSize={11}
        >
          {formatCurrency(maxRevenue)}
        </text>
        <text
          x={padding.left - 8}
          y={padding.top + chartHeight}
          textAnchor="end"
          fill="#9ca3af"
          fontSize={11}
        >
          {formatCurrency(minRevenue)}
        </text>

        <line
          x1={padding.left}
          y1={padding.top + chartHeight / 2}
          x2={padding.left + chartWidth}
          y2={padding.top + chartHeight / 2}
          stroke="#e5e7eb"
          strokeDasharray="4"
        />

        <path
          d={linePath}
          fill="none"
          stroke="#059669"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="#059669" />
        ))}

        <text x={padding.left} y={height - 8} textAnchor="start" fill="#9ca3af" fontSize={11}>
          {formatWeek(data[0].weekStartDate)}
        </text>
        <text
          x={padding.left + chartWidth}
          y={height - 8}
          textAnchor="end"
          fill="#9ca3af"
          fontSize={11}
        >
          {formatWeek(data[data.length - 1].weekStartDate)}
        </text>
      </svg>
    </div>
  );
}
