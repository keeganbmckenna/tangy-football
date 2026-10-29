# Model research and backtests

The evidence behind every number the site predicts: playoff, bye, title and toilet-bowl odds,
single-game win odds, trade valuations and the Live tab. What ships, and why, is summarized in
[`docs/odds-models.md`](../../docs/odds-models.md).

| Document | What it holds |
|---|---|
| [`PREREGISTRATION_2026.md`](PREREGISTRATION_2026.md) | The rules of evidence, fixed in advance, and the 2026 out-of-sample evaluation plan, with a dated log of every change shipped since |
| [`LOG.md`](LOG.md) | One line per model variant tried, with its result and whether it was adopted, failures included |
| [`FINDINGS.md`](FINDINGS.md) | The detailed results, in the order the backtests were run |

## Rules of evidence

A change ships only if it beats the model it would replace **out of sample** (each season
predicted by a model fitted on the other seasons), by at least **0.0005 playoff Brier**, with a
**95% interval resampling leagues** that excludes zero, in at least **5 of 8 seasons**. The
primary score is playoff Brier on 12-team leagues under this league's rules (3 divisions,
division winners seeded first, top 6 make the playoffs), on real schedules, from every week
from 3 to the end of the regular season (`rank_odds.py --weekly --rules ours`). Nothing is
tuned on 2026 data before the preregistered evaluation.

## Setup

Run everything from this directory with the repo's environment (`uv sync`, or
`uv sync --extra gpu` for the PyTorch scripts; see the [scripts README](../README.md)).

**Data.** This league's seasons are archived in [`data/sleeper/`](../../data/sleeper) and read
automatically. The research on other leagues needs a local crawl that is **not committed**: the
repo is public and these are other people's leagues. Restore it from the archive
(`crawled-leagues-2018-2025.tar`, unpacked so files sit at
`cache/leagues/{season}/{league_id}.json.gz`) or rebuild it (several hours, rate limited):

```bash
python crawl_leagues.py --seasons 2025 2024 2023 2022 2021 2020 2019 2018 --per-season 1000 --seed-from-cache
python crawl_leagues.py --transactions   # optional: waivers, trades, FAAB
python crawl_leagues.py --histories      # optional: earlier seasons of every league
python crawl_leagues.py --summary        # files per season, each read back
python player_weeks.py                   # optional: the player-week table (cache/player_weeks.parquet)
```

Every script keeps this league out of the crawled data (`leagues_fit.OURS`), so checks on our
own seasons stay out of sample. Intermediate caches (`strength_data*.pkl`, `cache/`) are
git-ignored and rebuilt on demand.

**GPU.** The simulators in `gpu_sim.py` and `rank_odds.py` run every league snapshot at once in
PyTorch (an RTX 5090 runs the full evaluation in about 90 seconds); they fall back to the CPU.
`python gpu_sim.py --check` confirms the GPU simulator matches the CPU one exactly.

## Reproducing what ships

```bash
python rank_odds.py --weekly --rules ours   # the primary score: fitted model vs the earlier one and baselines
python title_odds.py                        # title and last-place odds
python single_games.py                      # the trade tools' single-game win odds
python trades.py                            # how much of a trade's projected change shows up
python trade_waivers.py                     # forced moves, waiver moves and playoff weeks in a trade's change
python own_league.py                        # the models, fitted on other leagues, scored on ours
python export_model.py --fixture            # fit on every league and write web/lib/analyze/strengthModel.json
```

`export_model.py --fixture` also writes the parity fixture that
`web/lib/__tests__/playoffOdds.test.ts` checks the site's TypeScript simulator against.

## Scripts

**Data and infrastructure**

| Script | What it does |
|---|---|
| `crawl_leagues.py` | Collects Sleeper leagues like ours (`--divisions`, `--transactions`, `--histories`, `--summary`, `--check-divisions`) |
| `player_weeks.py` | Every rostered player-week of the crawled leagues: projection, points, played, injury report |
| `fetch_history.py` | Caches this league's current season (completed seasons come from the archive) |
| `common.py` | Shared helpers: cached Sleeper data, best lineup, least squares |
| `strength_model.py` | Builds league snapshots (`collect`, weekly or weeks 4/7/10) and fits team strength on the CPU |
| `gpu_sim.py` | The season simulator in PyTorch, leave-one-season-out fitting, league-clustered intervals |
| `rank_odds.py` | The evaluation harness: our rules (`--rules ours`), every week (`--weekly`), schedule-averaged targets, playoff and bye Brier, rank RPS, wins CRPS, brackets |
| `export_model.py` | Exports the shipped weights to the site, with a parity fixture |
| `eval_2026.py` | Scores the 2026 season's logged predictions (preregistered) |

