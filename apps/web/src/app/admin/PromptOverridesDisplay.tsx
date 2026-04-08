/** Human-readable view of `socio.promptOverrides` JSON (0–1 slider values from dashboard). */

function normalizeTen(v: unknown): number {
  const n = Number(v);
  if (Number.isNaN(n)) return NaN;
  return n <= 1 ? Math.round(n * 10) : Math.round(n);
}

function formatTenBucket(
  v: unknown,
  low: string,
  mid: string,
  high: string,
): string {
  const ten = normalizeTen(v);
  if (Number.isNaN(ten)) return String(v);
  if (ten <= 3) return `${low} (${ten}/10)`;
  if (ten <= 7) return `${mid} (${ten}/10)`;
  return `${high} (${ten}/10)`;
}

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

const LABELS: Record<
  string,
  { label: string; formatter?: (v: unknown) => string }
> = {
  complexity: {
    label: 'Language complexity',
    formatter: (v) => formatTenBucket(v, 'Simple', 'Moderate', 'Advanced'),
  },
  warmth: {
    label: 'Warmth',
    formatter: (v) => formatTenBucket(v, 'Direct', 'Balanced', 'Very warm'),
  },
  positivity: {
    label: 'Positivity',
    formatter: (v) => formatTenBucket(v, 'Realistic', 'Balanced', 'Very positive'),
  },
  toneOverride: {
    label: 'Tone override',
    formatter: (v) => TONE_LABELS[String(v)] ?? String(v),
  },
  conciseness: {
    label: 'Message length',
    formatter: (v) => CONCISE_LABELS[String(v)] ?? String(v),
  },
};

function asOverrideRecord(
  overrides: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (overrides == null) return null;
  if (typeof overrides !== 'object' || Array.isArray(overrides)) return null;
  return overrides as Record<string, unknown>;
}

export function PromptOverridesDisplay({
  overrides,
  compact = false,
}: {
  overrides: Record<string, unknown> | null;
  /** Tighter spacing for table cells */
  compact?: boolean;
}) {
  const obj = asOverrideRecord(overrides);
  const HIDDEN = new Set(['awaitingFeedback', 'feedbackLessonNum']);
  const entries = obj
    ? Object.entries(obj).filter(([k]) => !HIDDEN.has(k))
    : [];
  if (entries.length === 0) {
    return (
      <span className="text-gray-400 text-sm italic">No overrides set</span>
    );
  }

  const gap = compact ? 'space-y-0.5' : 'space-y-1';

  return (
    <div className={gap}>
      {entries.map(([key, value]) => {
        const config = LABELS[key];
        const label = config?.label ?? key;
        const displayValue = config?.formatter
          ? config.formatter(value)
          : typeof value === 'object' && value !== null
            ? JSON.stringify(value)
            : String(value);

        return (
          <div
            key={key}
            className="flex items-start gap-2 text-sm"
          >
            <span className="text-gray-500 font-medium shrink-0">{label}:</span>
            <span className="text-gray-800 min-w-0 break-words">{displayValue}</span>
          </div>
        );
      })}
    </div>
  );
}
