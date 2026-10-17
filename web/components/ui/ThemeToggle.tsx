'use client';

import { useTheme } from '@/hooks/useTheme';
import type { ThemePreference } from '@/lib/theme';

const THEME_LABELS: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const THEME_ORDER: ThemePreference[] = ['light', 'dark', 'system'];

const SunIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2" />
    <path d="M12 19v2" />
    <path d="M4.9 4.9l1.4 1.4" />
    <path d="M17.7 17.7l1.4 1.4" />
    <path d="M3 12h2" />
    <path d="M19 12h2" />
    <path d="M4.9 19.1l1.4-1.4" />
    <path d="M17.7 6.3l1.4-1.4" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5Z" />
  </svg>
);

const SystemIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="M4.9 4.9l1.4 1.4" />
    <path d="M17.7 17.7l1.4 1.4" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="M6.3 17.7l-1.4 1.4" />
    <path d="M19.1 4.9l-1.4 1.4" />
  </svg>
);

const getThemeIcon = (preference: ThemePreference) => {
  switch (preference) {
    case 'light':
      return <SunIcon />;
    case 'dark':
      return <MoonIcon />;
    default:
      return <SystemIcon />;
  }
};

export default function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  const handleToggle = () => {
    const currentIndex = THEME_ORDER.indexOf(preference);
    const nextPreference = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length];
    setPreference(nextPreference);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm transition hover:bg-[var(--hover)]"
      aria-label={`Theme: ${THEME_LABELS[preference]}`}
      title={`Theme: ${THEME_LABELS[preference]}`}
    >
      {getThemeIcon(preference)}
    </button>
  );
}
