'use client';

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_THEME,
  DEFAULT_RESOLVED_THEME,
  THEME_STORAGE_KEY,
  type ThemePreference,
  resolveThemePreference,
  resolveThemeValue,
  type ResolvedTheme,
  THEME_COLORS,
} from '@/lib/theme';

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const getInitialResolvedTheme = (): ResolvedTheme => {
  if (typeof document === 'undefined') {
    return DEFAULT_RESOLVED_THEME;
  }

  const datasetTheme = document.documentElement.dataset.theme;
  if (datasetTheme === 'light' || datasetTheme === 'dark') {
    return datasetTheme;
  }

  return DEFAULT_RESOLVED_THEME;
};

const applyThemeToDocument = (theme: ResolvedTheme) => {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  // Follow the site's theme, not just the device's, in the browser chrome
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.removeAttribute('media');
    m.setAttribute('content', THEME_COLORS[theme]);
  });
};

const getStoredPreference = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME;
  }

  return resolveThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
};

const useThemeState = (): ThemeContextValue => {
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(getInitialResolvedTheme);

  useEffect(() => {
    const storedPreference = getStoredPreference();
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = resolveThemeValue(storedPreference, prefersDark);

    setPreferenceState(storedPreference);
    setResolvedTheme(resolved);
    applyThemeToDocument(resolved);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateFromSystem = () => {
      const resolved = resolveThemeValue(preference, mediaQuery.matches);
      setResolvedTheme(resolved);
      applyThemeToDocument(resolved);
    };

    if (preference === 'system') {
      mediaQuery.addEventListener('change', updateFromSystem);
    }

    updateFromSystem();

    return () => {
      mediaQuery.removeEventListener('change', updateFromSystem);
    };
  }, [preference]);

  const setPreference = (nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
    }

    const prefersDark = typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
    const resolved = resolveThemeValue(nextPreference, prefersDark);
    setResolvedTheme(resolved);
    applyThemeToDocument(resolved);
  };

  return useMemo(() => ({ preference, resolvedTheme, setPreference }), [preference, resolvedTheme]);
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const theme = useThemeState();

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }

  return context;
};
