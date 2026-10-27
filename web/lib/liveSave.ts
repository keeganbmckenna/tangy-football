/**
 * Saving the week in progress's odds for its win-probability history (lib/liveHistory.ts): called
 * by both live routes after they answer. Only the request that gets the save works out the odds.
 */

import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague, SleeperMatchup, TeamStats } from '@/lib/types';
import { allowedPoints, liveWinOdds, scoreSpread, type LiveGame } from '@/lib/analyze/live';
import { saveSnapshot } from '@/lib/liveHistory';
import { matchPlay } from '@/lib/winHistory';
import { gamePlays } from '@/lib/liveData';
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
        // The play behind a big moment, from ESPN's play-by-play of the moving player's game
        describe: async (event, since) => {
          const top = [...event.players].sort((x, y) => Math.abs(y.pts) - Math.abs(x.pts))[0];
          const p = top?.id ? projections[top.id] : undefined;
          const espnId = p?.team ? games[p.team]?.espnId : undefined;
          if (!p || p.position === 'DEF' || !espnId) return null;
          const lastName = p.name.split(' ').filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w)).pop() ?? '';
          const play = matchPlay(event, await gamePlays(espnId), lastName, since);
          const opponent = games[p.team!]?.opponent;
          return play && { ...play, teams: opponent ? [p.team!, opponent] : [p.team!] };
        },
      },
    };
  });
}
