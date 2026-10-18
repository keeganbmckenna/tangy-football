import { NextResponse } from 'next/server';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague, SleeperMatchup } from '@/lib/types';
import { defenseExpected, injuryAdjusted, leaguePoints, playerSpreadRatio, type LiveGame, type LiveProjection, type LiveWeekData } from '@/lib/analyze/live';
import { liveMatchups, scoreboard } from '@/lib/liveData';
import { weekProjections, type ProjectedPlayer } from '@/lib/oddsData';

// Always run on request; freshness comes from the short fetch cache below
export const dynamic = 'force-dynamic';

const fetchJson = async <T,>(url: string, revalidate: number | false = CACHE_CONFIG.liveData): Promise<T> => {
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
async function starterProjections(
  season: string,
  week: number,
  lastScoredWeek: number,
  matchups: SleeperMatchup[],
  games: Record<string, LiveGame>,
  scoring: Record<string, number>
) {
  const [week_, history] = await Promise.all([projectionsFor(season, week), seasonScores(season, lastScoredWeek)]);
  if (!week_) return null;
  const out: Record<string, LiveProjection> = {};
  // Starters count toward the odds; bench players are only shown
  for (const id of matchups.flatMap((m) => [...(m.starters ?? []), ...(m.players ?? [])])) {
    const p = week_[id];
    if (!p || id === '0') continue;
    const started = !!p.team && !!games[p.team] && games[p.team].state !== 'pre';
    // A defense: its projection in the league's scoring, with points allowed by bracket
    const defense = p.stats && typeof p.stats.pts_allow === 'number'
      ? { allowed: p.stats.pts_allow, other: leaguePoints(Object.fromEntries(Object.entries(p.stats).filter(([k]) => !k.startsWith('pts_allow'))), scoring) }
      : undefined;
    out[id] = {
      points: defense ? defenseExpected(0, false, 0, defense, 1, allowedScoring(scoring)) : injuryAdjusted(p.points, p.injury, started),
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
const allowedScoring = (scoring: Record<string, number>) => Object.fromEntries(Object.entries(scoring).filter(([k]) => k.startsWith('pts_allow_')));

/**
 * Current week's matchups for the current season, for the Live tab, plus what the live
 * win odds need while a week is being played. Cached for CACHE_CONFIG.liveData seconds so
 * polling clients share requests.
 */
export async function GET() {
  try {
    const { leagueId, baseUrl, maxWeeks } = SLEEPER_CONFIG;
    const league = await fetchJson<SleeperLeague>(`${baseUrl}/league/${leagueId}`);
    const week = Math.min(league.settings?.leg ?? 0, maxWeeks);
    const lastScoredWeek = league.settings?.last_scored_leg ?? 0;
    // Points from live stats, the same as /api/live/scores, so the two never disagree
    const { matchups, allowed } = week > 0 ? await liveMatchups(leagueId, league.season, week, league.scoring_settings ?? {}) : { matchups: [], allowed: {} };

    const body: LiveWeekData = {
      season: league.season,
      week,
      lastScoredWeek,
      playoffWeekStart: league.settings?.playoff_week_start ?? 15,
      matchups,
      fetchedAt: new Date().toISOString(),
    };
    // Live win odds: only while the week is being played, and only with both feeds
    if (week > lastScoredWeek && matchups.length) {
      const games = await scoreboard(league.season, week);
      const scoring = league.scoring_settings ?? {};
      const projections = games ? await starterProjections(league.season, week, lastScoredWeek, matchups, games, scoring).catch(() => null) : null;
      if (games && projections) Object.assign(body, { games, projections, allowedScoring: allowedScoring(scoring), allowed });
    }
    return NextResponse.json(body);
  } catch (error) {
    console.error('Error fetching live data:', error);
    return NextResponse.json({ error: 'Failed to fetch live data from Sleeper API' }, { status: 500 });
  }
}