**Adopted** (the evidence for what ships)

| Script | Question |
|---|---|
| `leagues_fit.py` | The playoff model on thousands of other leagues: the projection weight should be about 0.3, not 0.75 |
| `brier_floor.py`, `headroom.py` | How low can the playoff Brier go, and how much better could any strength model do |
| `strength_model.py`, `rank_odds.py` | Team strength fitted from projected lineup + points per game, with measured uncertainty |
| `title_odds.py` | Title and last-place odds of the fitted model |
| `single_games.py` | Single-game win odds: a model fitted for one week's score |
| `trades.py` | The weight on a trade's projected lineup change (0.43, not 0.75) |
| `trade_waivers.py` | A trade's change with forced moves (kept), at each roster's best with waiver moves (not adopted), and over the playoff weeks (adopted for the playoffs) |
| `injuries.py` | Official NFL injury reports: Doubtful players count 0, Questionable 0.9 |
| `live_components.py`, `live_replay.py`, `live_model.py`, `live_eval.py` | The Live tab's odds replayed through every week of the crawled leagues on the GPU (the site's model ported to PyTorch, checked against `live_odds_fixture.json` from `web/scripts/export-live-fixture.ts`): the spread scale, and the tested alternatives |
| `live_sim.py`, `live_state.py` | Players' real distributions of points still to come (often a lot, often nothing, rarely negative), blended into the Live tab's odds as one team runs out of players; the site's tables and parity fixture |
| `returns.py` | Injured players' chances of being back, by games missed (the odds model's RETURN_RATE) |
| `tau_playoffs.py` | Strength uncertainty over every remaining week incl. the playoffs: the Power Rankings' ranges |
| `stats_audit.py` | Which descriptive team stats measure something (split-half reliability): luck is luck, start/sit calls are real |
| `live_defense.py` | The Live tab's defense projections |
| `live_diagnostics.py` | The Live tab's odds through each week on our league: calibration, spread, and when points arrive in a game (exploratory) |
| `own_league.py`, `league_activity.py` | The fitted models on our own 2022-2025 seasons |

**Tested and not adopted**

| Script | Question |
|---|---|
| `live_pregame.py` | The Live tab's kickoff spread on our league (0.7; too few matchups, replaced by `live_eval.py`) |
| `live_state.py` | Game state (score margin, quarter, possession) and same-game correlations in the live odds, with their ceilings |
| `live_injury.py` | In-game injury flags and Vegas lines in the live odds (an oracle ceiling under 0.001) |
| `live_replay.py` (LIVE_USE=endgame6b) | Late-game drives as discrete touchdowns and field goals (a candidate for the 2026 check) |
| `kalshi_live.py`, `kalshi_props.py`, `kalshi_props_model.py` | Kalshi's in-game prices: their lag behind plays, and 2025's player props blended into the live odds |
| `drift.py` | Strength that drifts through the season (real, but worth 0.00005) |
| `schedule_luck.py` | How much the schedule decides; random vs real remaining schedules |
| `improvements.py` | Recency-weighted and median form, score vs projections, nonlinear terms, per-team uncertainty, noise shape |
| `player_values.py` | Player values from projection only vs blended with season form |
| `manager_features.py`, `candidate_checks.py`, `active_leagues.py` | Roster activity and manager track record (helps only by spotting abandoned teams) |
| `live_correlation.py` | Correlated players (QB-WR stacks, shootouts) at kickoff |
| `streaming.py`, `stream_weight.py` | Assuming managers stream from waivers |
| `trade_depth.py`, `trade_depth_trades.py` | Counting bench depth for missed games |
| `kalshi_ffpts.py` | Kalshi's player fantasy-points markets vs Sleeper's projections |

**This league's own backtests** (2022-2025, 48 team-seasons; the first round of research)

| Script | Question |
|---|---|
| `trade_effect.py`, `star_effect.py`, `trade_season.py` | How much of a trade shows up, and which weighting predicts best |
| `form_options.py`, `form_options_score.py` | Where the season-scoring part of team strength should live |
| `horizon.py` | How well projections predict scores h weeks later |
| `games.py`, `game_calibration.py` | Single-game win odds: calibration and spread |
| `season_odds.py`, `season_odds_score.py` | Season playoff and bye odds |
| `loso.py` | Leave-one-season-out check of the parameters tuned on this league |
