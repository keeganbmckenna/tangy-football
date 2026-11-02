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

/** A manager page in the History tab (?tab=history&manager=<Sleeper user ID>) */
export function readManager(search: string): string | null {
  const id = new URLSearchParams(search).get('manager');
  return id && /^\d{1,24}$/.test(id) ? id : null;
}

/** The query string for a view ('' for the default one); a manager page only on the History tab */
export function urlSearchFor(tab: string, season: string, currentSeason: string, manager: string | null = null): string {
  const params = new URLSearchParams();
  if (tab !== 'overview') params.set('tab', tab);
  if (season && season !== currentSeason) params.set('season', season);
  if (tab === 'history' && manager) params.set('manager', manager);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * A shared link's way in (?season=&week=&matchup=): the week to show in Overview's Weekly Matchups and the
 * matchup to open (?week=8&matchup=2). Read once on first load; the address bar then drops them.
 */
export function readLinkTarget(search: string): { week: number; matchup: number | null } | null {
  const params = new URLSearchParams(search);
  const week = Number(params.get('week'));
  if (!Number.isInteger(week) || week < 1 || week > 18) return null;
  const matchup = Number(params.get('matchup'));
  return { week, matchup: Number.isInteger(matchup) && matchup > 0 ? matchup : null };
}
