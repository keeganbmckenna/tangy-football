# Scripts

Python scripts that maintain the site's data, plus the model research in
[`backtests/`](backtests/README.md).

## Setup

Requires Python 3.13 and [uv](https://docs.astral.sh/uv/). From the repo root:

```bash
uv sync               # numpy, pandas, pyarrow, requests
uv sync --extra gpu   # also PyTorch, for the GPU simulators in backtests/
```

Run scripts with `uv run python scripts/<script>.py` from the repo root.

## Data maintenance

| Script | What it does | When |
|---|---|---|
| `archive_season.py [season ...] [--force] [--nfl-only]` | Saves completed seasons' Sleeper data (league, rosters, matchups, transactions, brackets, draft, projections, stats, schedule) to `data/sleeper/{season}/`; skips seasons already archived unless `--force`; `--nfl-only` saves just the NFL projections, stats and schedule (2018-2021) | Every March 15, by the `Archive seasons` workflow |
| `snapshot_predictions.py [label]` | Saves the live site's odds, trade data and Live inputs, plus every player's injury status, for the 2026 evaluation | Before kickoffs and on Wednesdays, by the `Prediction log` workflow |
| `build_draft_data.py [season ...]` | Rebuilds `web/public/data/drafts/{season}.json` from Sleeper (all seasons if none given) | After a draft |
| `build_odds_history.py [season ...] [--url URL]` | Rebuilds `web/public/data/odds-history/{season}.json` (the Playoffs tab's week-by-week odds) for completed seasons from a running app's `/api/odds-history/{season}` | After a season ends, or after a model change |
| `build_season_insights.py [season ...] [--url URL]` | Rebuilds `web/public/data/season-insights/{season}.json` (lineups, best possible lineups, projections and waiver moves for the Rosters tab, awards and Season in Review) for completed seasons from a running app's `/api/season-insights/{season}` | After a season ends |
| `build_play_timelines.py season ... [--weeks N ... \| --recent N \| --current]` | Replays each week from nflverse play-by-play into `scripts/cache/timelines/` (git-ignored): every starter's points after each play, each game's clock and score, the injury report. Then `cd web && npx tsx scripts/build-win-history.ts season ...` turns them into `web/public/data/win-history/` | Run by the `Win history` workflow on Tuesdays, Wednesdays and Fridays; by hand to rebuild past seasons. `--current` (both scripts, the second with `npx tsx --env-file=.env.local`) replays the week in progress so far into the live odds in Redis |
| `build_trade_history.py [season ...] [--url URL]` | Rebuilds `web/public/data/trades/{season}.json` for completed seasons from a running app's `/api/trades/{season}` (default `http://localhost:3000`) | After a season ends, or after a model change |

`build_draft_data.py` has a season to league/draft ID table to extend each season; the other
scripts follow Sleeper's `previous_league_id` chain from the current league.
