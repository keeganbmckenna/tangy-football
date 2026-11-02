import { headers } from 'next/headers';
import { originOf, shareMatchup } from '@/lib/shareData';
import { matchupImage, SIZE } from '@/lib/shareImage';

export const size = SIZE;
export const contentType = 'image/png';
export const alt = 'Tangy Football matchup';

/** A matchup's preview image (lib/shareImage.tsx) */
export default async function Image({ params }: { params: Promise<{ season: string; week: string; matchup: string }> }) {
  const { season, week, matchup } = await params;
  const m = await shareMatchup(originOf(await headers()), season, Number(week), Number(matchup));
  if (!m) return new Response('Not found', { status: 404 });
  return matchupImage(m);
}
