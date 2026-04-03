'use client';

import { useRouter } from 'next/navigation';
import { useDashboardLang } from './DashboardLangContext';

const OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
] as const;

export function LanguageSwitcher() {
  const { lang } = useDashboardLang();
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    document.cookie = `dashboard_lang=${value};path=/dashboard;max-age=${60 * 60 * 24 * 365}`;
    void fetch('/api/dashboard/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredLanguage: value }),
    }).catch(() => {});
    router.refresh();
  }

  return (
    <select
      id="dashboard-language"
      value={lang}
      onChange={handleChange}
      aria-label="Dashboard language"
      className="bg-[#1B2A4A] border border-gray-500 text-sm text-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#2DD4BF] cursor-pointer"
    >
      {OPTIONS.map(opt => (
        <option key={opt.code} value={opt.code}>{opt.label}</option>
      ))}
    </select>
  );
}
