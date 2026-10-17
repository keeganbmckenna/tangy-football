# Fantasy Football 2026 - Tangy Football

A Next.js web app for analyzing a Sleeper fantasy football league: standings, live scoring views, playoff odds, weekly and season analytics, draft grades, trade and waiver tools, and graded trade history, across every season of the league's history.

## Features

The season picker in the header switches every tab between seasons; past seasons are found by following Sleeper's `previous_league_id` chain from the configured league. Seasons before Sleeper (2017-2021) are in the picker too, with only their final standings and the History tab. Weekly analytics only count completed regular-season weeks.

### Overview
- 🏆 **Division Standings** - One card per division with record, points, games back (GB), points back (PB) and the leader marked. Leagues without divisions get a single overall standings table with the playoff cutoff.
- 🎯 **Wild Card Race** - Non-division leaders ranked for the remaining playoff spots, with the cutoff line.
- 🏈 **Weekly Matchups** - Results for any completed week (week picker; defaults to the most recent).

Standings are ranked by wins (ties count as half a win), then points for.

### Live (current season only)
Shown only for the current season. It's active while a regular-season week is in progress, and refreshes every minute while the tab is visible.
- 🔴 **Live Play-All** - Each team's record against every other team at the current scores (equal scores are ties), colored by win rate, with a dot for whether the team is winning, losing or tied in its real matchup, the real margin, and season play-all counting this week as if it ended now.
- 📊 **Live Standings** - The Overview standings as if the week ended now: each record shown before → now, the live matchup dot, and teams moving into or dropping out of a playoff spot flagged. Equal scores, including 0-0, are ties, and ties count as half a win in the ranking.

### Playoffs
- 🔮 **Playoff Picture** - Shown instead of the brackets while the current season's regular season is in progress:
  - **If the Season Ended Now** - Seeds (division winners take the top seeds, then wild cards; ties on record go to points for) in the league's bracket: seeds 1-2 get byes, round 1 is 4 v 5 and 3 v 6, seed 1 plays the 4/5 winner and seed 2 the 3/6 winner. Plus the first teams out.
  - **Playoff Odds** - 20,000 simulations of the remaining schedule. Each team's weekly score centers on the strength of its current roster: each player is worth half his projection for that week (from Sleeper projections, so byes and injuries count) and half his points per game this season, and a team's expected score is the league average plus 75% of how far its best lineup of those values is from the league's. Shows playoff, division and bye odds, title odds (the playoff bracket is played out, higher score advancing), odds of losing the toilet bowl (played out too), and a this-week column showing how a win or loss changes whichever outcome is picked in its selector (playoffs, division, playoff bye, winning the league, toilet bowl bye or losing the toilet bowl).
  - **Toilet Bowl If the Season Ended Now** - The six non-playoff teams seeded worst record first (ties go to fewer points for) in the league's toilet bowl, where the lower score advances: seeds 1-2 get byes, round 1 is 4 v 5 and 3 v 6, and the final's loser loses the toilet bowl. Shown when this season or last season had a toilet bowl, since Sleeper only creates the bracket once the playoffs start.
  - **What Each Team Needs** - Each team's card has a this-week table: playoff, division, playoff bye, title, toilet bowl bye and losing-the-toilet-bowl odds now, with a win, and with a loss. Clinched and eliminated (playoffs and division) are exact. With 3 weeks or fewer left, every remaining result is checked for win-and-in, "comes down to points", and results that would clinch. Also shows points-for races at the playoff line and for division leads, and the team's biggest rooting interest this week.
- 🏆 **Playoff Bracket** - Round-by-round winners bracket with placement games (once the postseason starts, and for past seasons).
- 🚽 **Toilet Bowl** - Losers bracket, shown when the league has one.

### Weekly Performance
- 📈 **Weekly Scores** - Score per team per week, colored by win/loss, plus each team's season average and its average score and margin in wins and in losses.
- 🔥 **Weekly Rankings Heatmap** - Each team's weekly scoring rank (1-N).

### Season Trends
- 📉 **Standings Over Time** - Week-by-week standings position.
- 💯 **Cumulative Scores** - Running points total.
- 📊 **Difference from Median** - Cumulative points above or below the weekly median.

Hovering a team on these charts highlights it.

