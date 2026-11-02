import { CACHE_CONFIG, SLEEPER_CONFIG } from '@/lib/config';
import { fetchJson } from '@/lib/oddsData';
import { getCustomTeamName } from '@/lib/analyze/teamIdentity';
import { leagueImage } from '@/lib/shareImage';
import type { SleeperLeague, SleeperRoster, SleeperUser } from '@/lib/types';

/** Teams shown on the league's card */
const TOP = 6;

/** The league's preview picture (a plain link to the site): its photo, the week and the standings' top */
export async function GET() {
  const { baseUrl, leagueId } = SLEEPER_CONFIG;
  const [league, users, rosters] = await Promise.all([
    fetchJson<SleeperLeague>(`${baseUrl}/league/${leagueId}`, CACHE_CONFIG.leagueData),
    fetchJson<SleeperUser[]>(`${baseUrl}/league/${leagueId}/users`, CACHE_CONFIG.leagueData),
    fetchJson<SleeperRoster[]>(`${baseUrl}/league/${leagueId}/rosters`, CACHE_CONFIG.leagueData),
  ]);
  const userById = new Map(users.map((u) => [u.user_id, u]));
  const points = (r: SleeperRoster) => r.settings.fpts + (r.settings.fpts_decimal ?? 0) / 100;
  const top = [...rosters]
    .sort((a, b) => b.settings.wins - a.settings.wins || points(b) - points(a))
    .slice(0, TOP)
    .map((r) => {
      const u = userById.get(r.owner_id);
      return { name: getCustomTeamName(u, u?.display_name ?? `Team ${r.roster_id}`).trim(), record: `${r.settings.wins}-${r.settings.losses}`, points: points(r) };
    });
  const scored = league.settings?.last_scored_leg ?? 0;
  const week = league.status === 'complete' ? 'Final standings' : scored > 0 ? `Through week ${scored}` : 'Before kickoff';
  return leagueImage({ name: league.name, season: league.season, week, avatarUrl: league.avatar ? `https://sleepercdn.com/avatars/${league.avatar}` : null }, top);
}
