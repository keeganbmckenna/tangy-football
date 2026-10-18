/**
 * Live-week feeds shared by /api/live and /api/live/scores: NFL game clocks from ESPN's
 * public scoreboard, and fantasy points computed from Sleeper's live player stats.
 */

import { gameRemaining, withLivePoints, type LiveGame } from './analyze/live';
import { SLEEPER_CONFIG } from './config';
import type { SleeperMatchup } from './types';

// A live poll can't wait on a stalled upstream: give up after a few seconds (the caller
// falls back, and the next poll tries again)
export const UPSTREAM_TIMEOUT_MS = 5000;

const fetchJson = async <T,>(url: string, revalidate: number): Promise<T> => {
  const response = await fetch(url, { next: { revalidate }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`);
  return response.json() as Promise<T>;
};

interface EspnEvent {
  date?: string;
  status: { clock?: number; period?: number; displayClock?: string; type: { state: string; shortDetail?: string } };
  competitions: Array<{ competitors: Array<{ score?: string; team: { abbreviation: string } }> }>;
}

/** Kickoff as "Sun 1:00 PM ET" */
const kickoff = (iso?: string) =>
  iso ? `${new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(',', '')} ET` : '';

// ESPN's codes that differ from Sleeper's
const ESPN_TEAM: Record<string, string> = { WSH: 'WAS' };

/** Each NFL team's game this week from ESPN's public scoreboard (null if unavailable) */
export async function scoreboard(season: string, week: number, revalidate = 5): Promise<Record<string, LiveGame> | null> {
  try {
    const { events } = await fetchJson<{ events: EspnEvent[] }>(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`,
      revalidate
    );
    const games: Record<string, LiveGame> = {};
    for (const e of events) {
      const raw = e.status.type.state;
      const state = raw === 'post' ? 'post' : raw === 'in' ? 'in' : 'pre';
      const [x, y] = e.competitions[0]?.competitors ?? [];
      if (!x || !y) continue;
      const margin = Number(x.score ?? 0) - Number(y.score ?? 0);
      const remaining = gameRemaining(state, e.status.period ?? 0, e.status.clock ?? 0, margin);
      const period = e.status.period ?? 0;
      const label = state === 'in'
        ? `${period > 4 ? 'OT' : `Q${period}`} ${e.status.displayClock ?? ''}`.trim()
        : state === 'post' ? 'Final' : kickoff(e.date);
      for (const c of [x, y]) games[ESPN_TEAM[c.team.abbreviation] ?? c.team.abbreviation] = { state, remaining, label };
    }
    return games;
  } catch (error) {
    console.error('NFL scoreboard unavailable:', error);
    return null;
  }
}

/**
 * This week's matchups with points from Sleeper's live player stats (cached 30 seconds on
 * Sleeper's side, against 60 for matchup scores), or Sleeper's own points if stats fail.
 */
export async function liveMatchups(leagueId: string, season: string, week: number, scoring: Record<string, number>): Promise<SleeperMatchup[]> {
  const { baseUrl } = SLEEPER_CONFIG;
  const [matchups, stats] = await Promise.all([
    fetchJson<SleeperMatchup[]>(`${baseUrl}/league/${leagueId}/matchups/${week}`, 20),
    fetchJson<Record<string, Record<string, number>>>(`${baseUrl}/stats/nfl/regular/${season}/${week}`, 10).catch((error) => {
      console.error('Live stats unavailable:', error);
      return null;
    }),
  ]);
  return stats ? withLivePoints(matchups, stats, scoring) : matchups;
}
