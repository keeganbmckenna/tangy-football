import { leagueAppIcon } from '@/lib/appIcon';

/** Home-screen icons for the web app manifest (app/manifest.ts) */
const SIZES = [192, 512];

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.includes(size)) return new Response('Not found', { status: 404 });
  return leagueAppIcon(size);
}