### Advanced Stats
- 🎲 **Play Everyone Analysis** - Each team's record if it played every other team every week, compared with its real record (expected wins and a luck factor). Ties count as half a win.
- 🎯 **Schedule Luck Distribution** - 20,000 randomized schedules showing the spread of possible win totals against the actual record.
- 📋 **Weekly Play-All** - Week-by-week play-all records as a heatmap, with each week's real result.

### Draft
- 📋 **Draft Board** - Snake drafts by round and team; auction drafts by team, sorted by price. Each pick shows points per available week (`/wk`: total half-PPR points divided by the weeks the player could have played, i.e. weeks scored minus byes, so missed games count as zeros) and the median over games played ("healthy").
- 🎯 **Draft Core** - Each team's intended starters for the season's lineup slots: the most expensive (auction) or earliest (snake) QB, RB, WR, TE and flex. Kickers and defenses aren't graded. Teams are ranked by Core/wk, the sum of those players' `/wk`.
- 📊 **Draft Results** - Core/wk, All picks/wk, auction spend, $ per Core/wk point, and best pick.

Draft data for completed seasons is pre-built JSON in `web/public/data/drafts/`. The season in progress is built live from Sleeper, falling back to its JSON file if that fails.

### Trades & Waivers
Shown only while the current regular season is in progress; past trades are under History.

- 🔄 **Trade Analyzer** (current season, until the trade deadline) - Pick two managers and the players each sends. Shows:
  - **Win odds each week** - a line chart of each team's chance to win each remaining game, without the trade (dashed) and with it (solid); hover for the opponent.
  - **Season outlook** - expected wins for the rest of the regular season, and playoff, division, playoff bye, title, toilet bowl bye and losing-the-toilet-bowl odds, before → after for both teams, from 20,000 simulated seasons run on the same random draws with and without the trade.
  - **Lineup changes** - each team's expected lineup before → after if nothing else changes, who enters and leaves next week's lineup, and forced roster moves (a full roster drops the player who costs the lineup least; an open spot picks up the free agent who helps it most).
  - **Players** - each player's points per game this season, expected points per remaining week (as the odds model values him) and [FantasyCalc](https://fantasycalc.com) redraft value (kickers and defenses aren't valued) and what each side gives and gets.
  - **Other teams affected** - teams whose odds move by a point or more.

  Players bring their projections and their season production with them, since team strength comes only from the current roster; two teams that swap whole rosters swap strengths (records already banked stay put). On the league's 2022-2025 trades this predicted the trading teams' playoff odds better than ignoring trades, giving trades less credit, or keeping season scoring with the team. Weekly win odds use a wider spread for games more than a week out, fitted on the same seasons. See `scripts/backtests/`.
- 🔎 **Trade Finder** (current season, until the trade deadline) - Pick your team and click **Find trades**. It tries 1-for-1, 1-for-2, 2-for-1, 2-for-2, 3-for-1, 1-for-3, 3-for-2 and 2-for-3 trades with every other manager, using each roster's 10 most valuable players (**Search deeper** uses every player; kickers, defenses and IR players stay put). Trades are screened on both teams' best lineups, the best few hundred re-scored week by week with the roster moves they force, and the top 20 simulated with the playoff model. It keeps trades that raise your playoff and title odds without hurting the other manager (their lineup, playoff and title odds don't drop and their odds of losing the toilet bowl don't rise), and shows up to 8, at most 2 per manager, each with an **Open in analyzer** button. The market filter (on by default) hides trades where the other manager gets back less than 85% of the FantasyCalc value they give, with a premium for the best player in the deal. Runs in the background; a few seconds for a quick search.
- 🧲 **Waiver Finder** (current season, while the regular season is in progress) - Pick your team and what to optimize for: **Rest of season**, or a single remaining week (each listed with your opponent and which of your starters are on bye). It checks the 15 best free agents at every position, kickers and defenses included; each pickup drops the player whose loss hurts your rest-of-season lineup least (IR players stay). Rest of season ranks pickups by how much they raise your playoff and title odds; a week ranks them by your win odds that week and still shows the season effect. The best dozen are simulated (5,000 seasons, same draws as without the move); up to 8 are shown, at most 3 per position. FAAB and waiver priority aren't modeled.
### History
Every season the league has played, whichever season is selected. Managers are tracked by their Sleeper account, so a roster changing hands doesn't mix two managers' records, and shown with their first names.

