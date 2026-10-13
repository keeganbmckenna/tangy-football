import { NextResponse } from 'next/server';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague, SleeperMatchup } from '@/lib/types';
import type { LiveWeekData } from '@/lib/analyze/live';

// Always run on request; freshness comes from the short fetch cache below
export const dynamic = 'force-dynamic';

const fetchJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { next: { revalidate: CACHE_CONFIG.liveData } });
  if (!response.ok) {
    throw new Error(`Sleeper request failed (${response.status}): ${url}`);
  }
  return response.json() as Promise<T>;
};

/**
 * Current week's matchups for the current season, for the Live tab. Cached
 * for CACHE_CONFIG.liveData seconds so polling clients share Sleeper requests.
 */
export async function GET() {
  try {
    const { leagueId, baseUrl, maxWeeks } = SLEEPER_CONFIG;
    const league = await fetchJson<SleeperLeague>(`${baseUrl}/league/${leagueId}`);
    const week = Math.min(league.settings?.leg ?? 0, maxWeeks);
    const matchups = week > 0
      ? await fetchJson<SleeperMatchup[]>(`${baseUrl}/league/${leagueId}/matchups/${week}`)
      : [];

    const body: LiveWeekData = {
      season: league.season,
      week,
      lastScoredWeek: league.settings?.last_scored_leg ?? 0,
      playoffWeekStart: league.settings?.playoff_week_start ?? 15,
      matchups,
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('Error fetching live data:', error);
    return NextResponse.json({ error: 'Failed to fetch live data from Sleeper API' }, { status: 500 });
  }
}
