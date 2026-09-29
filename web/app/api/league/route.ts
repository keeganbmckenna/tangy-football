import { NextRequest, NextResponse } from 'next/server';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import { buildLeagueChain } from '@/lib/sleeper';
import type { SleeperUser, SleeperRoster, SleeperMatchup, SleeperBracketMatchup } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { leagueId: baseLeagueId, baseUrl, maxWeeks } = SLEEPER_CONFIG;
    const seasonParam = request.nextUrl.searchParams.get('season');
    const leagues = await buildLeagueChain(baseUrl, baseLeagueId);
    const availableSeasons = Array.from(new Set(leagues.map((league) => league.season)));
    const targetLeague = seasonParam
      ? leagues.find((league) => league.season === seasonParam)
      : leagues[0];

    if (!targetLeague) {
      return NextResponse.json(
        { error: `Season ${seasonParam} not found` },
        { status: 404 }
      );
    }

    const targetLeagueId = targetLeague.league_id;

    // Get current week or default to max configured weeks
    const currentWeek = targetLeague.settings?.leg || maxWeeks;
    const lastScoredWeek = targetLeague.settings?.last_scored_leg || currentWeek;

    // Fetch all data in parallel with configured cache
    const isPlayoffs = (targetLeague.settings?.playoff_week_start ?? Infinity) <= currentWeek;
    const isLiveWeek = currentWeek > lastScoredWeek;
    const bracketRevalidate = (isPlayoffs && isLiveWeek)
      ? CACHE_CONFIG.currentWeek
      : CACHE_CONFIG.completedWeek;

    const winnersBracketPromise = targetLeague.bracket_id
      ? fetch(`${baseUrl}/league/${targetLeagueId}/winners_bracket`, {
        next: { revalidate: bracketRevalidate },
      }).then(res => (res.ok ? res.json() as Promise<SleeperBracketMatchup[]> : null))
      : Promise.resolve(null);

    const losersBracketPromise = targetLeague.loser_bracket_id
      ? fetch(`${baseUrl}/league/${targetLeagueId}/losers_bracket`, {
        next: { revalidate: bracketRevalidate },
      }).then(res => (res.ok ? res.json() as Promise<SleeperBracketMatchup[]> : null))
      : Promise.resolve(null);

    const [usersRes, rostersRes, winnersBracket, losersBracket] = await Promise.all([
      fetch(`${baseUrl}/league/${targetLeagueId}/users`, { next: { revalidate: CACHE_CONFIG.leagueData } }),
      fetch(`${baseUrl}/league/${targetLeagueId}/rosters`, { next: { revalidate: CACHE_CONFIG.leagueData } }),
      winnersBracketPromise,
      losersBracketPromise,
    ]);

    const users: SleeperUser[] = await usersRes.json();
    const rosters: SleeperRoster[] = await rostersRes.json();

    // Fetch matchups for all weeks
    const matchupPromises = [];
    for (let week = 1; week <= Math.min(currentWeek, maxWeeks); week++) {
      // Don't cache the current week's matchups - update in near real-time
      // Cache completed weeks for one day
      const isCurrentWeek = week === currentWeek && week > lastScoredWeek;
      matchupPromises.push(
        fetch(`${baseUrl}/league/${targetLeagueId}/matchups/${week}`, {
          next: { revalidate: isCurrentWeek ? CACHE_CONFIG.currentWeek : CACHE_CONFIG.completedWeek }
        }).then(res => res.json())
      );
    }
    const matchupsArray = await Promise.all(matchupPromises);

    // Create user map
    const userMap = users.reduce((acc: Record<string, SleeperUser>, user) => {
      acc[user.user_id] = user;
      return acc;
    }, {});

    // Create roster to user map
    const rosterToUserMap = rosters.reduce((acc: Record<number, string>, roster) => {
      acc[roster.roster_id] = roster.owner_id;
      return acc;
    }, {});

    // Process matchups by week
    const matchupsByWeek: Record<number, SleeperMatchup[]> = {};
    matchupsArray.forEach((matchups, index) => {
      matchupsByWeek[index + 1] = matchups;
    });

    // Build division names from league metadata
    const divisionNames: Record<number, string> = {};
    if (targetLeague.metadata) {
      if (targetLeague.metadata.division_1) divisionNames[1] = targetLeague.metadata.division_1;
      if (targetLeague.metadata.division_2) divisionNames[2] = targetLeague.metadata.division_2;
      if (targetLeague.metadata.division_3) divisionNames[3] = targetLeague.metadata.division_3;
    }

    return NextResponse.json({
      league: targetLeague,
      users,
      rosters,
      matchups: matchupsByWeek,
      userMap,
      rosterToUserMap,
      lastScoredWeek,
      availableSeasons,
      divisionNames,
      winnersBracket,
      losersBracket,
    });
  } catch (error) {
    console.error('Error fetching league data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch league data' },
      { status: 500 }
    );
  }
}
