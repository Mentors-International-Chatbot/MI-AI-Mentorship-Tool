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
    document.cookie = `dashboard_lang=${e.target.value};path=/dashboard;max-age=${60 * 60 * 24 * 365}`;
    router.refresh();
  }

  return (
    <select
      value={lang}
      onChange={handleChange}
      className="bg-[#1B2A4A] border border-gray-500 text-sm text-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#2DD4BF] cursor-pointer"
    >
      {OPTIONS.map(opt => (
        <option key={opt.code} value={opt.code}>{opt.label}</option>
      ))}
    </select>
  );
}
