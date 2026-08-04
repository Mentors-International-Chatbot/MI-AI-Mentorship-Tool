'use client';

import { useState, useRef, useCallback } from 'react';
import { useDashboardLang } from '../../DashboardLangContext';

interface SliderPanelProps {
  socioId: string;
  initialComplexity: number;
  initialWarmth: number;
  initialPositivity: number;
}

export function SliderPanel({ socioId, initialComplexity, initialWarmth, initialPositivity }: SliderPanelProps) {
  const { t } = useDashboardLang();
  const [complexity, setComplexity] = useState(initialComplexity);
  const [warmth, setWarmth] = useState(initialWarmth);
  const [positivity, setPositivity] = useState(initialPositivity);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback((values: { complexity: number; warmth: number; positivity: number }) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setSaved(false);
      await fetch(`/api/mentor/socios/${socioId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 600);
  }, [socioId]);

  function handleChange(field: 'complexity' | 'warmth' | 'positivity', value: number) {
    const values = { complexity, warmth, positivity, [field]: value };
    if (field === 'complexity') setComplexity(value);
    if (field === 'warmth') setWarmth(value);
    if (field === 'positivity') setPositivity(value);
    save(values);
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">{t.aiSettings}</h3>
        {saved && <span className="text-xs text-green-600 font-medium">{t.saved}</span>}
      </div>

      <div className="space-y-4">
        <SliderRow
          label={t.complexity}
          lowLabel={t.simple}
          highLabel={t.advanced}
          value={complexity}
          onChange={(v) => handleChange('complexity', v)}
        />
        <SliderRow
          label={t.warmth}
          lowLabel={t.direct}
          highLabel={t.warm}
          value={warmth}
          onChange={(v) => handleChange('warmth', v)}
        />
        <SliderRow
          label={t.positivity}
          lowLabel={t.realistic}
          highLabel={t.positive}
          value={positivity}
          onChange={(v) => handleChange('positivity', v)}
        />
      </div>
    </div>
  );
}

function SliderRow({
  label, lowLabel, highLabel, value, onChange,
}: {
  label: string;
  lowLabel: string;
  highLabel: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-400">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[#1B2A4A]"
      />
      <div className="flex justify-between text-xs text-gray-400">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}
