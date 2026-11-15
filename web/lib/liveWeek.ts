/**
 * The week being played, for the odds tools (playoff odds, What If, Games Ahead and the trade
 * tools): once its first NFL game kicks off, its games' odds are the Live tab's, which know the
 * points already scored and who is still to play, instead of the before-kickoff models.
 */

import { unstable_cache } from 'next/cache';
import { currentWeek } from '@/lib/analyze/live';
import type { LiveGameOdds } from '@/lib/analyze/playoffOdds';
import { liveWeekNow } from '@/lib/liveSave';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague } from '@/lib/types';

export interface LiveWeekOdds {
  week: number;
  games: LiveGameOdds[];
  /** NFL teams whose game this week has kicked off */
  started: string[];
  /** rosterId -> its starters this week */
  starters: Record<number, string[]>;
  fetchedAt: string;
}

/** The week being played once a game of it has kicked off (null before then, between weeks or on any failure) */
export async function liveWeekOdds(league: SleeperLeague): Promise<LiveWeekOdds | null> {
  const lastScored = league.settings?.last_scored_leg ?? 0;
  const week = Math.min(currentWeek(league.settings?.leg ?? 0, lastScored), SLEEPER_CONFIG.maxWeeks);
  if (week <= lastScored) return null;
  // Shared across requests for as long as the Live tab's own feed
  const cached = unstable_cache(
    async (): Promise<LiveWeekOdds | null> => {
      const now = await liveWeekNow(league, week);
      if (!now) return null;
      const started = Object.entries(now.games).filter(([, g]) => g.state !== 'pre').map(([team]) => team);
      if (!started.length) return null;
      return {
        week,
        games: now.odds.map((o) => ({ week, a: o.a.rosterId, b: o.b.rosterId, aMean: o.a.projected, bMean: o.b.projected, sd: o.sd, aWins: o.aWinOdds })),
        started,
        starters: Object.fromEntries(now.matchups.map((m) => [m.roster_id, (m.starters ?? []).filter((id) => id && id !== '0')])),
        fetchedAt: new Date().toISOString(),
      };
    },
    ['live-week-odds', 'v1', league.league_id, String(week), String(lastScored)],
    { revalidate: CACHE_CONFIG.liveData }
  );
  try {
    return await cached();
  } catch (error) {
    console.error('Live week odds unavailable:', error);
    return null;
  }
}
