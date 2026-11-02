import { NextRequest, NextResponse } from 'next/server';
import { kickoffsAround, pingTimes, queuePings, verifyQstash } from '@/lib/livePing';

export const dynamic = 'force-dynamic';

const SITE = 'https://tangy-football.vercel.app';

/**
 * Called once a day by a QStash schedule (scripts/live_ping_schedule.sh): queues pings of /api/live
 * for the next 24 hours, only while NFL games can be on (lib/livePing.ts). Only QStash may call it,
 * since each queued ping uses up the daily QStash allowance.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  if (!verifyQstash(request.headers.get('upstash-signature'), `${SITE}/api/live/plan`, body)) {
    return NextResponse.json({ error: 'Not signed by QStash' }, { status: 401 });
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    const times = pingTimes(await kickoffsAround(now), now, now + 24 * 3600);
    await queuePings(`${SITE}/api/live`, times);
    return NextResponse.json({ queued: times.length, first: times[0] ?? null, last: times.at(-1) ?? null });
  } catch (error) {
    console.error('Live ping plan failed:', error);
    return NextResponse.json({ error: 'Failed to queue live pings' }, { status: 500 });
  }
}
