import Link from 'next/link';
import { getDashboardStrings } from '@/lib/i18n/dashboard';
import { resolveDashboardLanguage } from '@/lib/i18n/resolveDashboardLanguage';
import { DashboardLangProvider } from './DashboardLangContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LogoutButton } from './LogoutButton';
import { verifySession } from '@/lib/auth/session';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const lang = await resolveDashboardLanguage();
  const t = getDashboardStrings(lang);

  // Mentors no longer reach /admin, so offering them the link would only render
  // a door that redirects. Mirrors the role list in src/proxy.ts.
  const session = await verifySession();
  const canOpenAdmin = session?.role === 'admin' || session?.role === 'course_lead';

  return (
    <DashboardLangProvider lang={lang}>
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-[#1B2A4A] text-white px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <h1 className="text-xl font-bold">{t.panelTitle}</h1>
            <div className="flex items-center gap-4">
              {/* D.3: /dashboard now defaults mentors here (dashboard/page.tsx).
                  Still shown to course_lead/admin, who land on /dashboard/
                  learners instead — /dashboard/alerts is not yet scoped for
                  a course_lead session (it resolves org via a MentorProfile
                  lookup). */}
              <Link
                href="/dashboard/alerts"
                className="text-sm text-gray-300 hover:text-white transition-colors"
              >
                {t.signalsTitle}
              </Link>
              <Link
                href="/dashboard/learners"
                className="text-sm text-gray-300 hover:text-white transition-colors"
              >
                {t.sociosTitle}
              </Link>
              {/* D.3: a mentor's own web-chat access is removed from their nav —
                  chat is the learner surface, not a mentor tool. Course leads
                  and admins keep it (e.g. for testing a course as a learner
                  would experience it). */}
              {session?.role !== 'mentor' && (
                <Link
                  href="/chat"
                  className="text-sm text-gray-300 hover:text-white transition-colors"
                >
                  {t.navWebChat}
                </Link>
              )}
              {canOpenAdmin && (
                <Link
                  href="/admin"
                  className="text-sm text-gray-300 hover:text-white transition-colors"
                >
                  {t.navAdmin}
                </Link>
              )}
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
