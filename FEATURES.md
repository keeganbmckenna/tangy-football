# Tangy Football - Feature Tour

Everything the site does, tab by tab, in plain language. [README.md](README.md) has the technical details (what each number means, caching, and how to run it), and [docs/odds-models.md](docs/odds-models.md) explains how the odds are computed.

The **Season** picker in the header switches every tab between seasons:
- **2022 onward:** everything comes from Sleeper.
- **2017-2021:** before Sleeper, so only the final standings and the History tab are available.

The **You** picker highlights your team everywhere and puts your matchup first, with you on the left, in Overview and Live (✕ clears it).

---

## 📊 Overview
- **Season in Review** (finished seasons): one manager at a time, defaulting to you. Finish, record and points rank, best and worst week, MVP, best pickup, best trade by net points, lineup efficiency, luck and close games, and a sparkline of their playoff odds from the draft on.
- **Data through:** a line saying which weeks the stats cover ("Stats through week 5 of 14").
- **Division standings:** one card per division with record, points, games back (GB) and points back (PB); the leader gets a 🥇.
- **Wild Card Race:** the non-division leaders ranked for the remaining playoff spots, with the playoff cutoff line and each team's division.
- **Weekly Matchups** comes before Power Rankings. During a week that's being played, it opens on that week (marked with a red dot): the Live tab's matchups with live scores and win odds, each opening the same live lineups.
- **Power Rankings** (during the regular season): teams ranked by the playoff-odds model's expected weekly score, each with the range its rank lands in 80% of the time and its move since last week.
- **Weekly Matchups:** every result for any completed week. Tap one to see both lineups and benches, with each player's points, box score line (like 26/34, 374 yd, 4 TD) and his projection from before the game.
  - **Awards:** a strip of the week's awards above the results: high and low score, biggest blowout, closest game, unluckiest loss, luckiest win, most left on the bench, biggest upset (by projections) and who beat their projections most.
  - **How it swung:** each matchup's win odds through the week, replayed play by play on each NFL game's real clock with the Live tab's model, with the lead changes counted; or switch to both teams' scores through the week, with how long each led (every week since 2022). Lines mark each matchup's 8 biggest plays (6+ points to one side's starters, or a 10%+ swing in the odds); tap one for the play, who it helped and how the odds moved. A play by starters on both sides shows once, with each side's points. During the week the lines come from the live saves (with any score that's taken back, like a touchdown called back by a flag, dropped) until the play-by-play replay replaces them.

For a season before Sleeper, Overview shows that season's final standings and top three.

## 🔴 Live (current season, while a week is being played)
Updates every 10 seconds while NFL games are on; scores flash green (or red) with the change when they move.
- **Matchups:** every real matchup's live score, projected final and win odds, which update as the games play out. They count injuries, overtime, and how boom-or-bust each starter is. Tap one for both lineups and benches, player by player, with each player's box score so far and a "How it swung" chart of the win odds so far; players in a game are tinted green and those still to play show a dash. While a player's game is on, his row also shows the down and distance and where the ball is on the field, and whether his team is on offense or defense. A defense shows the down and distance while it's defending (the marker turns red inside its own 20) or "On the sideline" while its offense has the ball, and its points allowed say what they're worth and where the next bracket starts ("17 PA: 1 pt, 0 at 21").
- **Live Standings:** the standings if the week ended now, each record shown before → now, with teams moving into or dropping out of a playoff spot flagged.
- **Live Play-All:** each team's record against every other team at the current scores, its real matchup and margin, and its season play-all record if the week ended now.

## 🏆 Playoffs
While the regular season is in progress:
- **If the Season Ended Now:** the projected playoff bracket and the first teams out.
- **Playoff Odds:** 20,000 simulations of the real remaining schedule. Shows each team's chances of:
  - the playoffs, the division and a bye;
  - the title;
  - losing the toilet bowl.

  Also shows how this week's win or loss changes them.
- **Toilet Bowl If the Season Ended Now:** the projected toilet bowl bracket.
- **Games Ahead:** a team's chance of winning each remaining game, with its expected wins (One team), or every team's as a grid, easiest remaining schedule first (All teams).
- **What Each Team Needs:** each team's odds now, with a win and with a loss. Also clinched and eliminated, win-and-in scenarios in the last weeks, points races, and the team's biggest rooting interest this week.
- **Odds Week by Week:** a chart of how every team's odds moved from the draft to now. Pick what to follow: making the playoffs, a bye, the division, the title, a toilet bowl bye or losing the toilet bowl. Each point is what the model would have said at the time. Finished seasons show it too.
- **What If:** pick winners of any remaining games and see everyone's playoff, bye and division odds with those results fixed, against the same simulation without the picks.

After the regular season, and for past seasons: the **Playoff Bracket** (with placement games) and the **Toilet Bowl** bracket. Tap a game that's been played to see both lineups.

