import { NextResponse } from 'next/server';
import { SLEEPER_CONFIG } from '@/lib/config';
import { liveMatchups, scoreboard } from '@/lib/liveData';
import type { LiveScoresData } from '@/lib/analyze/live';
import type { SleeperLeague } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * The fast-changing half of the Live tab, polled every few seconds during games: this
 * week's matchups with points from live stats, and every NFL game's clock. Shared through
 * the CDN for a few seconds, so any number of viewers costs one set of upstream requests.
 */
export async function GET() {
  try {
    const { leagueId, baseUrl, maxWeeks } = SLEEPER_CONFIG;
    const res = await fetch(`${baseUrl}/league/${leagueId}`, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`League request failed (${res.status})`);
    const league = (await res.json()) as SleeperLeague;
    const week = Math.min(league.settings?.leg ?? 0, maxWeeks);
    const [matchups, games] = week > 0
      ? await Promise.all([liveMatchups(leagueId, league.season, week, league.scoring_settings ?? {}), scoreboard(league.season, week)])
      : [[], null];
    const body: LiveScoresData = { week, matchups, games: games ?? undefined, fetchedAt: new Date().toISOString() };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'public, s-maxage=8, stale-while-revalidate=10' } });
  } catch (error) {
    console.error('Error fetching live scores:', error);
    return NextResponse.json({ error: 'Failed to fetch live scores' }, { status: 500 });
  }
}
