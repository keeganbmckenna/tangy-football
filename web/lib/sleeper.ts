/**
 * Shared Sleeper API fetch helpers for server routes
 */

import { CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague } from '@/lib/types';

export const fetchLeague = async (baseUrl: string, leagueId: string) => {
  const response = await fetch(`${baseUrl}/league/${leagueId}`, {
    next: { revalidate: CACHE_CONFIG.leagueData },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch league ${leagueId}`);
  }

  return response.json() as Promise<SleeperLeague>;
};

/**
 * Walks previous_league_id links from the current league back through past
 * seasons. Newest season first.
 */
export const buildLeagueChain = async (baseUrl: string, leagueId: string) => {
  const leagues: SleeperLeague[] = [];
  const visited = new Set<string>();
  let currentLeagueId: string | null | undefined = leagueId;

  while (currentLeagueId && !visited.has(currentLeagueId)) {
    visited.add(currentLeagueId);
    const league = await fetchLeague(baseUrl, currentLeagueId);
    leagues.push(league);
    currentLeagueId = league.previous_league_id;
  }

  return leagues;
};
