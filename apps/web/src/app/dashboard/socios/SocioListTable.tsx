'use client';

import Link from 'next/link';
import type { SocioHealth } from '@/lib/health';
import { useDashboardLang } from '../DashboardLangContext';

type SocioRow = {
  id: string;
  name: string | null;
  channelType: string;
  health: SocioHealth;
  currentLesson: number;
  lastInteractionAt: string | null;
};

const STATUS_DOT: Record<string, string> = {
  RED: 'bg-red-500',
  YELLOW: 'bg-yellow-400',
  GREEN: 'bg-green-500',
};

export function SocioListTable({ rows }: { rows: SocioRow[] }) {
  const { lang, t } = useDashboardLang();

  function formatDate(iso: string | null): string {
    if (!iso) return t.never;
    const d = new Date(iso);
    const locale = lang === 'pt' ? 'pt-BR' : lang === 'en' ? 'en-US' : 'es-CO';
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        {t.noActiveSocios}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.thStatus}</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.thName}</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.thChannel}</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.thLesson}</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.thLastInteraction}</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-3 h-3 rounded-full ${STATUS_DOT[row.health.status]}`} />
                  <span className="text-xs text-gray-500">{row.health.reasons[0]}</span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <Link href={`/dashboard/socios/${row.id}`} className="text-[#1B2A4A] font-medium hover:underline">
                  {row.name || t.noName}
                </Link>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                {row.channelType}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {row.currentLesson}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {formatDate(row.lastInteractionAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
