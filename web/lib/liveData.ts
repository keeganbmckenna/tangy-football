/**
 * Live-week feeds shared by /api/live and /api/live/scores: NFL game clocks from ESPN's
 * public scoreboard, and fantasy points computed from Sleeper's live player stats.
 */

import { driveFor, gameRemaining, withLivePoints, type LiveGame } from './analyze/live';
import { pickStats, type StatLine } from './analyze/statLine';
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
  id?: string;
  date?: string;
  status: { clock?: number; period?: number; displayClock?: string; type: { state: string; shortDetail?: string } };
  competitions: Array<{
    competitors: Array<{ score?: string; homeAway?: string; team: { id: string; abbreviation: string } }>;
    /** While the game is on: down, distance, yard line (from the home team's goal line) and the team ID with the ball */
    situation?: { down?: number; distance?: number; yardLine?: number; possession?: string | null };
  }>;
}

/** Kickoff as "Sun 1:00 PM ET" */
const kickoff = (iso?: string) =>
  iso ? `${new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(',', '')} ET` : '';

// ESPN's codes that differ from Sleeper's
const ESPN_TEAM: Record<string, string> = { WSH: 'WAS' };

/** A play from ESPN's play-by-play: its wall-clock time (Unix seconds), text, and whether it scored */
export interface EspnPlay {
  t: number;
  text: string;
  scoring: boolean;
}

/** A game's plays so far from ESPN's game summary, oldest first (empty if unavailable) */
export async function gamePlays(espnId: string): Promise<EspnPlay[]> {
  try {
    const d = await fetchJson<{ drives?: { previous?: Array<{ plays?: EspnRawPlay[] }>; current?: { plays?: EspnRawPlay[] } } }>(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${espnId}`,
      20
    );
    const raw = [...(d.drives?.previous ?? []).flatMap((x) => x.plays ?? []), ...(d.drives?.current?.plays ?? [])];
    return raw
      .filter((p) => p.text && p.wallclock)
      .map((p) => ({ t: Math.round(Date.parse(p.wallclock!) / 1000), text: p.text!, scoring: !!p.scoringPlay }))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

interface EspnRawPlay {
  text?: string;
  wallclock?: string;
  scoringPlay?: boolean;
}

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
      // ESPN shows halftime as the 2nd quarter at 0:00
      const half = state === 'in' && period === 2 && (e.status.clock ?? 1) === 0;
      const label = half
        ? 'Half'
        : state === 'in'
        ? `${period > 4 ? 'OT' : `Q${period}`} ${e.status.displayClock ?? ''}`.trim()
        : state === 'post' ? 'Final' : kickoff(e.date);
      const code = (c: typeof x) => ESPN_TEAM[c.team.abbreviation] ?? c.team.abbreviation;
      const situation = state === 'in' ? e.competitions[0]?.situation : undefined;
      for (const [c, o] of [[x, y], [y, x]]) {
        const drive = driveFor(situation, { id: c.team.id, code: code(c), home: c.homeAway === 'home' }, { id: o.team.id, code: code(o) });
        games[code(c)] = {
          state,
          ...(e.id && { espnId: e.id }),
          remaining,
          label,
          opponent: code(o),
          home: c.homeAway === 'home',
          ...(state !== 'pre' && { score: Number(c.score ?? 0), opponentScore: Number(o.score ?? 0) }),
          ...(drive && { drive }),
        };
      }
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
export async function liveMatchups(
  leagueId: string,
  season: string,
  week: number,
  scoring: Record<string, number>
): Promise<{ matchups: SleeperMatchup[]; allowed: Record<string, number>; stats: Record<string, StatLine> }> {
  const { baseUrl } = SLEEPER_CONFIG;
  const [matchups, stats] = await Promise.all([
    fetchJson<SleeperMatchup[]>(`${baseUrl}/league/${leagueId}/matchups/${week}`, 20),
    fetchJson<Record<string, Record<string, number>>>(`${baseUrl}/stats/nfl/regular/${season}/${week}`, 10).catch((error) => {
      console.error('Live stats unavailable:', error);
      return null;
    }),
  ]);
  if (!stats) return { matchups, allowed: {}, stats: {} };
  // Points each defense has allowed so far (defenses' IDs are their team codes)
  const allowed: Record<string, number> = {};
  for (const [id, s] of Object.entries(stats)) if (/^[A-Z]{2,3}$/.test(id) && s.gp) allowed[id] = s.pts_allow ?? 0;
  // Every rostered player's box score so far, for the lineup view
  const lines: Record<string, StatLine> = {};
  for (const id of matchups.flatMap((m) => m.players ?? [])) {
    const line = pickStats(stats[id]);
    if (line) lines[id] = line;
  }
  return { matchups: withLivePoints(matchups, stats, scoring), allowed, stats: lines };
}
