import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import { buildLeagueChain } from '@/lib/sleeper';
import { buildTradeHistory } from '@/lib/tradeHistory';

export const dynamic = 'force-dynamic';

// Bump when the model or response shape changes: cached results outlive deploys
const CACHE_VERSION = 'v2';

/**
 * A season's completed trades, graded at the time (playoff-odds model re-run
 * the week of the trade) and in hindsight (starting-lineup points). Completed
 * seasons are also pre-built as /data/trades/{season}.json
 * (scripts/build_trade_history.py), which the Trades tab tries first.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ season: string }> }) {
  try {
    const { season } = await params;
    const { leagueId, baseUrl } = SLEEPER_CONFIG;
    const leagues = await buildLeagueChain(baseUrl, leagueId);
    const league = leagues.find((l) => l.season === season);
    if (!league) return NextResponse.json({ error: `No league found for season ${season}` }, { status: 404 });

    const lastScored = league.settings?.last_scored_leg ?? 0;
    const cached = unstable_cache(() => buildTradeHistory(league), ['trade-history', CACHE_VERSION, league.league_id, String(lastScored)], {
      revalidate: CACHE_CONFIG.tradeHistory,
    });
    return NextResponse.json(await cached());
  } catch (error) {
    console.error('Error building trade history:', error);
    return NextResponse.json({ error: 'Failed to build trade history' }, { status: 500 });
  }
}
