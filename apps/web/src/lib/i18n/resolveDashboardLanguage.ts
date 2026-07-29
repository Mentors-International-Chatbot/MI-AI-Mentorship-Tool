import { cookies } from 'next/headers';
import { verifySession } from '@/lib/auth/session';
import { repo } from '@/lib/repo';
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  type SupportedLanguage,
} from './languages';

export const DASHBOARD_LANG_COOKIE = 'dashboard_lang';

/**
 * Language for mentor/admin-facing chrome.
 *
 * This is the *viewer's* language, not the socio's — a mentor who reads English
 * sees an English dashboard while reviewing a Spanish-speaking socio, and the
 * socio's own conversation stays in the socio's language.
 *
 * Precedence:
 *   1. The signed-in mentor/admin's stored `preferredLanguage` — follows them
 *      across devices and browsers.
 *   2. The `dashboard_lang` cookie — covers the moment before the preference
 *      write lands, and sessions with no mentor row.
 *   3. The platform default.
 */
export async function resolveDashboardLanguage(): Promise<SupportedLanguage> {
  const session = await verifySession();

  if (session && (session.role === 'mentor' || session.role === 'admin')) {
    try {
      const stored = await repo.getMentorPreferredLanguage(session.userId);
      if (stored) return stored;
    } catch {
      // Fall through to the cookie rather than failing the page render.
    }
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(DASHBOARD_LANG_COOKIE)?.value;
  if (raw && isSupportedLanguage(raw)) return raw;

  return DEFAULT_LANGUAGE;
}
