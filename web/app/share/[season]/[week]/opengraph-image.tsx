import { headers } from 'next/headers';
import { originOf, shareWeek } from '@/lib/shareData';
import { SIZE, weekImage } from '@/lib/shareImage';

export const size = SIZE;
export const contentType = 'image/png';
export const alt = 'Tangy Football week recap';

/** The week recap's preview image (lib/shareImage.tsx) */
export default async function Image({ params }: { params: Promise<{ season: string; week: string }> }) {
  const { season, week } = await params;
  const w = await shareWeek(originOf(await headers()), season, Number(week));
  if (!w) return new Response('Not found', { status: 404 });
  return weekImage(w);
}
