# Future Features

Ideas not built yet, grouped by theme. What's already built is described in [FEATURES.md](../FEATURES.md) and [README.md](../README.md).

## Teams and matchups

- **Projected final standings** - Each team's expected final record from the same simulations as the playoff odds.
- **Record vs. good and bad teams** - Record against playoff and non-playoff teams (close games are in the Luck Breakdown).
- **Hot and cold streaks** - Current win/loss streaks and recent scoring form. Sleeper includes each team's streak.
- **Alternative standings** - Standings if everyone also played the weekly median, or if they were ranked on points alone.

## Fun

- **Championship belt** - The belt passes to whoever beats the holder; track its history across the season.
- **Milestones** - Career and season marks as they happen: wins, points, titles.

## Bigger projects

- **Live win-probability chart** - The "How it swung" curve while games are on, not just after the week. Needs a small store (Upstash Redis on Vercel) that the server writes each matchup's odds to every few minutes during games.
- **Team pages** - One page per team with its season, roster, schedule, trades and history.
- **Team comparison** - Two teams side by side, and their head-to-head history.
