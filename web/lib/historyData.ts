/**
 * Server-side league history: every season in the league's chain, with each
 * game's managers, scores and kind (regular season, playoff, placement,
 * consolation, toilet bowl) and each season's postseason results, plus the
 * seasons before Sleeper (standings and top three only).
 */

import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import { buildLeagueChain } from '@/lib/sleeper';
import { fetchJson } from '@/lib/oddsData';
import { getAvatarUrl, getTeamName } from '@/lib/analyze/teamIdentity';
import { bracketResults, postseasonKind, type HistoryData, type HistoryGame, type HistorySeason } from '@/lib/analyze/history';
import { LEGACY_SEASONS, MANAGER_FIRST_NAMES } from '@/lib/data/legacyHistory';
import type { LeagueData, SleeperBracketMatchup, SleeperLeague, SleeperMatchup, SleeperRoster, SleeperUser } from '@/lib/types';

async function seasonHistory(league: SleeperLeague) {
  const { baseUrl } = SLEEPER_CONFIG;
  const id = league.league_id;
  const settings = league.settings ?? {};
  const complete = league.status === 'complete';
  const playoffWeekStart = settings.playoff_week_start ?? 15;
  const lastScored = settings.last_scored_leg ?? 0;
  // Every scored week, through the last playoff week
  const lastWeek = complete ? playoffWeekStart + 2 : Math.min(lastScored, playoffWeekStart + 2);
  const cache = complete ? CACHE_CONFIG.completedWeek : CACHE_CONFIG.leagueData;
  const bracket = (path: string, present: boolean | null | undefined) =>
    present ? fetchJson<SleeperBracketMatchup[]>(`${baseUrl}/league/${id}/${path}`, cache).catch(() => null) : Promise.resolve(null);

  const [users, rosters, winners, losers, weeks] = await Promise.all([
    fetchJson<SleeperUser[]>(`${baseUrl}/league/${id}/users`, cache),
    fetchJson<SleeperRoster[]>(`${baseUrl}/league/${id}/rosters`, cache),
    bracket('winners_bracket', !!league.bracket_id),
    bracket('losers_bracket', !!league.loser_bracket_id),
    Promise.all(
      Array.from({ length: Math.max(lastWeek, 0) }, (_, i) =>
        fetchJson<SleeperMatchup[]>(`${baseUrl}/league/${id}/matchups/${i + 1}`, i + 1 <= lastScored ? CACHE_CONFIG.completedWeek : cache)
      )
    ),
  ]);

  // Team names and photos the same way the rest of the site shows them
  const data = {
    users,
    rosters,
    userMap: Object.fromEntries(users.map((u) => [u.user_id, u])),
    rosterToUserMap: Object.fromEntries(rosters.map((r) => [r.roster_id, r.owner_id])),
  } as unknown as LeagueData;
  const owner = new Map(rosters.filter((r) => r.owner_id).map((r) => [r.roster_id, r.owner_id]));

  const games: HistoryGame[] = [];
  weeks.forEach((matchups, i) => {
    const week = i + 1;
    const pairs = new Map<number, SleeperMatchup[]>();
    for (const m of matchups) {
      if (m.matchup_id == null) continue;
      pairs.set(m.matchup_id, [...(pairs.get(m.matchup_id) ?? []), m]);
    }
    for (const [x, y] of pairs.values()) {
      if (!x || !y || !owner.has(x.roster_id) || !owner.has(y.roster_id)) continue;
      // Unplayed weeks come back with zero points for everyone
      if ((x.points ?? 0) === 0 && (y.points ?? 0) === 0) continue;
      const kind = week < playoffWeekStart ? 'regular' : postseasonKind(week - playoffWeekStart + 1, [x.roster_id, y.roster_id], winners, losers);
      games.push({ season: league.season, week, a: owner.get(x.roster_id)!, b: owner.get(y.roster_id)!, pa: x.points ?? 0, pb: y.points ?? 0, kind });
    }
  });

  const results = bracketResults(winners, losers);
  const byRoster = (r: number | null) => (r === null ? null : owner.get(r) ?? null);
  const season: HistorySeason = {
    season: league.season,
    complete,
    teams: rosters
      .filter((r) => r.owner_id)
      .map((r) => ({
        userId: r.owner_id,
        rosterId: r.roster_id,
        teamName: getTeamName(r.roster_id, data).name,
        avatarUrl: getAvatarUrl(data.userMap[r.owner_id]),
      })),
    champion: complete ? byRoster(results.champion) : null,
    runnerUp: complete ? byRoster(results.runnerUp) : null,
    toiletLoser: complete ? byRoster(results.toiletLoser) : null,
    playoffTeams: results.playoffTeams.map(byRoster).filter((u): u is string => !!u),
    placements: complete
      ? Object.fromEntries(Object.entries(results.placements).map(([r, p]) => [byRoster(Number(r)), p]).filter(([u]) => u))
      : {},
  };
  return { season, games, users };
}

export async function buildHistory(): Promise<HistoryData> {
  const { baseUrl, leagueId } = SLEEPER_CONFIG;
  const leagues = await buildLeagueChain(baseUrl, leagueId);
  const seasons = await Promise.all(leagues.map(seasonHistory));
  // Each manager under their newest name and photo
  const managers = new Map<string, { userId: string; name: string; avatarUrl: string | null }>();
  for (const s of seasons) {
    for (const u of s.users) {
      if (managers.has(u.user_id)) continue;
      const team = s.season.teams.find((t) => t.userId === u.user_id);
      managers.set(u.user_id, { userId: u.user_id, name: u.display_name || u.username || 'Unknown', avatarUrl: team?.avatarUrl ?? getAvatarUrl(u) });
    }
  }
  // Seasons before Sleeper, matched to Sleeper managers by display name
  const byName = new Map([...managers.values()].map((m) => [m.name.toLowerCase(), m.userId]));
  const ownerId = (owner: string) => {
    const id = byName.get(owner.toLowerCase());
    if (id) return id;
    const legacyId = `legacy:${owner.toLowerCase()}`;
    if (!managers.has(legacyId)) managers.set(legacyId, { userId: legacyId, name: owner, avatarUrl: null });
    return legacyId;
  };
  const legacy: HistorySeason[] = LEGACY_SEASONS.map((ls) => {
    const finisher = (place: number) => {
      const team = ls.teams.find((t) => t.finish === place);
      return team ? ownerId(team.owner) : null;
    };
    return {
      season: ls.season,
      complete: true,
      legacy: true,
      teams: ls.teams.map((t) => ({ userId: ownerId(t.owner), rosterId: 0, teamName: t.teamName, avatarUrl: null })),
      standings: ls.teams.map((t) => ({ userId: ownerId(t.owner), wins: t.wins, losses: t.losses, rank: t.rank })),
      champion: finisher(1),
      runnerUp: finisher(2),
      thirdPlace: finisher(3),
      toiletLoser: null,
      playoffTeams: [],
      placements: Object.fromEntries(ls.teams.filter((t) => t.finish).map((t) => [ownerId(t.owner), t.finish!])),
    };
  });

  const firstNames = new Map(Object.entries(MANAGER_FIRST_NAMES).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    managers: [...managers.values()].map((m) => ({ ...m, firstName: firstNames.get(m.name.toLowerCase()) ?? null })),
    seasons: [...seasons.map((s) => s.season), ...legacy].sort((a, b) => Number(b.season) - Number(a.season)),
    games: seasons.flatMap((s) => s.games),
    generatedAt: new Date().toISOString(),
  };
}
