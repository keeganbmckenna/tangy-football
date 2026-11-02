import { NextRequest } from 'next/server';
import { originOf, shareWeek } from '@/lib/shareData';
import { weekImage } from '@/lib/shareImage';

/** The week recap's preview picture (lib/shareImage.tsx) */
export async function GET(request: NextRequest, { params }: { params: Promise<{ season: string; week: string }> }) {
  const { season, week } = await params;
  const w = await shareWeek(originOf(request.headers), season, Number(week));
  if (!w) return new Response('Not found', { status: 404 });
  return weekImage(w);
}
