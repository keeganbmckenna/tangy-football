import { NextRequest, NextResponse } from 'next/server';
import { loadLeagueData } from '@/lib/leagueData';

export async function GET(request: NextRequest) {
  try {
    const seasonParam = request.nextUrl.searchParams.get('season');
    const data = await loadLeagueData(seasonParam);
    if (!data) {
      return NextResponse.json(
        { error: `Season ${seasonParam} not found` },
        { status: 404 }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching league data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch league data' },
      { status: 500 }
    );
  }
}
