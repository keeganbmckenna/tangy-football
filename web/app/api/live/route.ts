import { NextResponse } from 'next/server';
import { SLEEPER_CONFIG } from '@/lib/config';
import type { SleeperLeague, SleeperMatchup, TeamStats } from '@/lib/types';
import { allowedPoints, liveWinOdds, scoreSpread, type LiveWeekData } from '@/lib/analyze/live';
import { CACHE_CONFIG } from '@/lib/config';
import { saveSnapshot } from '@/lib/liveHistory';
import { matchPlay } from '@/lib/winHistory';
import { gamePlays, liveMatchups, scoreboard } from '@/lib/liveData';
import { allowedScoring, fetchJson, starterProjections } from '@/lib/liveProjections';

// Always run on request; freshness comes from the short fetch cache below
export const dynamic = 'force-dynamic';

/** The spread the Live tab's odds use: the season's week-to-week spread through the last scored week */
async function seasonSpread(baseUrl: string, leagueId: string, lastScoredWeek: number): Promise<number> {
  const weeks = await Promise.all(
    Array.from({ length: lastScoredWeek }, (_, i) => fetchJson<SleeperMatchup[]>(`${baseUrl}/league/${leagueId}/matchups/${i + 1}`, CACHE_CONFIG.completedWeek))
  );
  const scores = new Map<number, number[]>();
  for (const week of weeks) for (const m of week) scores.set(m.roster_id, [...(scores.get(m.roster_id) ?? []), m.points ?? 0]);
  return scoreSpread([...scores.values()].map((weeklyScores) => ({ weeklyScores }) as TeamStats), lastScoredWeek);
}

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
    const { matchups, allowed, stats } = week > 0
      ? await liveMatchups(leagueId, league.season, week, league.scoring_settings ?? {})
      : { matchups: [], allowed: {}, stats: {} };

    const body: LiveWeekData = {
      season: league.season,
      week,
      lastScoredWeek,
      playoffWeekStart: league.settings?.playoff_week_start ?? 15,
      matchups,
      stats,
      fetchedAt: new Date().toISOString(),
    };
    // Live win odds: only while the week is being played, and only with both feeds
    if (week > lastScoredWeek && matchups.length) {
      const games = await scoreboard(league.season, week);
      const scoring = league.scoring_settings ?? {};
      const projections = games ? await starterProjections(league.season, week, lastScoredWeek, matchups, games, scoring).catch(() => null) : null;
      if (games && projections) {
        Object.assign(body, { games, projections, allowedScoring: allowedScoring(scoring), allowed });
        // While games are on, save the odds for the week's win-probability history (lib/liveHistory.ts)
        if (Object.values(games).some((g) => g.state === 'in')) {
          const spread = await seasonSpread(baseUrl, leagueId, lastScoredWeek).catch(() => null);
          if (spread !== null) {
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
            await saveSnapshot(league.season, week, odds, {
              pts,
              starters: odds.map((o) => ({ matchupId: o.matchupId, a: starters(o.a.rosterId), b: starters(o.b.rosterId) })),
              nameOf: (id) => {
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
            });
          }
        }
      }
    }
    return NextResponse.json(body);
  } catch (error) {
    console.error('Error fetching live data:', error);
    return NextResponse.json({ error: 'Failed to fetch live data from Sleeper API' }, { status: 500 });
  }
}
