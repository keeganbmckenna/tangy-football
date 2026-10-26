import { NextRequest, NextResponse } from 'next/server';
import { readSnapshots } from '@/lib/liveHistory';

export const dynamic = 'force-dynamic';

/**
 * A week's saved live win odds (lib/liveHistory.ts), in the win-history shape: the week in
 * progress, and finished weeks until the play-by-play replay is built
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const season = params.get('season') ?? '';
  const week = Number(params.get('week'));
  if (!/^\d{4}$/.test(season) || !Number.isInteger(week) || week < 1 || week > 18) {
    return NextResponse.json({ error: 'season and week are required' }, { status: 400 });
  }
  const history = await readSnapshots(season, week);
  if (!history) return NextResponse.json({ error: 'No saved odds for this week' }, { status: 404 });
  return NextResponse.json(history, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' } });
}
