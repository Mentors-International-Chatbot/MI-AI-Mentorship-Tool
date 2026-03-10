'use client';

import { useDashboardLang } from '../../DashboardLangContext';

type SerializedFlag = {
  id: string;
  socioId: string;
  level: 'RED' | 'YELLOW';
  reason: string;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
};

const FLAG_DOT: Record<string, string> = {
  RED: 'bg-red-500',
  YELLOW: 'bg-yellow-400',
};

export function FlagsPanel({ flags }: { flags: SerializedFlag[] }) {
  const { lang, t } = useDashboardLang();

  function formatDate(iso: string): string {
    const d = new Date(iso);
    const locale = lang === 'pt' ? 'pt-BR' : lang === 'en' ? 'en-US' : 'es-CO';
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold text-gray-900 mb-3">{t.alertsTitle}</h3>
      {flags.length === 0 && (
        <p className="text-sm text-gray-400">{t.noAlerts}</p>
      )}
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {flags.map((flag) => (
          <div
            key={flag.id}
            className={`flex items-start gap-2 text-sm ${flag.resolved ? 'opacity-50' : ''}`}
          >
            <span className={`inline-block w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${FLAG_DOT[flag.level]}`} />
            <div className="flex-1 min-w-0">
              <p className="text-gray-700">{flag.reason}</p>
              <p className="text-xs text-gray-400">
                {formatDate(flag.createdAt)}
                {flag.resolved && ` — ${t.resolved}`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
