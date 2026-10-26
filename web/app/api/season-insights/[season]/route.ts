import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import { buildLeagueChain } from '@/lib/sleeper';
import { buildSeasonInsights } from '@/lib/seasonInsights';

export const dynamic = 'force-dynamic';

// Bump when the response shape changes: cached results outlive deploys
const CACHE_VERSION = 'v1';

/**
 * A season's lineups, projections and waiver moves (lib/seasonInsights.ts), for the Rosters
 * tab, the weekly awards and Season in Review. Rebuilt as soon as a new week is scored.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ season: string }> }) {
  try {
    const { season } = await params;
    const { leagueId, baseUrl } = SLEEPER_CONFIG;
    const leagues = await buildLeagueChain(baseUrl, leagueId);
    const league = leagues.find((l) => l.season === season);
    if (!league) return NextResponse.json({ error: `No league found for season ${season}` }, { status: 404 });

    const lastScored = league.settings?.last_scored_leg ?? 0;
    const cached = unstable_cache(() => buildSeasonInsights(league), ['season-insights', CACHE_VERSION, league.league_id, String(lastScored)], {
      revalidate: CACHE_CONFIG.seasonInsights,
    });
    return NextResponse.json(await cached());
  } catch (error) {
    console.error('Error building season insights:', error);
    return NextResponse.json({ error: 'Failed to build season insights' }, { status: 500 });
  }
}
