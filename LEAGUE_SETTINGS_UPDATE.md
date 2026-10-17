# League Settings

How the site reads the league's structure (season length, playoff size, divisions, toilet bowl) from Sleeper instead of hard-coding it, so a change in the Sleeper league settings shows up on the site without a code change.

## Where it's computed

`web/lib/leagueSettings.ts` → `getLeagueSettings(league)` turns the Sleeper league object (`/v1/league/{id}`) into a `LeagueSettings` object (`web/lib/types.ts`):

| Field | From Sleeper | Default if missing |
|---|---|---|
| `regularSeasonStart` | `settings.start_week` | 1 |
| `regularSeasonEnd` | `settings.playoff_week_start - 1` | 14 |
| `playoffStart` | `settings.playoff_week_start` | 15 |
| `totalTeams` | `settings.num_teams` | 12 |
| `playoffTeams` | `settings.playoff_teams` | 6 |
| `divisions` | `settings.divisions` | 0 |
| `hasToiletBowl` | `loser_bracket_id` is set | false |
| `playoffDescription`, `toiletBowlDescription` | Built from the above (e.g. "6-team single elimination bracket. Top 3 division winners get first-round byes, 3 wild card teams compete.") | |

The current league has 12 teams in 3 divisions, a 14-week regular season, a 6-team playoff starting in week 15, and a 6-team toilet bowl.

## Where it's used

`web/app/page.tsx` computes it for the selected season and uses:

- **`regularSeasonEnd`**
  - caps the weekly analytics (Weekly Performance, Season Trends, Advanced Stats) at completed regular-season weeks;
  - decides whether the regular season is in progress, which switches the Playoffs tab between the playoff picture and the brackets and shows or hides Trades & Waivers;
  - sets the Live tab's last week;
  - drives Overview's "Stats through week X of 14" line.
- **`playoffTeams`** and **`divisions`**: division standings, the wild card race and its cutoff line, and the overall standings when there are no divisions.
- **`hasToiletBowl`**: whether the Playoffs tab shows the toilet bowl bracket for a finished season.
- **`regularSeasonEnd`, `playoffStart` and `playoffTeams`**: `web/lib/analyze/brackets.ts` (`buildPostseasonBrackets`) places each playoff round in its weeks and numbers the placement games.

The playoff odds, trade analyzer, waiver finder and history don't use `getLeagueSettings`. They run on the server and read the same Sleeper fields directly:
- `web/lib/oddsData.ts` (`playoffFormat`, `loadOddsInputs`) reads `playoff_week_start`, `playoff_teams` and `divisions`, and counts the toilet bowl as on if this season or last season had one, since Sleeper only creates the bracket once the playoffs start.
- `web/lib/historyData.ts` reads `playoff_week_start` and each season's brackets.

## Not currently used

- **`playoffDescription` / `toiletBowlDescription`:** these were shown by a `LeagueInfo` card at the top of Overview, which was removed. They're still computed.
- **`getRegularSeasonWeeks`, `isRegularSeasonWeek` and `isPlayoffWeek`:** these helpers in the same file have no callers.

## Assumptions

- **Seeding:** division winners are seeded first, then wild cards. Ties on record go to points for.
- **Byes:** the top 2 seeds get first-round byes. This is the bracket shape this league uses, and it's assumed rather than read from Sleeper (`playoffFormat` sets `byes: 2`).
- **Toilet bowl:** the lower score advances, so the final's "winner" in Sleeper's losers bracket is the team that loses the toilet bowl.