The seasons before Sleeper (2017-2021, a 10-team league) come from the old platform's final standings, kept in `web/lib/data/legacyHistory.ts`: team names, records, standings order and the top three. They count toward records, titles, finals and best finishes, and appear in the season dropdown with just an Overview of that final table. Head to head, points, playoff appearances, toilet bowls and game records start in 2022.
- 🏆 **Champions** - Each season's champion, runner-up and toilet bowl loser (💩), with that season's team names and photos; third place before Sleeper.
- 📋 **All-Time Standings** - Per manager: seasons, regular-season record and win % (ties count as half), points per game, playoff appearances, finals, titles, toilet bowl losses and best finish (1st-6th from the playoff bracket).
- ⚔️ **Head to Head** - Every manager's all-time record against every other, colored by win %; tap a cell for every meeting.
- 🔥 **Rivalries** - Most-played, most lopsided and closest series (4+ games for the last two).
- 🔁 **Trades** - Every trade since the league moved to Sleeper, newest first, with a season filter (All seasons, or one season):
  - **Traders** - per manager: trades made, favorite trade partner, the total change their trades made to their playoff and title odds at the time, and the starting-lineup points of the players they got.
  - **Biggest playoff odds gains and losses at the time**, and the **best hauls in hindsight** (most starting-lineup points from one trade).
  - **Every trade**, graded two ways:
    - **At the time:** playoff, title and losing-the-toilet-bowl odds without and with the trade, re-run the week it counted from with that week's records, rosters and projections (5,000 seasons each), plus the raw projected lineup change.
    - **Hindsight:** points the players each team got scored in its starting lineup afterward, and where the team finished.

  Trades that went through after a week's games count from the next week. Completed seasons are pre-built JSON in `web/public/data/trades/`; the season in progress is built live.
- 📖 **Record Book** - Highest and lowest scores, biggest blowouts, closest games, highest combined scores, most points in a loss, fewest in a win, and best, worst, highest- and lowest-scoring seasons.

Head-to-head records, rivalries and the record book count regular-season and playoff games; placement (3rd/5th place), consolation and toilet bowl games are left out.

### UI
- 🎨 **Theme Toggle** - Light, dark or system theme (defaults to system), saved in local storage.
- 🎯 **Custom Tooltips** - Sorted, scrollable tooltips for crowded charts.
- 📱 **Responsive Layout** - Pill tab bar on desktop and tablet, dropdown menu on phones.

## Project Structure

```
.
├── web/                          # Next.js web app
│   ├── app/
│   │   ├── api/
│   │   │   ├── league/           # League, users, rosters, matchups and brackets for a season
│   │   │   ├── live/             # Current week's matchups (Live tab)
│   │   │   ├── playoff-odds/     # Playoff picture, simulated odds and scenarios
│   │   │   ├── trade-data/       # Rosters, projections and market values for the trade analyzer
│   │   │   ├── trades/[season]/  # Graded trade history for a season
│   │   │   ├── history/          # Every season's games and postseason results (History tab)
│   │   │   └── draft/[season]/   # Draft data for the season in progress
│   │   ├── page.tsx              # Main page and tabs
│   │   ├── layout.tsx            # Layout and theme bootstrap
│   │   └── icon.tsx              # Favicon from the league avatar
│   ├── components/               # Tab sections (standings, charts, brackets, Live, playoff picture, draft, trades)
│   │   └── ui/                   # Shared pieces (cards, theme toggle, loading, error boundary)
│   ├── hooks/                    # Theme, chart hover and team color hooks
│   ├── lib/
│   │   ├── analyze/              # Analytics: stats, play-all, brackets, playoff odds, live, draft, trades, trade and waiver finders, history
│   │   ├── __tests__/            # Vitest tests
│   │   ├── config.ts             # League ID and cache durations
│   │   ├── sleeper.ts            # Shared Sleeper fetch helpers
│   │   ├── oddsData.ts           # Playoff-odds inputs shared by the odds and trade routes
│   │   ├── tradeHistory.ts       # Builds a season's graded trade history
│   │   ├── historyData.ts        # Builds the all-seasons history
│   │   ├── leagueSettings.ts
│   │   ├── constants.ts
│   │   ├── theme.ts
│   │   └── types.ts
│   └── public/data/              # Pre-built draft data and trade history per season
├── scripts/                      # Python data scripts
│   └── backtests/                # Backtests behind the playoff odds and trade analyzer
├── docs/                         # Research notes
├── FEATURES.md, FUTURE_FEATURES.md, LEAGUE_SETTINGS_UPDATE.md
└── pyproject.toml, uv.lock       # Python project (uv)
```

