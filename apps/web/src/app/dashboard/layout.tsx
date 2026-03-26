import Link from 'next/link';
import { cookies } from 'next/headers';
import { isSupportedLanguage, type SupportedLanguage } from '@/lib/i18n/languages';
import { getDashboardStrings } from '@/lib/i18n/dashboard';
import { DashboardLangProvider } from './DashboardLangContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LogoutButton } from './LogoutButton';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const rawLang = cookieStore.get('dashboard_lang')?.value ?? 'en';
  const lang: SupportedLanguage = isSupportedLanguage(rawLang) ? rawLang : 'en';
  const t = getDashboardStrings(lang);

  return (
    <DashboardLangProvider lang={lang}>
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-[#1B2A4A] text-white px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <h1 className="text-xl font-bold">{t.panelTitle}</h1>
            <div className="flex items-center gap-4">
              <Link
                href="/chat"
                className="text-sm text-gray-300 hover:text-white transition-colors"
              >
                Web chat
              </Link>
              <Link
                href="/admin"
                className="text-sm text-gray-300 hover:text-white transition-colors"
              >
                Admin
              </Link>
              <LanguageSwitcher />
              <span className="text-sm text-gray-300">Mentors International</span>
              <LogoutButton />
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-8">
          {children}
        </main>
      </div>
    </DashboardLangProvider>
  );
}
