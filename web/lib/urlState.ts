/**
 * The tab and season live in the address bar (?tab=history&season=2023), so
 * refresh, back/forward and shared links land on the same view. The defaults
 * (Overview, the current season) are left out to keep links short.
 */

export const TAB_IDS = ['overview', 'live', 'postseason', 'stats', 'rosters', 'draft', 'history'] as const;

/** Tabs that were merged into others, so old links still land in the right place */
const MOVED_TABS: Record<string, (typeof TAB_IDS)[number]> = {
  weekly: 'stats',
  trends: 'stats',
  advanced: 'stats',
  trades: 'rosters',
};

export function readUrlState(search: string): { tab: string | null; season: string | null } {
  const params = new URLSearchParams(search);
  const raw = params.get('tab');
  const tab = raw && (MOVED_TABS[raw] ?? raw);
  const season = params.get('season');
  return {
    tab: tab && (TAB_IDS as readonly string[]).includes(tab) ? tab : null,
    season: season && /^\d{4}$/.test(season) ? season : null,
  };
}

/** The query string for a view ('' for the default one) */
export function urlSearchFor(tab: string, season: string, currentSeason: string): string {
  const params = new URLSearchParams();
  if (tab !== 'overview') params.set('tab', tab);
  if (season && season !== currentSeason) params.set('season', season);
  const s = params.toString();
  return s ? `?${s}` : '';
}
