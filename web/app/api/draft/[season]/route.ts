import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import { buildLeagueChain } from '@/lib/sleeper';
import { buildDraftData } from '@/lib/analyze/draft';
import type {
  SleeperDraft,
  SleeperDraftPick,
  SleeperPlayerWeekStats,
  SleeperRoster,
} from '@/lib/types';

const fetchJson = async <T,>(url: string): Promise<T> => {
  // Weekly stats payloads cover every NFL player and exceed Next's 2MB fetch
  // cache limit, so skip the fetch cache; the built result is cached instead.
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Sleeper request failed (${response.status}): ${url}`);
  }
  return response.json() as Promise<T>;
};

const buildLiveDraft = async (
  baseUrl: string,
  leagueId: string,
  draftId: string,
  season: string,
  lastScoredWeek: number
) => {
  const weeks = Array.from({ length: lastScoredWeek }, (_, i) => i + 1);
  const [draft, picks, rosters, weeklyStats] = await Promise.all([
    fetchJson<SleeperDraft>(`${baseUrl}/draft/${draftId}`),
    fetchJson<SleeperDraftPick[]>(`${baseUrl}/draft/${draftId}/picks`),
    fetchJson<SleeperRoster[]>(`${baseUrl}/league/${leagueId}/rosters`),
    Promise.all(
      weeks.map((week) =>
        fetchJson<Record<string, SleeperPlayerWeekStats>>(`${baseUrl}/stats/nfl/regular/${season}/${week}`)
      )
    ),
  ]);
  return buildDraftData(draft, picks, rosters, weeklyStats);
};

/**
 * Live draft board data for a season, built from Sleeper on demand so the
 * in-progress season always reflects the latest scored week. Completed seasons
 * are served as pre-built JSON from /data/drafts (scripts/build_draft_data.py).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ season: string }> }
) {
  try {
    const { season } = await params;
    const { leagueId: baseLeagueId, baseUrl, maxWeeks } = SLEEPER_CONFIG;
    const leagues = await buildLeagueChain(baseUrl, baseLeagueId);
    const league = leagues.find((l) => l.season === season);

    if (!league || !league.draft_id) {
      return NextResponse.json({ error: `No draft found for season ${season}` }, { status: 404 });
    }

    const lastScoredWeek = Math.min(league.settings?.last_scored_leg ?? 0, maxWeeks);
    const getDraft = unstable_cache(
      () => buildLiveDraft(baseUrl, league.league_id, league.draft_id!, season, lastScoredWeek),
      ['draft', league.league_id, league.draft_id, String(lastScoredWeek)],
      { revalidate: CACHE_CONFIG.draftData }
    );

    return NextResponse.json(await getDraft());
  } catch (error) {
    console.error('Error building draft data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch draft data from Sleeper API' },
      { status: 500 }
    );
  }
}
