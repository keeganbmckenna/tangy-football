# Tangy Football

A Next.js web app for our Sleeper fantasy football league: standings, live scoring, playoff odds, weekly and season analytics, draft grades, trade and waiver tools, and the league's full history. Live at https://tangy-football.vercel.app.

[FEATURES.md](FEATURES.md) is a plain-language tour of the site. This README covers how things work and how to run it.

## Features

The season picker in the header switches every tab between seasons. Past Sleeper seasons are found by following each league's `previous_league_id`. Seasons before Sleeper (2017-2021) only have their final standings and the History tab. Weekly analytics count completed regular-season weeks only, and ties count as half a win everywhere.

### Overview
- 🏆 **Division Standings** - Each division's photo from Sleeper, and record, points, games back (GB) and points back (PB) per division, ranked by wins, then points for.
- 🎯 **Wild Card Race** - The non-division leaders ranked for the remaining playoff spots, with the cutoff line.
- 🏈 **Weekly Matchups** - Results for any completed week. Tap one for both lineups slot by slot and the benches at the time, with photos, each player's final points and his Sleeper projection from before the games (`/api/matchup-players`).

### Live (current season, during a game week)
While an NFL game is being played, scores and game clocks update every 10 seconds (once a minute otherwise), and a score that changes flashes green or red with the change beside it. Scores are computed from Sleeper's live player stats with the league's scoring settings, which Sleeper refreshes every 30 seconds against 60 for its matchup scores (the two agree exactly). Projections and injury statuses refresh every 2 minutes.
- 🎯 **Matchups** - Each real matchup's live score, projected final and win odds. Each starter still to play adds his Sleeper projection for the share of his NFL game left (game clocks from ESPN's public scoreboard, with a chance of overtime when a game is close late); players ruled out add nothing and doubtful ones less. Defenses are projected in the league's scoring with points allowed handled by bracket: every defense starts a game in the shutout bracket (10 points here), so instead of adding its projection on top, the tab projects where its points allowed will end up and weighs each bracket by its chance, which can be negative (`scripts/backtests/live_defense.py`). The uncertainty shrinks with the time left and grows with how boom-or-bust each starter has been this season. At kickoff these odds were well calibrated on 2022-2025's matchups (`scripts/backtests/live_pregame.py`). Tap a matchup for both lineups and benches: each player's points so far, projected final, game clock and injury status.
- 🔴 **Live Play-All** - Each team's record against every other team at the current scores, its real matchup and margin, and its season play-all record if the week ended now.
- 📊 **Live Standings** - The standings if the week ended now, with teams moving into or out of a playoff spot flagged.

### Playoffs
During the regular season:
- **If the Season Ended Now** - The projected bracket: division winners take the top seeds, then wild cards (ties go to points for); seeds 1-2 get byes.
- **Playoff Odds** - 20,000 simulations of the real remaining schedule, giving playoff, division, bye, title and toilet bowl odds, and how this week's win or loss changes them. Each team's weekly score centers on its current roster: each player is worth half his Sleeper projection for that week (so byes and injuries count) and half his points per game this season, and a team's expected score is the league average plus 75% of how far its best lineup is from the league's. A player who's out is projected by Sleeper as if he's back next week, so his later weeks are scaled by his chance of being back by then (68% the next game after missing one, 29% after two, about a quarter a game after that; no return from IR before 4 games), unless Sleeper already has him out longer.
- **Toilet Bowl If the Season Ended Now** - The six non-playoff teams in the toilet bowl, where the lower score advances.
- **What Each Team Needs** - Each team's odds now, with a win and with a loss; clinched and eliminated; in the last three weeks, win-and-in scenarios; and the team's biggest rooting interest this week.

After the regular season, and for past seasons, the **Playoff Bracket** (with placement games) and the **Toilet Bowl**.

### Weekly Performance
- 📈 **Weekly Scores** - Every score, colored by win or loss, with season average and average score and margin in wins and losses.
- 🔥 **Weekly Rankings Heatmap** - Each team's scoring rank each week, with average and median rank.

### Season Trends
Line charts of standings over time, cumulative scores, and points above or below the weekly median (added up). Hover or tap a week for every team's value, or a team in the legend to highlight its line.

### Advanced Stats
- 🎲 **Play Everyone** - Each team's record if it played every team every week, against its real record, with a luck factor.
- 🎯 **Schedule Luck Distribution** - 20,000 random schedules per team, showing the range of records it could have had.
- 📋 **Weekly Play-All** - Week-by-week play-all records as a heatmap.

