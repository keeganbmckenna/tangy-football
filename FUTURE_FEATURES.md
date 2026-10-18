# Future Features

Ideas not built yet, grouped by theme. What's already built is described in [FEATURES.md](FEATURES.md) and [README.md](README.md).

## Lineups and roster moves

These use data the app already downloads from Sleeper, so they need no new requests.

- **Lineup efficiency** - Points scored vs. the best possible lineup each week, and points left on the bench over the season. Sleeper reports each team's max possible points (`ppts` on rosters) and every starter's points (`starters_points` on matchups).
- **Waiver and FAAB history** - Every claim with its bid, including losing bids, FAAB spent and left, biggest overpays, and how each pickup scored for its new team. Sleeper's transactions include every bid, and rosters carry FAAB spent and total moves.
- **Player leaderboards** - Top scorers overall and by position, best single-week performances, and each team's MVP.
- **Roster makeup** - Where each team's points come from by position, compared with the league.

## Teams and matchups

- **This week's matchups** - Win odds for every game this week. The playoff odds model already computes them; they're only shown in the trade analyzer today.
- **Projected final standings** - Each team's expected final record from the same simulations as the playoff odds.
- **Strength of schedule ahead** - How tough each team's remaining opponents are. Past schedule luck is already covered in Advanced Stats.
- **Power rankings** - A ranking from recent and season-long scoring, next to the real standings, with week-over-week movement.
- **Consistency** - How steady each team's scoring is: spread of weekly scores, floor and ceiling, boom and bust weeks.
- **Record vs. good and bad teams** - Record against playoff and non-playoff teams, and in close games.
- **Hot and cold streaks** - Current win/loss streaks and recent scoring form. Sleeper includes each team's streak.
- **Alternative standings** - Standings if everyone also played the weekly median, or if they were ranked on points alone.

## Fun

- **Weekly awards** - Automatic superlatives each week: high score, biggest blowout, closest game, worst loss with a big score, best bench.
- **Championship belt** - The belt passes to whoever beats the holder; track its history across the season.
- **Milestones** - Career and season marks as they happen: wins, points, titles.

## Bigger projects

- **Team pages** - One page per team with its season, roster, schedule, trades and history.
- **Team comparison** - Two teams side by side, and their head-to-head history.
- **Playoff "what if"** - Pick the winners of the remaining games and see the resulting standings and seeds.
