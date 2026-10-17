export const THEME_STORAGE_KEY = 'fantasy-football-theme';

export const THEME_VALUES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_VALUES)[number];

export const DEFAULT_THEME: ThemePreference = 'system';

export type ResolvedTheme = 'light' | 'dark';

export const DEFAULT_RESOLVED_THEME: ResolvedTheme = 'light';

export const resolveThemePreference = (value: string | null): ThemePreference => {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }

  return DEFAULT_THEME;
};

export const resolveThemeValue = (
  preference: ThemePreference,
  prefersDark: boolean
): ResolvedTheme => {
  if (preference === 'system') {
    return prefersDark ? 'dark' : 'light';
  }

  return preference;
};

/** Browser chrome color (phone status bar, installed app title bar) per theme */
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#ffffff', dark: '#000000' };

export const getThemeBootstrapScript = () => {
  return `(() => {
  const storageKey = '${THEME_STORAGE_KEY}';
  const storedValue = window.localStorage.getItem(storageKey);
  const preference = storedValue === 'light' || storedValue === 'dark' || storedValue === 'system'
    ? storedValue
    : '${DEFAULT_THEME}';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolvedTheme = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;

  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.removeAttribute('media');
    m.setAttribute('content', resolvedTheme === 'dark' ? '${THEME_COLORS.dark}' : '${THEME_COLORS.light}');
  });
})();`;
};
