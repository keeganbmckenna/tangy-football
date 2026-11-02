/**
 * Saving the week in progress's odds for its win-probability history (lib/liveHistory.ts): called
 * by both live routes after they answer. Only the request that gets the save works out the odds.
 */

import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague, SleeperMatchup, TeamStats } from '@/lib/types';
import { allowedPoints, liveWinOdds, scoreSpread, type LiveGame } from '@/lib/analyze/live';
import { saveSnapshot } from '@/lib/liveHistory';
import { gamePlays, liveMatchups, scoreboard } from '@/lib/liveData';
import { allowedScoring, fetchJson, starterProjections } from '@/lib/liveProjections';

/** The spread the Live tab's odds use: the season's week-to-week spread through the last scored week */
async function seasonSpread(baseUrl: string, leagueId: string, lastScoredWeek: number): Promise<number> {
  const weeks = await Promise.all(
    Array.from({ length: lastScoredWeek }, (_, i) => fetchJson<SleeperMatchup[]>(`${baseUrl}/league/${leagueId}/matchups/${i + 1}`, CACHE_CONFIG.completedWeek))
  );
  const scores = new Map<number, number[]>();
  for (const week of weeks) for (const m of week) scores.set(m.roster_id, [...(scores.get(m.roster_id) ?? []), m.points ?? 0]);
  return scoreSpread([...scores.values()].map((weeklyScores) => ({ weeklyScores }) as TeamStats), lastScoredWeek);
}

/** Save the odds now while any game is on (at most once per save interval, across all requests) */
export async function saveLiveOdds(
  league: SleeperLeague,
  week: number,
  matchups: SleeperMatchup[],
  allowed: Record<string, number>,
  games: Record<string, LiveGame> | null
): Promise<void> {
  const lastScoredWeek = league.settings?.last_scored_leg ?? 0;
  if (!games || week <= lastScoredWeek || !matchups.length || !Object.values(games).some((g) => g.state === 'in')) return;
  await saveSnapshot(league.season, week, async () => {
    const scoring = league.scoring_settings ?? {};
    // The save's own uncached scores and clocks: what the route answered with can be a cached copy
    // from the request before, minutes old when the only requests are the scheduled pings
    const [current, games] = await Promise.all([
      liveMatchups(SLEEPER_CONFIG.leagueId, league.season, week, scoring, true),
      scoreboard(league.season, week, false),
    ]);
    if (!games) return null;
    const { matchups, allowed } = current;
    const [projections, spread] = await Promise.all([
      starterProjections(league.season, week, lastScoredWeek, matchups, games, scoring),
      seasonSpread(SLEEPER_CONFIG.baseUrl, SLEEPER_CONFIG.leagueId, lastScoredWeek),
    ]);
    if (!projections) return null;
    const odds = liveWinOdds(matchups, projections, games, spread, { allowed, allowedScoring: allowedScoring(scoring) });
    // Each starter's points now, so the save can spot big moments since the last one
    const starters = (rosterId: number) => (matchups.find((m) => m.roster_id === rosterId)?.starters ?? []).filter((id) => id && id !== '0');
    // A defense from its kickoff baseline: starting in the shutout bracket isn't a play
    const kickoff = allowedPoints(0, allowedScoring(scoring));
    const pts = Object.fromEntries(
      matchups.flatMap((m) =>
        starters(m.roster_id).map((id) => [id, (m.players_points?.[id] ?? 0) - (id in allowed && games[id]?.state !== 'pre' ? kickoff : 0)])
      )
    );
    return {
      odds,
      live: {
        pts,
        starters: odds.map((o) => ({ matchupId: o.matchupId, a: starters(o.a.rosterId), b: starters(o.b.rosterId) })),
        nameOf: (id: string) => {
          const p = projections[id];
          return p ? (p.position === 'DEF' ? p.name : p.name.replace(/^(\S)\S*\s+(?=\S)/, '$1. ')) : id;
        },
        teamOf: (id: string) => projections[id]?.team ?? (/^[A-Z]{2,3}$/.test(id) ? id : null),
        // Each game's plays straight from ESPN, so a play that just happened is there to match
        plays: async (teams: string[]) => {
          const ids = [...new Set(teams.map((t) => games[t]?.espnId).filter((x): x is string => !!x))];
          const fetched = new Map(await Promise.all(ids.map(async (id) => [id, await gamePlays(id, false)] as const)));
          return Object.fromEntries(
            teams.flatMap((t) => {
              const g = games[t];
              const plays = g?.espnId ? fetched.get(g.espnId) : undefined;
              return plays ? [[t, { plays, teams: g.opponent ? [t, g.opponent] : [t] }]] : [];
            })
          );
        },
        // The odds with some starters' points taken away, for each moment's swing
        oddsWithout: (points: Record<string, number>) => {
          const adjusted = matchups.map((m) => {
            const moved = (m.starters ?? []).filter((id) => points[id]);
            if (!moved.length) return m;
            const players_points = { ...m.players_points };
            for (const id of moved) players_points[id] = (players_points[id] ?? 0) - points[id];
            return { ...m, players_points, points: (m.points ?? 0) - moved.reduce((s, id) => s + points[id], 0) };
          });
          const o = liveWinOdds(adjusted, projections, games, spread, { allowed, allowedScoring: allowedScoring(scoring) });
          return Object.fromEntries(o.map((x) => [x.matchupId, x.aWinOdds]));
        },
      },
    };
  });
}
