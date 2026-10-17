# Tangy Football - Feature Tour

Everything the site does, tab by tab, in plain language. [README.md](README.md) has the technical details (how the odds model works, what each number means, caching, and how to run it).

The **Season** picker in the header switches every tab between seasons:
- **2022 onward:** everything comes from Sleeper.
- **2017-2021:** before Sleeper, so only the final standings and the History tab are available.

The **You** picker highlights your team everywhere (✕ clears it).

---

## 📊 Overview
- **Data through:** a line saying which weeks the stats cover ("Stats through week 5 of 14").
- **Division standings:** one card per division with record, points, games back (GB) and points back (PB); the leader gets a 🥇.
- **Wild Card Race:** the non-division leaders ranked for the remaining playoff spots, with the playoff cutoff line and each team's division.
- **Weekly Matchups:** every result for any completed week.

For a season before Sleeper, Overview shows that season's final standings and top three.

## 🔴 Live (current season, while a week is being played)
Refreshes every minute.
- **Live Play-All:** each team's record against every other team at the current scores, its real matchup and margin, and its season play-all record if the week ended now.
- **Live Standings:** the standings if the week ended now, each record shown before → now, with teams moving into or dropping out of a playoff spot flagged.

## 🏆 Playoffs
While the regular season is in progress:
- **If the Season Ended Now:** the projected playoff bracket and the first teams out.
- **Playoff Odds:** 20,000 simulations of the real remaining schedule. Shows each team's chances of:
  - the playoffs, the division and a bye;
  - the title;
  - losing the toilet bowl.

  Also shows how this week's win or loss changes them.
- **Toilet Bowl If the Season Ended Now:** the projected toilet bowl bracket.
- **What Each Team Needs:** each team's odds now, with a win and with a loss. Also clinched and eliminated, win-and-in scenarios in the last weeks, points races, and the team's biggest rooting interest this week.

After the regular season, and for past seasons: the **Playoff Bracket** (with placement games) and the **Toilet Bowl** bracket.

## 📈 Weekly Performance
- **Weekly Scores:** every score, colored by win or loss, with the margin, season average, and average score and margin in wins and in losses.
- **Weekly Rankings Heatmap:** each team's scoring rank each week, with average and median rank.

## 📉 Season Trends
Line charts. Hover (or tap) a week for every team's value, or a team in the legend to highlight its line; your team's line is drawn thicker.
- Standings Over Time.
- Cumulative Scores.
- Difference from Median: points above or below the weekly median, added up.

## 🔬 Advanced Stats
- **Play Everyone Analysis:** each team's record if it had played every team every week, against its real record, with a luck factor.
- **Schedule Luck Distribution:** 20,000 random schedules per team, showing the range of records it could have had.
- **Weekly Play-All:** week-by-week play-all records as a heatmap, with each week's real result.

## 📋 Draft
- **Draft Board:** by round for snake drafts, by team and price for auctions.
- **Draft Core:** each team's intended starters.
- **Draft Results:** grades by points per available week, spending, $ per point and best pick.

## 🔄 Trades & Waivers (current season, while the regular season is in progress)
- **Trade Analyzer:** pick two managers and the players moving. Shows:
  - each team's win odds for every remaining week, with and without the trade;
  - season odds before → after;
  - lineup changes and forced roster moves;
  - each player's FantasyCalc market value;
  - which other teams' odds move.
- **Trade Finder:** pick your team and it searches 1-for-1 up to 3-for-2 trades with every manager. It keeps the ones that help you without hurting the other manager, optionally only market-fair ones, each with an "Open in analyzer" button.
- **Waiver Finder:** the free agents who would help you most, for the rest of the season or for one specific week (to cover a bye), each with the player it would drop.

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
- **Smooth tab switches:** tabs crossfade instead of jumping.
- **Easter egg:** tap the league logo. 🥅
- **Light and dark themes:** follows your device by default; dark mode is true black.
- **Loading and errors:** a tumbling football while things load, and a **Try again** button if something fails.
