# Fantasy Football 2026 - Tangy Football

A Next.js web app for analyzing a Sleeper fantasy football league: standings, live scoring views, playoff odds, weekly and season analytics, and draft grades, across every season of the league's history.

## Features

The season picker in the header switches every tab between seasons; past seasons are found by following Sleeper's `previous_league_id` chain from the configured league. Weekly analytics only count completed regular-season weeks.

### Overview
- 🏆 **Division Standings** - One card per division with record, points, games back (GB), points back (PB) and the leader marked. Leagues without divisions get a single overall standings table with the playoff cutoff.
- 🎯 **Wild Card Race** - Non-division leaders ranked for the remaining playoff spots, with the cutoff line.
- 🏈 **Weekly Matchups** - Results for any completed week (week picker; defaults to the most recent).

Standings are ranked by wins, then points for.

### Live (current season only)
Shown only for the current season. It's active while a regular-season week is in progress, and refreshes every minute while the tab is visible.
- 🔴 **Live Play-All** - Each team's record against every other team at the current scores (equal scores are ties), colored by win rate, with a dot for whether the team is winning, losing or tied in its real matchup, the real margin, and season play-all counting this week as if it ended now.
- 📊 **Live Standings** - The Overview standings as if the week ended now: each record shown before → now, the live matchup dot, and teams moving into or dropping out of a playoff spot flagged. Real matchups still at 0-0 count as not started.

### Playoffs
- 🔮 **Playoff Picture** - Shown instead of the brackets while the current season's regular season is in progress:
  - **If the Season Ended Now** - Seeds (division winners take the top seeds, then wild cards; ties on record go to points for) in the league's bracket: seeds 1-2 get byes, round 1 is 4 v 5 and 3 v 6, seed 1 plays the 4/5 winner and seed 2 the 3/6 winner. Plus the first teams out.
  - **Playoff Odds** - 20,000 simulations of the remaining schedule. Each team's weekly score centers on 75% its projected best lineup for that week (from Sleeper projections, so byes count) and 25% its season scoring. Shows playoff, division and bye odds, title odds (the playoff bracket is played out, higher score advancing), odds of losing the toilet bowl (played out too), and a this-week column showing how a win or loss changes whichever outcome is picked in its selector (playoffs, division, playoff bye, winning the league, toilet bowl bye or losing the toilet bowl).
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
│   │   │   └── draft/[season]/   # Draft data for the season in progress
│   │   ├── page.tsx              # Main page and tabs
│   │   ├── layout.tsx            # Layout and theme bootstrap
│   │   └── icon.tsx              # Favicon from the league avatar
│   ├── components/               # Tab sections (standings, charts, brackets, Live, playoff picture, draft)
│   │   └── ui/                   # Shared pieces (cards, theme toggle, loading, error boundary)
│   ├── hooks/                    # Theme, chart hover and team color hooks
│   ├── lib/
│   │   ├── analyze/              # Analytics: stats, play-all, brackets, playoff odds, live, draft
│   │   ├── __tests__/            # Vitest tests
│   │   ├── config.ts             # League ID and cache durations
│   │   ├── sleeper.ts            # Shared Sleeper fetch helpers
│   │   ├── leagueSettings.ts
│   │   ├── constants.ts
│   │   ├── theme.ts
│   │   └── types.ts
│   └── public/data/drafts/       # Pre-built draft data per season
├── scripts/                      # Python data scripts
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
| League avatar favicon | 1 hour |

## Deployment

The site is hosted on Netlify. There's no Netlify config file in the repo, so build settings live in the Netlify site settings. The app is in `web/`, so Netlify has to build from that directory (base directory `web`).

## Technologies

- **Next.js 15** (App Router) and **React 19**
- **TypeScript 5**
- **Tailwind CSS 4**
- **Recharts 3** for charts
- **Vitest 4** with Testing Library for tests
- **Sleeper API** (`api.sleeper.app/v1`) for leagues, users, rosters, matchups, brackets, drafts and weekly player stats, plus weekly player projections from `api.sleeper.com` for playoff odds. The projections endpoint isn't part of Sleeper's documented API.
- **Python 3.13** with requests, pandas and openpyxl for the data scripts

## License

This repository doesn't include a license file.
