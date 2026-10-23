import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'vi' | 'en';
export type Theme = 'dark' | 'light';

interface Prefs {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const PrefsContext = createContext<Prefs>({ lang: 'vi', setLang: () => {}, theme: 'dark', setTheme: () => {} });

function stored<T extends string>(key: string, allowed: T[]): T | null {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as string[]).includes(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

function persist(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode: preference just isn't remembered */
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const q = new URLSearchParams(window.location.search).get('lang');
    return q === 'en' || q === 'vi' ? q : (stored<Lang>('wg-lang', ['vi', 'en']) ?? 'vi');
  });
  const [theme, setThemeState] = useState<Theme>(() => {
    const q = new URLSearchParams(window.location.search).get('theme');
    if (q === 'light' || q === 'dark') return q;
    return stored<Theme>('wg-theme', ['dark', 'light']) ?? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === 'vi' ? 'WaveGuard AI — Phòng thí nghiệm giao thông' : 'WaveGuard AI — Traffic systems lab';
  }, [lang]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    persist('wg-lang', l);
  }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    persist('wg-theme', t);
  }, []);

  const value = useMemo(() => ({ lang, setLang, theme, setTheme }), [lang, setLang, theme, setTheme]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export const usePrefs = () => useContext(PrefsContext);

/** Inline bilingual strings: t('Tiếng Việt', 'English'). */
export function useT() {
  const { lang } = usePrefs();
  return useCallback((vi: string, en: string) => (lang === 'en' ? en : vi), [lang]);
}

export const tr = (lang: Lang, vi: string, en: string) => (lang === 'en' ? en : vi);
