import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import { buildLeagueChain } from '@/lib/sleeper';
import { buildOddsHistory } from '@/lib/oddsHistory';

export const dynamic = 'force-dynamic';

// Bump when the model or response shape changes: cached results outlive deploys
const CACHE_VERSION = 'v2';

/**
 * How each team's playoff, bye, division, title and toilet-bowl odds moved through a season:
 * the playoff-odds model re-run as of the draft and after each completed week
 * (lib/oddsHistory.ts). Rebuilt as soon as a new week is scored.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ season: string }> }) {
  try {
    const { season } = await params;
    const { leagueId, baseUrl } = SLEEPER_CONFIG;
    const leagues = await buildLeagueChain(baseUrl, leagueId);
    const league = leagues.find((l) => l.season === season);
    if (!league) return NextResponse.json({ error: `No league found for season ${season}` }, { status: 404 });

    const lastScored = league.settings?.last_scored_leg ?? 0;
    const cached = unstable_cache(() => buildOddsHistory(league), ['odds-history', CACHE_VERSION, league.league_id, String(lastScored)], {
      revalidate: CACHE_CONFIG.oddsHistory,
    });
    return NextResponse.json(await cached());
  } catch (error) {
    console.error('Error building odds history:', error);
    return NextResponse.json({ error: 'Failed to build odds history' }, { status: 500 });
  }
}
