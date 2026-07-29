'use client';

import { useState, useTransition } from 'react';
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
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;

    // Cookie first: it is the fallback tier, so the choice still applies to
    // this browser even if the preference write below fails.
    document.cookie = `dashboard_lang=${value};path=/dashboard;max-age=${60 * 60 * 24 * 365}`;

    // Await the write — the stored preference now outranks the cookie, so
    // refreshing first would re-render from the previous value.
    setSaving(true);
    try {
      await fetch('/api/dashboard/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredLanguage: value }),
      });
    } catch {
      // Cookie fallback already applied.
    } finally {
      setSaving(false);
    }

    startTransition(() => router.refresh());
  }

  return (
    <select
      id="dashboard-language"
      value={lang}
      onChange={handleChange}
      disabled={saving || pending}
      aria-label="Dashboard language"
      className="bg-[#1B2A4A] border border-gray-500 text-sm text-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#2DD4BF] cursor-pointer disabled:opacity-60"
    >
      {OPTIONS.map(opt => (
        <option key={opt.code} value={opt.code}>{opt.label}</option>
      ))}
    </select>
  );
}
