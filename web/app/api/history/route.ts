import { NextResponse } from 'next/server';
import { cachedHistory } from '@/lib/historyData';

export const dynamic = 'force-dynamic';

/**
 * League history across every season (History tab). Rebuilt as soon as a new
 * week is scored, and at most every 5 minutes otherwise (lib/historyData.ts).
 */
export async function GET() {
  try {
    return NextResponse.json(await cachedHistory());
  } catch (error) {
    console.error('Error building league history:', error);
    return NextResponse.json({ error: 'Failed to build league history' }, { status: 500 });
  }
}
