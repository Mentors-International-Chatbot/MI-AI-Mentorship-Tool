'use client';

import { useDashboardLang } from '../../DashboardLangContext';

export type DimensionTrendPoint = {
  id: string;
  value: number;
  observedAt: string;
};

export type DimensionTrendPanelProps = {
  /** Resolved heading — the panel's configured title, or the dimension label. */
  title: string;
  points: DimensionTrendPoint[];
  /** The dimension's declared scale, so the axis matches how it is scored. */
  scale: { min: number; max: number };
};

function localeForLang(lang: string): string {
  if (lang === 'pt') return 'pt-BR';
  if (lang === 'en') return 'en-US';
  return 'es-CO';
}

/**
 * Generic trend chart for any tracked dimension.
 *
 * Course-agnostic by construction: the dimension, its label, and its scale all
 * arrive as props from the course's panel config, so this renders comprehension
 * for one course and loan repayment for another without changes.
 */
export function DimensionTrendPanel({ title, points, scale }: DimensionTrendPanelProps) {
  const { lang, t } = useDashboardLang();
  const locale = localeForLang(lang);

  if (points.length < 2) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-gray-900 mb-3">{title}</h3>
        <p className="text-sm text-gray-400">{t.dimensionTrendEmpty}</p>
      </div>
    );
  }

  const width = 400;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Plot against the declared scale, not the observed range — a flat run of
  // 7/10 should read as "steady at 7", not fill the chart edge to edge.
  const range = scale.max - scale.min || 1;

  const plotted = points.map((p, i) => {
    const x = padding.left + (i / (points.length - 1)) * chartWidth;
    const clamped = Math.min(Math.max(p.value, scale.min), scale.max);
    const y = padding.top + chartHeight - ((clamped - scale.min) / range) * chartHeight;
    return { x, y, p };
  });

  const linePath = plotted.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  }

  const labelId = 'dimension-trend-title';
  const latest = points[points.length - 1];

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 id={labelId} className="font-semibold text-gray-900">
          {title}
        </h3>
        <span className="text-sm font-medium text-gray-900">
          {latest.value}
          <span className="text-gray-400">/{scale.max}</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-h-[220px]"
        role="img"
        aria-labelledby={labelId}
      >
        <text x={padding.left - 8} y={padding.top + 5} textAnchor="end" fill="#9ca3af" fontSize={11}>
          {scale.max}
        </text>
        <text
          x={padding.left - 8}
          y={padding.top + chartHeight}
          textAnchor="end"
          fill="#9ca3af"
          fontSize={11}
        >
          {scale.min}
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
          stroke="#1B2A4A"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {plotted.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r={3} fill="#1B2A4A" />
        ))}

        <text x={padding.left} y={height - 8} textAnchor="start" fill="#9ca3af" fontSize={11}>
          {formatDate(points[0].observedAt)}
        </text>
        <text
          x={padding.left + chartWidth}
          y={height - 8}
          textAnchor="end"
          fill="#9ca3af"
          fontSize={11}
        >
          {formatDate(latest.observedAt)}
        </text>
      </svg>
    </div>
  );
}
