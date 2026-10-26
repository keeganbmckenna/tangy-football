/**
 * What the live win odds need for a week's players: each one's projection (injuries counted,
 * defenses split into points allowed and everything else) and how boom-or-bust he is. Used by
 * /api/live and by the win-probability history (scripts/build-win-history.ts).
 */

import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperMatchup } from '@/lib/types';
import { defenseExpected, injuryAdjusted, leaguePoints, playerSpreadRatio, type LiveGame, type LiveProjection } from '@/lib/analyze/live';
import { weekProjections, type ProjectedPlayer } from '@/lib/oddsData';

/** JSON with the live data's short fetch cache (or none), and a timeout */
export const fetchJson = async <T,>(url: string, revalidate: number | false = CACHE_CONFIG.liveData): Promise<T> => {
  // The bigger files (projections, a season of stats) can take a while, but not forever
  const signal = AbortSignal.timeout(15_000);
  const response = await fetch(url, revalidate === false ? { cache: 'no-store', signal } : { next: { revalidate }, signal });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  return response.json() as Promise<T>;
};

// Projections (with injury statuses) are too big for the fetch cache: kept here a couple of minutes
const PROJECTIONS_MS = 2 * 60_000;
let projectionCache: { key: string; at: number; data: Record<string, ProjectedPlayer> | null } | null = null;
async function projectionsFor(season: string, week: number) {
  const key = `${season}:${week}`;
  if (projectionCache?.key === key && Date.now() - projectionCache.at < PROJECTIONS_MS) return projectionCache.data;
  const data = await weekProjections(season, week);
  projectionCache = { key, at: Date.now(), data };
  return data;
}

// Every player's weekly scores this season, rebuilt when a new week is scored
let historyCache: { key: string; data: Record<string, number[]> } | null = null;
async function seasonScores(season: string, throughWeek: number): Promise<Record<string, number[]>> {
  const key = `${season}:${throughWeek}`;
  if (historyCache?.key === key) return historyCache.data;
  const weeks = await Promise.all(
    Array.from({ length: throughWeek }, (_, i) =>
      fetchJson<Record<string, { pts_half_ppr?: number; gp?: number }>>(`${SLEEPER_CONFIG.baseUrl}/stats/nfl/regular/${season}/${i + 1}`, false).catch(
        () => ({}) as Record<string, { pts_half_ppr?: number; gp?: number }>
      )
    )
  );
  const data: Record<string, number[]> = {};
  for (const week of weeks) {
    for (const [id, s] of Object.entries(week)) if (s.gp) (data[id] ??= []).push(s.pts_half_ppr ?? 0);
  }
  historyCache = { key, data };
  return data;
}

/** This week's projections for every player in the matchups (injuries counted), and how boom-or-bust each one is */
export async function starterProjections(
  season: string,
  week: number,
  lastScoredWeek: number,
  matchups: SleeperMatchup[],
  games: Record<string, LiveGame>,
  scoring: Record<string, number>,
  /** Injury statuses to use instead of Sleeper's current ones (a past week's, for the win history) */
  injuries?: Record<string, string | null>
) {
  const [week_, history] = await Promise.all([projectionsFor(season, week), seasonScores(season, lastScoredWeek)]);
  if (!week_) return null;
  const out: Record<string, LiveProjection> = {};
  // Starters count toward the odds; bench players are only shown
  for (const id of matchups.flatMap((m) => [...(m.starters ?? []), ...(m.players ?? [])])) {
    const p = week_[id] && injuries ? { ...week_[id], injury: injuries[id] ?? null } : week_[id];
    if (!p || id === '0') continue;
    const started = !!p.team && !!games[p.team] && games[p.team].state !== 'pre';
    // A defense: its projection in the league's scoring, with points allowed by bracket
    const defense = p.stats && typeof p.stats.pts_allow === 'number'
      ? { allowed: p.stats.pts_allow, other: leaguePoints(Object.fromEntries(Object.entries(p.stats).filter(([k]) => !k.startsWith('pts_allow'))), scoring) }
      : undefined;
    out[id] = {
      points: defense ? defenseExpected(0, false, 0, defense, 1, allowedScoring(scoring)) : injuryAdjusted(p.points, p.injury, started),
      // A player hurt during his game still shows what he was projected for
      ...(!defense && { original: p.points }),
      ...(defense ? { defense } : {}),
      spreadRatio: playerSpreadRatio(p.position, history[id] ?? []),
      team: p.team,
      name: p.name,
      position: p.position,
      injury: p.injury,
    };
  }
  return out;
}

/** The league's points-allowed brackets */
export const allowedScoring = (scoring: Record<string, number>) => Object.fromEntries(Object.entries(scoring).filter(([k]) => k.startsWith('pts_allow_')));

