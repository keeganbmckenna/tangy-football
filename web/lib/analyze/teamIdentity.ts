import { LeagueData, SleeperUser } from '../types';

/**
 * Gets the best avatar URL for a user
 * Prioritizes metadata.avatar (full URL) over avatar ID
 *
 * @param user - Sleeper user object
 * @returns Avatar URL or null if no avatar available
 */
export function getAvatarUrl(user: SleeperUser | undefined): string | null {
  if (!user) return null;

  // Prefer full URL from metadata
  if (user.metadata?.avatar) {
    return user.metadata.avatar;
  }

  // Fall back to avatar ID
  if (user.avatar) {
    return `https://sleepercdn.com/avatars/thumbs/${user.avatar}`;
  }

  return null;
}

/** A roster's team photo (its manager's avatar), or null */
export function teamAvatarUrl(data: LeagueData | null | undefined, rosterId: number): string | null {
  const userId = data?.rosterToUserMap[rosterId];
  return userId ? getAvatarUrl(data.userMap[userId]) : null;
}

/**
 * Gets custom team name from metadata or falls back to display name
 *
 * @param user - Sleeper user object
 * @param fallback - Fallback name if no custom name found
 * @returns Custom team name or fallback
 */
export function getCustomTeamName(user: SleeperUser | undefined, fallback: string): string {
  if (!user) return fallback;
  return user.metadata?.team_name || user.display_name || fallback;
}

/**
 * Retrieves the display name and username for a team by roster ID
 *
 * @param rosterId - The Sleeper roster ID
 * @param data - Complete league data including user mappings
 * @returns Object containing the team's display name and username
 *
 * @example
 * ```ts
 * const { name, username } = getTeamName(1, leagueData);
 * // { name: "John's Team", username: "john123" }
 * ```
 */
export function getTeamName(
  rosterId: number,
  data: LeagueData
): { name: string; username: string } {
  const userId = data.rosterToUserMap[rosterId];
  const fallbackName = `Team ${rosterId}`;
  if (userId) {
    const user = data.userMap[userId];
    const managerName = user?.username || user?.display_name || fallbackName;
    const teamName = getCustomTeamName(user, user?.display_name || managerName);
    return {
      name: teamName,
      username: managerName,
    };
  }
  return { name: fallbackName, username: fallbackName };
}
