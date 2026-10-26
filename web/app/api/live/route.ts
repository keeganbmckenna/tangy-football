import { NextResponse } from 'next/server';
import { SLEEPER_CONFIG } from '@/lib/config';
import type { SleeperLeague } from '@/lib/types';
import type { LiveWeekData } from '@/lib/analyze/live';
import { liveMatchups, scoreboard } from '@/lib/liveData';
import { allowedScoring, fetchJson, starterProjections } from '@/lib/liveProjections';

// Always run on request; freshness comes from the short fetch cache below
export const dynamic = 'force-dynamic';

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
      if (games && projections) Object.assign(body, { games, projections, allowedScoring: allowedScoring(scoring), allowed });
    }
    return NextResponse.json(body);
  } catch (error) {
    console.error('Error fetching live data:', error);
    return NextResponse.json({ error: 'Failed to fetch live data from Sleeper API' }, { status: 500 });
  }
}
