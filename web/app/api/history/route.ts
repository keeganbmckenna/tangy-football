import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import { fetchJson } from '@/lib/oddsData';
import { buildHistory } from '@/lib/historyData';
import type { SleeperLeague } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Bump when the response shape changes: cached results outlive deploys
const CACHE_VERSION = 'v2';

/**
 * League history across every season (History tab). Rebuilt as soon as a new
 * week is scored, and at most every 5 minutes otherwise.
 */
export async function GET() {
  try {
    const { leagueId, baseUrl } = SLEEPER_CONFIG;
    const league = await fetchJson<SleeperLeague>(`${baseUrl}/league/${leagueId}`, CACHE_CONFIG.leagueData);
    const lastScored = league.settings?.last_scored_leg ?? 0;
    const cached = unstable_cache(buildHistory, ['history', CACHE_VERSION, league.league_id, String(lastScored), league.status], {
      revalidate: CACHE_CONFIG.leagueData,
    });
    return NextResponse.json(await cached());
  } catch (error) {
    console.error('Error building league history:', error);
    return NextResponse.json({ error: 'Failed to build league history' }, { status: 500 });
  }
}
