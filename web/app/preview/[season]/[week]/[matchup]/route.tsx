import { NextRequest } from 'next/server';
import { firstSide, originOf, shareMatchup } from '@/lib/shareData';
import { matchupImage } from '@/lib/shareImage';

/** A matchup's preview picture (lib/shareImage.tsx), the sharer's team first (?me=) */
export async function GET(request: NextRequest, { params }: { params: Promise<{ season: string; week: string; matchup: string }> }) {
  const { season, week, matchup } = await params;
  const m = await shareMatchup(originOf(request.headers), season, Number(week), Number(matchup), firstSide(request.nextUrl.searchParams.get('me')));
  if (!m) return new Response('Not found', { status: 404 });
  return matchupImage(m);
}
