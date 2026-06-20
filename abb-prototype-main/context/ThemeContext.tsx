'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'nexops_theme';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: 'light', toggle: () => {} });

// Apply the resolved theme to <html>. `explicit` marks a deliberate user choice
// (stored override or toggle) so the `.light` class can suppress the OS-dark
// media fallback in globals.css — `@media (prefers-color-scheme: dark)
// :root:not(.light)`. When merely following the OS (no override) we leave
// `.light` off so that media rule can still take effect.
function applyThemeClass(theme: Theme, explicit: boolean) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', explicit && theme === 'light');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialise from the class the inline script in layout.tsx already set on
  // <html> before hydration — so the toggle icon is correct on the first client
  // paint (no flash). On the server `document` is undefined and we fall back to
  // 'light', matching the SSR output. The useEffect below then reconciles state
  // with localStorage / OS preference.
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initial: Theme = stored ?? (mq.matches ? 'dark' : 'light');
    setTheme(initial);
    applyThemeClass(initial, stored !== null);

    // Follow OS preference changes only when the user has no explicit override.
    const onSysChange = (e: MediaQueryListEvent) => {
      if (localStorage.getItem(STORAGE_KEY)) return; // user override takes precedence
      const next: Theme = e.matches ? 'dark' : 'light';
      setTheme(next);
      applyThemeClass(next, false); // following OS — no explicit marker
    };
    mq.addEventListener('change', onSysChange);
    return () => mq.removeEventListener('change', onSysChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem(STORAGE_KEY, next);
      applyThemeClass(next, true); // explicit user choice
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
