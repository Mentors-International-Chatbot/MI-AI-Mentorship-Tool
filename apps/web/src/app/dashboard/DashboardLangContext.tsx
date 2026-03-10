'use client';

import { createContext, useContext } from 'react';
import type { DashboardStrings } from '@/lib/i18n/dashboard';
import type { SupportedLanguage } from '@/lib/i18n/languages';
import { getDashboardStrings } from '@/lib/i18n/dashboard';

interface DashboardLangContextValue {
  lang: SupportedLanguage;
  t: DashboardStrings;
}

const DashboardLangCtx = createContext<DashboardLangContextValue>({
  lang: 'es',
  t: getDashboardStrings('es'),
});

export function DashboardLangProvider({
  lang,
  children,
}: {
  lang: SupportedLanguage;
  children: React.ReactNode;
}) {
  const t = getDashboardStrings(lang);
  return (
    <DashboardLangCtx.Provider value={{ lang, t }}>
      {children}
    </DashboardLangCtx.Provider>
  );
}

export function useDashboardLang() {
  return useContext(DashboardLangCtx);
}
