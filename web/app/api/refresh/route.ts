import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { FRESH_TAG } from '@/lib/config';

export const dynamic = 'force-dynamic';

/** At most one cache clear per this long (per server instance): a quick second tap reuses the first */
const MIN_GAP_MS = 30_000;
let lastCleared = 0;

/**
 * The header's refresh button: expires the cached league, users, rosters, brackets and the
 * builds made from them (FRESH_TAG), so the requests the page makes next go to Sleeper.
 * The browser then reloads its data.
 */
export async function POST() {
  const now = Date.now();
  const cleared = now - lastCleared >= MIN_GAP_MS;
  if (cleared) {
    revalidateTag(FRESH_TAG, { expire: 0 });
    lastCleared = now;
  }
  return NextResponse.json({ cleared, at: new Date(lastCleared).toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