### Draft
- 📋 **Draft Board** - By round for snake drafts, by team and price for auctions. Each pick shows points per available week (`/wk`: half-PPR points divided by the weeks the player could have played, so missed games count as zeros).
- 🎯 **Draft Core** - Each team's intended starters (its most expensive or earliest QB, RBs, WRs, TE and flex), ranked by their combined `/wk`.
- 📊 **Draft Results** - Core/wk, all picks/wk, auction spend, $ per point and best pick.

Completed seasons' drafts are pre-built JSON in `web/public/data/drafts/`; the season in progress is built live.

### Trades & Waivers (current season, during the regular season)
- 🔄 **Trade Analyzer** (until the trade deadline) - Pick two managers and the players moving. Shows each team's win odds for every remaining week with and without the trade, season odds before → after (20,000 simulations each), lineup changes and forced roster moves, each player's [FantasyCalc](https://fantasycalc.com) market value, and which other teams' odds move. Each side is marked "Overpays by market value" when it gets back less than 85% of the market value it gives (with a premium for the best player in a deal). Players take their projections and season production with them; on the league's 2022-2025 trades this predicted playoff odds better than the alternatives tried (see `scripts/backtests/`).
- 🔎 **Trade Finder** (until the trade deadline) - Pick your team and it searches 1-for-1 up to 3-for-2 trades with every manager, keeping those that raise your playoff and title odds without hurting the other side. A market filter (on by default) hides trades where the other manager gets back much less FantasyCalc value, and a trade where you do is marked "You overpay by market value". Each result opens in the analyzer.
- 🧲 **Waiver Finder** - The free agents who'd help you most, for the rest of the season or one specific week (to cover a bye), each with the player it would drop, ranked by how much they raise your odds.

### History
Every season the league has played. Managers are tracked by their Sleeper account and shown by first name. Seasons before Sleeper come from the old platform's final standings (`web/lib/data/legacyHistory.ts`) and count toward records, titles and finishes; points, head to head and game records start in 2022.
- 🏆 **Champions** - Each season's champion, runner-up and toilet bowl loser (third place before Sleeper).
- 📋 **All-Time Standings** - Per manager: seasons, record, win %, points per game, playoff appearances, finals, titles, toilet bowl losses and best finish.
- ⚔️ **Head to Head** - Every manager's record against every other; tap a cell for every meeting.
- 🔥 **Rivalries** - Most-played, most lopsided and closest series.
- 🔁 **Trades** - Every Sleeper-era trade, graded at the time (the odds change it made, re-simulated with that week's rosters and projections) and in hindsight (the starting-lineup points the players brought in), with per-manager trade stats. Completed seasons are pre-built JSON in `web/public/data/trades/`.
- 📖 **Record Book** - Highest and lowest scores, blowouts, closest games, and best and worst seasons.

All-time records, head to head and rivalries count regular-season, playoff and toilet bowl games; a switch changes them to the regular season only. Placement games (3rd place, 5th place and so on) never count, since teams often don't set lineups for them.

### Across the site
- 🙋 **You** - Pick your team in the header (saved on this device; ✕ clears it) to highlight it in every table and chart and preselect it in the trade and waiver tools.
- 🔗 **Shareable links** - The tab and season are in the address bar (`?tab=history&season=2023`), so refresh, back and shared links land on the same view.
- ↕️ **Sortable tables** - Tap a column header to sort best-first, again to reverse, and a third time (or ↺) for the default order.
- 💡 **Definitions** - Dotted-underlined terms (GB, PB, Core/wk, luck factor…) explain themselves on hover or tap.
- 📱 **Phones** - The tab row scrolls sideways, wide tables keep the team column pinned, chart popups open and close with a tap, and the site can be added to the home screen with a football icon.
- 🏈 **Chalkboard background** - Faint plays draw themselves behind the page, each at a new angle and slowly drifting (`web/components/ui/Chalkboard.tsx`); cards are slightly see-through so it shows faintly. It stays still when the device asks for reduced motion.
- ✨ **Smooth tab switches** - Tabs crossfade (a short fade-in in Safari, whose View Transitions flicker), and charts are built only as they come near the screen, so chart-heavy tabs appear straight away.
- 🏠 **Home and easter egg** - The league logo and name go back to the current season's Overview; mash them (5 quick taps) to kick a field goal (`web/components/ui/HomeLink.tsx`).
- 🎨 **Themes** - Light, dark (true black) or follow the device.

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
│   │   ├── page.tsx              # Main page and tabs (tab and season kept in the address bar)
│   │   ├── layout.tsx            # Layout, theme bootstrap and theme-colored browser bar
│   │   ├── manifest.ts           # Web app manifest (add to home screen)
│   │   ├── apple-icon.png        # iPhone home-screen icon
│   │   └── icon.tsx              # Favicon from the league avatar
│   ├── components/               # Tab sections (standings, charts, brackets, Live, playoff picture, draft, trades)
│   │   └── ui/                   # Shared pieces (cards, sortable headers, pinned team names, definitions, football spinner, chalkboard, home link and easter egg, lazy chart mounting, theme toggle, error boundary)
│   ├── hooks/                    # Theme, your team, table sorting, chart hover and taps, team colors
│   ├── lib/
│   │   ├── analyze/              # Analytics: stats, play-all, brackets, playoff odds, live, draft, trades, trade and waiver finders, history
│   │   ├── __tests__/            # Vitest tests
│   │   ├── config.ts             # League ID and cache durations
│   │   ├── sleeper.ts            # Shared Sleeper fetch helpers
│   │   ├── oddsData.ts           # Playoff-odds inputs shared by the odds and trade routes
│   │   ├── tradeHistory.ts       # Builds a season's graded trade history
│   │   ├── historyData.ts        # Builds the all-seasons history
│   │   ├── data/legacyHistory.ts # Seasons before Sleeper (final standings, top three, first names)
│   │   ├── leagueSettings.ts     # League structure from Sleeper settings (see LEAGUE_SETTINGS_UPDATE.md)
│   │   ├── tableSort.ts          # Table sorting
│   │   ├── urlState.ts           # Tab and season in the address bar
│   │   ├── constants.ts
│   │   ├── theme.ts
│   │   └── types.ts
│   └── public/
│       ├── data/                 # Pre-built draft data and trade history per season
│       └── icon-*.png            # Home-screen icons for Android
├── scripts/                      # Python data scripts
│   └── backtests/                # Backtests behind the playoff odds and trade analyzer
├── docs/                         # Research notes
├── FEATURES.md                   # Plain-language tour of every tab
├── FUTURE_FEATURES.md            # Ideas not built yet
├── LEAGUE_SETTINGS_UPDATE.md     # How the league's structure is read from Sleeper
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

`league_data.json` and `fantasy_analysis.xlsx` are generated files and are gitignored.

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
| Live tab scores and game clocks (`/api/live/scores`) | Shared through the CDN for 8 seconds; Sleeper's stats 10 seconds, matchups 20, ESPN's scoreboard 5 |
| Live tab projections and injury statuses | 2 minutes |
| Playoff odds | 30 minutes, rebuilt as soon as a new week is scored |
| Draft data for the season in progress | 1 hour, rebuilt as soon as a new week is scored |
| Trade analyzer rosters and projections | 10 minutes, rebuilt as soon as a new week is scored |
| FantasyCalc values | 6 hours |
| Trade history for the season in progress | 1 hour, rebuilt as soon as a new week is scored |
| League history (all seasons) | 5 minutes, rebuilt as soon as a new week is scored; completed seasons' Sleeper data 1 day |
| League avatar favicon | 1 hour |

## Deployment

The site is hosted on Vercel at https://tangy-football.vercel.app. There's no Vercel config file in the repo, so build settings live in the Vercel project settings. The app is in `web/`, so the project's root directory is set to `web`. Every push to `main` deploys to production.

## Technologies

- **Next.js 15** (App Router) and **React 19**
- **TypeScript 5**
- **Tailwind CSS 4**
- **Recharts 3** for charts
- **Vitest 4** with Testing Library for tests
- **Sleeper API** (`api.sleeper.app/v1`) for leagues, users, rosters, matchups, transactions, brackets, drafts and weekly player stats (draft grades and the odds model's player values), plus weekly player projections and the NFL schedule from `api.sleeper.com` for playoff odds and trades. The `api.sleeper.com` endpoints aren't part of Sleeper's documented API.
- **ESPN's scoreboard** (`site.api.espn.com`) for NFL game clocks in the Live tab's win odds. Also undocumented; without it the odds are hidden.
- **FantasyCalc** (`api.fantasycalc.com`) for redraft trade values in the trade analyzer. Also undocumented; the analyzer works without it.
- **Python 3.13** with requests, pandas and openpyxl for the data scripts
