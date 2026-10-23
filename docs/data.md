# Data

Where the site's data comes from, what is stored in the repo, and what isn't.

## Live sources

| Source | Used for |
|---|---|
| Sleeper API (`api.sleeper.app/v1`) | Leagues, users, rosters, matchups, transactions, brackets, drafts, weekly player stats |
| Sleeper projections and schedule (`api.sleeper.com`, undocumented) | Weekly player projections and the NFL schedule for the odds, trade tools and Live tab |
| ESPN scoreboard (`site.api.espn.com`, undocumented) | NFL game clocks for the Live tab's win odds (hidden without it) |
| FantasyCalc (`api.fantasycalc.com`, undocumented) | Redraft trade values in the trade tools (optional); see [fantasycalc-api.md](fantasycalc-api.md) |

The app's server routes fetch and cache all of it; durations are in `CACHE_CONFIG` in
`web/lib/config.ts` and listed in the [README](../README.md#caching).

## In the repo

| Path | Contents | Updated by |
|---|---|---|
| `data/sleeper/{season}/` | Completed seasons: league, users, rosters, brackets, draft, matchups, transactions, every player's weekly projections and stats, the NFL schedule. 2018-2021 hold NFL projections, stats and schedules only (Sleeper's projections start in 2018) | `scripts/archive_season.py`, run by the `Archive seasons` workflow every March 15 |
| `web/public/data/drafts/{season}.json` | Pre-built draft boards for completed seasons | `scripts/build_draft_data.py` |
| `web/public/data/trades/{season}.json` | Pre-built trade grades for completed seasons | `scripts/build_trade_history.py` |
| `web/public/data/odds-history/{season}.json` | Pre-built week-by-week odds for completed seasons | `scripts/build_odds_history.py` |
| `web/lib/analyze/strengthModel.json` | The fitted odds-model weights | `scripts/backtests/export_model.py` |
| `prediction-log` branch | The site's odds and every player's injury status before kickoffs and on Wednesdays, for the 2026 evaluation (Sleeper overwrites injury statuses, so they can't be recovered later) | The `Prediction log` workflow (`scripts/snapshot_predictions.py`) |

A finished season is static: Sleeper's stat corrections run through the Thursday after each
week's games.

## Not in the repo

The model research uses thousands of other public Sleeper leagues. They are other people's
leagues and the repo is public, so they stay in the git-ignored `scripts/backtests/cache/` and
are never committed:

| Path | Contents |
|---|---|
| `cache/leagues/{season}/` | 7,383 redraft league-seasons like ours, 2018-2025 |
| `cache/leagues_div/{season}/` | 599 leagues in this league's exact format (12 teams, 3 divisions), 2025 |
| `cache/transactions/{season}/` | Waivers, trades and FAAB for every crawled league |
| `cache/history/{season}/` | Earlier seasons of the crawled leagues, to link managers across years |
| `cache/player_weeks.parquet` | Every rostered player-week of the crawled leagues (22 million rows) |
| `cache/nflverse/` | Official NFL injury reports, 2022-2025 |

They are rebuilt with `crawl_leagues.py`, `player_weeks.py` and `injuries.py`; see the
[research README](../scripts/backtests/README.md#setup). This league's own seasons are always
excluded from them.
