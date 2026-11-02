import { NextResponse } from 'next/server';
import { SLEEPER_CONFIG } from '@/lib/config';
import { weekProjections } from '@/lib/oddsData';
import { pickStats, type StatLine } from '@/lib/analyze/statLine';

export interface MatchupPlayersData {
  /** player ID -> name, position, team that week, Sleeper's projection for the week and his box score */
  players: Record<string, { name: string; position: string; team: string | null; projected: number; stats?: StatLine }>;
}

// A finished week only changes with the next Thursday's stat corrections: keep each one built here
// for an hour, and let the CDN keep it an hour too (serving the old copy for a day while it refreshes)
const KEEP_MS = 3600_000;
const cache = new Map<string, { at: number; data: MatchupPlayersData }>();

/** Names and original projections for every player in a week's matchups (the Overview's lineup view) */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const season = params.get('season') ?? '';
  const week = Number(params.get('week'));
  if (!/^\d{4}$/.test(season) || !Number.isInteger(week) || week < 1 || week > 18) {
    return NextResponse.json({ error: 'season and week are required' }, { status: 400 });
  }
  const key = `${season}:${week}`;
  const kept = cache.get(key);
  let data = kept && Date.now() - kept.at < KEEP_MS ? kept.data : undefined;
  if (!data) {
    const [projections, stats] = await Promise.all([
      weekProjections(season, week),
      fetch(`${SLEEPER_CONFIG.baseUrl}/stats/nfl/regular/${season}/${week}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
        .then((r) => (r.ok ? (r.json() as Promise<Record<string, Record<string, number>>>) : null))
        .catch(() => null),
    ]);
    if (!projections) return NextResponse.json({ error: 'Projections unavailable' }, { status: 502 });
    data = {
      players: Object.fromEntries(
        Object.entries(projections).map(([id, p]) => {
          const line = pickStats(stats?.[id]);
          return [id, { name: p.name, position: p.position, team: p.team, projected: p.points, ...(line ? { stats: line } : {}) }];
        })
      ),
    };
    // Without box scores, nothing is kept: the next request tries Sleeper's stats again
    if (!stats) return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
    cache.set(key, { at: Date.now(), data });
  }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
}
