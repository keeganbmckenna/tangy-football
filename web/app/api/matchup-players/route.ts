import { NextResponse } from 'next/server';
import { weekProjections } from '@/lib/oddsData';

export interface MatchupPlayersData {
  /** player ID -> name, position, team that week and Sleeper's projection for the week */
  players: Record<string, { name: string; position: string; team: string | null; projected: number }>;
}

// A finished week never changes: keep each one built here, and let the CDN keep it a day
const cache = new Map<string, MatchupPlayersData>();

/** Names and original projections for every player in a week's matchups (the Overview's lineup view) */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const season = params.get('season') ?? '';
  const week = Number(params.get('week'));
  if (!/^\d{4}$/.test(season) || !Number.isInteger(week) || week < 1 || week > 18) {
    return NextResponse.json({ error: 'season and week are required' }, { status: 400 });
  }
  const key = `${season}:${week}`;
  let data = cache.get(key);
  if (!data) {
    const projections = await weekProjections(season, week);
    if (!projections) return NextResponse.json({ error: 'Projections unavailable' }, { status: 502 });
    data = {
      players: Object.fromEntries(
        Object.entries(projections).map(([id, p]) => [id, { name: p.name, position: p.position, team: p.team, projected: p.points }])
      ),
    };
    cache.set(key, data);
  }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' } });
}