## 📈 Stats
Weekly scores and ranks, how the season moved, and luck. Charts: hover (or tap) a week for every team's value, or a team in the legend to highlight its line; your team's line is drawn thicker.
- **Weekly Scores:** every score, colored by win or loss, with the margin, season average, and average score and margin in wins and in losses. The last two rows are the league's median winning and losing score each week and for the season.
- **Weekly Ranks:** each team's scoring rank each week, with that week's play-all record (its record had it played every other team) and a dot for its real result; average and median rank, and its season play-all record.
- **Score Distribution:** every team's weekly scores as dots on one line, with its middle half shaded and its median marked, then spread, floor, ceiling, and boom and bust weeks.
- **Rank over time:** the standings week by week, or (toggle) the power rankings by the playoff-odds model from the draft on.
- **Points over time:** cumulative scores, or (toggle) points above or below the weekly median, added up.
- **Luck:** real record, play-all record and the wins each team's scoring deserved; luck is the difference. Plus its record in close games.
- **Schedule Luck Distribution:** 20,000 random schedules per team, showing the range of records it could have had.

## 🧩 Rosters (2022 onward)
During the current regular season, the trade and waiver tools come first:
- **Trade Analyzer:** pick two managers and the players moving. Shows:
  - each team's win odds for every remaining week, with and without the trade;
  - season odds before → after;
  - lineup changes and forced roster moves;
  - each player's FantasyCalc market value;
  - which other teams' odds move.
- **Trade Finder:** pick your team and it searches 1-for-1 up to 3-for-2 trades with every manager. It keeps the ones that help you without hurting the other manager, optionally only market-fair ones, each with an "Open in analyzer" button.
- **Waiver Finder:** the free agents who would help you most, for the rest of the season or for one specific week (to cover a bye), each with the player it would drop.

Then, for any season:
- **Lineup Efficiency:** points scored against the best lineup each team could have started, points left on the bench, perfect weeks, and losses the best lineup would have won. Tap a team for its costliest week and the start/sit calls behind it.
- **Versus Projections:** each team's starters against Sleeper's pregame projections as a running total, and its players who beat or missed them most.
- **Points by Position:** where each team's starting-lineup points come from, against the league average, and how much it leans on its top scorer.
- **Player Leaders:** top players and single games by points in fantasy starting lineups, by position, and each team's MVP.
- **Waivers:** each team's pickups and what they scored in its lineup, and the best pickups. In FAAB seasons (2024 on), FAAB spent, points per dollar, the costliest misses and the closest bids.

## 📋 Draft
- **Draft Board:** by round for snake drafts, by team and price for auctions.
- **Draft Core:** each team's intended starters.
- **Draft Results:** grades by points per available week, spending, $ per point and best pick.

## 🏛️ History (every season, whichever one is selected)
- **Champions:** every season's champion, runner-up and toilet bowl loser (top three before Sleeper).
- **All-Time Standings:** per manager:
  - seasons, record and win %;
  - points per game, playoff appearances and finals;
  - titles 🏆, toilet bowl losses 💩 and best finish.
- **Head to Head:** every manager's record against every other; tap a cell for every meeting.
- **Rivalries:** most played, most lopsided and closest series.

A switch counts the three sections above either with playoff and toilet bowl games or as the regular season only. Placement games (3rd, 5th place and the like) never count.
- **Trades:** every trade since the league moved to Sleeper, filterable by season.
  - **Graded two ways:** what it did to each team's odds at the time, and how the players it brought in actually scored.
  - **Trade stats:** per-manager stats, biggest swings and best hauls.
  - **Trade partners:** how many times each pair of managers traded; tap a cell for their trades.
  - **List:** the latest 5 trades, then **Show all**.
- **Record Book:** highest and lowest scores, blowouts, closest games, best and worst seasons, and more.

---

## Across the site
- **Sortable tables:** tap a column header to sort (best first, then reversed, then back to the default order, or use ↺ Default order).
- **Your team:** highlighted in every table and chart, and pre-selected in the trade and waiver tools.
- **Shareable links:** the address bar keeps the tab and season, so refresh, back and shared links land on the same view.
- **Definitions:** dotted-underlined terms (GB, PB, Core/wk, luck factor…) explain themselves on hover or tap.
- **Phones:**
  - the tab row scrolls sideways;
  - team names stay pinned as wide tables scroll;
  - tap a chart point for its details and tap again to close.
- **Home screen app:** add it to your phone's home screen for a football icon and a full-screen view.
- **Chalkboard background:** faint plays draw themselves behind the page, each at a new angle and slowly drifting; cards are slightly see-through so it shows faintly behind them.
- **Smooth tab switches:** tabs crossfade instead of jumping (in Safari, the new tab fades in). Charts build as they come into view, so a tab shows up straight away.
- **Home:** the league logo and name take you back to the current season's Overview.
- **Easter egg:** mash the league logo. 🥅
- **Light and dark themes:** follows your device by default; dark mode is true black.
- **Loading and errors:** a tumbling football while things load, and a **Try again** button if something fails.