## Getting Started

### Web App

```bash
cd web
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Other commands (from `web/`):

| Command | What it does |
|---|---|
| `npm test` | Vitest in watch mode (`npx vitest run` runs once) |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm start` | Serve the production build |

### Python Scripts (optional)

Requires Python 3.13 and [uv](https://docs.astral.sh/uv/). Install dependencies (requests, pandas, openpyxl) from the repo root:

```bash
uv sync
```

Run the scripts from the repo root:

| Script | What it does |
|---|---|
| `uv run python scripts/fetch_data.py` | Fetches league info, users, rosters and matchups from week 1 to the current week into `league_data.json` |
| `uv run python scripts/analyze_data.py` | Reads `league_data.json` and writes `fantasy_analysis.xlsx` (Raw Scores, Raw Records, Scores, Standings sheets) |
| `uv run python scripts/build_draft_data.py [season ...]` | Rebuilds `web/public/data/drafts/{season}.json` from Sleeper (all of 2022-2026 if no season is given) |
| `uv run python scripts/build_trade_history.py [season ...] [--url URL]` | Rebuilds `web/public/data/trades/{season}.json` for completed seasons from a running app's `/api/trades/{season}` (default `http://localhost:3000`; all completed seasons if none given) |

The backtests in `scripts/backtests/` have their own README.

`league_data.json` and `fantasy_analysis.xlsx` are generated files and are gitignored. `scripts/main.py` is an unused placeholder.

The scripts don't read `NEXT_PUBLIC_LEAGUE_ID`. `fetch_data.py` has the current league ID hard-coded, and `build_draft_data.py` has a hard-coded season → league/draft ID table.

## Configuration

### League

The web app uses the `NEXT_PUBLIC_LEAGUE_ID` environment variable, falling back to the ID in `web/lib/config.ts`. Point it at the current season's league; earlier seasons are found automatically.

```bash
NEXT_PUBLIC_LEAGUE_ID=YOUR_LEAGUE_ID
```

### Caching

Sleeper data is fetched by the app's server routes and cached. Durations are set in `CACHE_CONFIG` in `web/lib/config.ts`:

| Data | Cached for |
|---|---|
| League, users and rosters | 5 minutes |
| Completed weeks' matchups | 1 day |
| Current week's matchups | Not cached |
| Live tab data | 30 seconds |
| Playoff odds | 30 minutes, rebuilt as soon as a new week is scored |
| Draft data for the season in progress | 1 hour, rebuilt as soon as a new week is scored |
| Trade analyzer rosters and projections | 10 minutes, rebuilt as soon as a new week is scored |
| FantasyCalc values | 6 hours |
| Trade history for the season in progress | 1 hour, rebuilt as soon as a new week is scored |
| League history (all seasons) | 5 minutes, rebuilt as soon as a new week is scored; completed seasons' Sleeper data 1 day |
| League avatar favicon | 1 hour |

## Deployment

The site is hosted on Netlify. There's no Netlify config file in the repo, so build settings live in the Netlify site settings. The app is in `web/`, so Netlify has to build from that directory (base directory `web`).

## Technologies

- **Next.js 15** (App Router) and **React 19**
- **TypeScript 5**
- **Tailwind CSS 4**
- **Recharts 3** for charts
- **Vitest 4** with Testing Library for tests
- **Sleeper API** (`api.sleeper.app/v1`) for leagues, users, rosters, matchups, transactions, brackets, drafts and weekly player stats (draft grades and the odds model's player values), plus weekly player projections and the NFL schedule from `api.sleeper.com` for playoff odds and trades. The `api.sleeper.com` endpoints aren't part of Sleeper's documented API.
- **FantasyCalc** (`api.fantasycalc.com`) for redraft trade values in the trade analyzer. Also undocumented; the analyzer works without it.
- **Python 3.13** with requests, pandas and openpyxl for the data scripts

## License

This repository doesn't include a license file.
