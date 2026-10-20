# Backtests

Checks behind the playoff odds and the Trades tab, run on this league's 2022-2025
seasons. Every script reads a local cache of Sleeper data, so fetch it first. Run
from this directory:

```bash
python fetch_history.py        # cache leagues, rosters, trades, matchups, weekly projections
python trade_effect.py         # how much of a trade's projected lineup change shows up in weekly scores
python star_effect.py          # the same, split by the best player received and the size of the change
python trade_season.py         # which trade weighting best predicts the rest of the season (several minutes)
python form_options.py trades  # where the season-scoring part of team strength should live: after trades
python form_options.py all     # ... and for every team at every week (the Playoffs tab)
python form_options_score.py fo_trades.json fo_all.json
python horizon.py              # how well projections known in week t predict scores h weeks later
python games.py                # per-game predictions -> games.npy
python game_calibration.py     # single-game win odds: calibration and the fitted spread
python season_odds.py          # season-level playoff and bye odds (several minutes) -> season.pkl
python season_odds_score.py    # scores season_odds.py's variants
python live_pregame.py         # the Live tab's matchup win odds at kickoff: spread and calibration
python live_defense.py         # defenses' points allowed: projection bias and spread, bracket scoring
python trade_depth.py          # do missed games (bench depth) predict a roster's lineup better?
python trade_depth_trades.py   # ... and the league's trades (trade_season.py with a depth variant)
python kalshi_ffpts.py         # Kalshi's player fantasy-points markets vs Sleeper's projections (2026)
python streaming.py            # does assuming managers stream from waivers improve the odds?
```

Requires numpy (installed with pandas by `uv sync`).

## What they found

- **Trade effect** (`trade_season.py`): for 84 trades (169 trading teams) from the week
  each counted from, giving the trade's projected lineup change the playoff model's own
  75% weight predicted the rest of the season best: playoff Brier 0.1396 vs 0.1447 with
  less credit (70% next week fading to 25%) and 0.1510 ignoring the trade; squared error
  of rest-of-season wins 2.72 vs 2.80 and 2.93. The Trades tab uses 75%, which also keeps
  it consistent: swapping two whole rosters turns each team into the other.
  `trade_effect.py` and `star_effect.py` look at weekly scores instead. There, only part
  of a small projected change shows up (most trades are near-even swaps, so their
  projected change is mostly noise), while big changes (6+ pts/wk) show up much more
  fully. Weekly scores are too noisy to set the weight from, and the season-level test
  is what the tab shows.
- **Player-level values** (`form_options.py`): the model used to be 75% projected lineup +
  25% the team's season scoring, which stayed with the team after a trade. Valuing each
  player as half his projection, half his season points per game (padded with 3 games of
  projection), with team strength from the current roster only, predicted playoff odds
  better both for trading teams (Brier 0.1245 vs 0.1351) and for every team at every week
  (0.1171 vs 0.1207), better in 7 of 8 test-and-season splits, and as well calibrated.
  Moving traded players' points with them helped less (0.1313); projection alone, 25% and
  75% blends and other padding all beat the old model too. This is the current model.
- **Single-game win odds** (`game_calibration.py`): more than a week out, the playoff
  model's per-game odds were overconfident. A spread of 0.9x the week-to-week spread
  next week and 2.2x after fit best out of sample (log loss 0.6578 vs 0.6858); with the
  player-level model it's 0.8x and 2x (0.6573 vs 0.6761). Used for
  the Trades tab's weekly win odds.
- **Season odds** (`season_odds.py`): the earlier model (75% projection, 25% season form)
  beat every softened variant on playoff and bye odds (Brier 0.1208 vs
  0.1237+) and was well calibrated (teams given 50-75% made it 61.6% of the time at an
  average of 61.5%), so the Playoffs tab is unchanged.

- **Live matchup odds at kickoff** (`live_pregame.py`): on 288 matchups (weeks 3+), odds
  from the starters' Sleeper projections beat a coin flip (log loss 0.590 vs 0.693) and were
  well calibrated (favorites given 70-80% won 75%, 90%+ won 96%). The best whole-game spread
  per team was 0.7x the league's week-to-week spread, which the Live tab uses. Per-player
  boom-or-bust spreads did no better than one spread at kickoff (0.5904 vs 0.5907); they're
  kept for late in a week, when a few volatile players are all that's left. The archive's
  injury statuses are from after the season, so the injury adjustment can't be tested here.

- **Defenses** (`live_defense.py`): over 2,048 defense-games, Sleeper's projected points
  allowed was unbiased (-0.3) with a spread of 8.9 points, and its pre-game projections
  weren't too high (6.69 standard points against 7.36 actual in this league's scoring, which
  also counts return yards). Projecting points allowed and weighing each bracket's points by
  its chance matched the actual average best (7.31). The Live tab does this through the game,
  so a defense's shutout bonus at kickoff doesn't count on top of its projection.

- **Depth** (`trade_depth.py`, `trade_depth_trades.py`): starters miss games (of players
  who played and were projected 8+, 9.5% missed their team's next game, rising to 19% eight
  games out; QBs about 1.27x that, counting benchings). Valuing rosters on expected lineups
  with those misses, so bench depth counts, did *not* predict better: rosters' real
  points (correlation 0.414 vs 0.421 without) and the league's 84 trades (wins error 2.814 vs
  2.723, playoff Brier 0.1434 vs 0.1396; worse beyond the 95% interval) both got worse, even
  with a missing starter replaced by a free agent (2.779, 0.1431). Managers cover injuries
  from waivers, and Sleeper's projections run a little low, so the trade tools keep valuing
  the best lineup. Kept for reference.
- **Injured players' returns**: of players who'd been playing, missed a game and came back
  later that season, 76% played their team's next game; of those out two in a row, 40% the
  next; then 38% and about half. Counting season-ending injuries too it's 68%, 29%, 25%, 21%,
  but the discount only applies to players Sleeper projects to be back next week, which
  leaves those out, so the model uses the first set (for players who'd scored 15+ it's in
  between: 69%, 33%, 32%, 32%). Sleeper projects an out player for every later week as if
  he's back next week, so the odds model scales those weeks by these chances (no return from
  IR before 4 games), unless Sleeper already has him out past next week. The archive's injury
  statuses are from after the season, so this can't be backtested on past trades.

Projections are always the ones known at the time: the week after the cutoff, carried
forward with each NFL team's bye weeks. Sleeper's archived projections for later weeks
were made just before those games, which would leak information.

- **Kalshi's fantasy-points markets** (`kalshi_ffpts.py`): Kalshi lists one line per
  player per game ("Over 21.6 fantasy points"), settled on Sleeper's full-PPR points. On
  1,064 settled markets from 2026 weeks 1-6, priced just before kickoff: the line *is*
  Sleeper's projection (median difference 0.13 points), so the market only prices over or
  under it. Players finished under their projection 55% of the time (scores skew: a few
  big games pull the average above the typical one), and the market knew it, pricing the
  over at 42% on average. Its odds of the over beat Sleeper's (log loss 0.682 vs 0.691)
  and a flat 45% (0.688), but by less than the noise (0.008 ± 0.008), and won only 4 of 6
  weeks. As expected points, a 25% market blend cut squared error by 0.4 ± 0.2 (RMSE 6.97
  vs 7.00); the market was closer in 51% of the biggest disagreements; it was overconfident
  at the extremes (priced 30%, hit 41%). Too small to change the Live or Playoffs odds,
  so they keep Sleeper's projections. Live in-game prices aren't tested here.

- **Streaming from waivers** (`streaming.py`): the odds model with lineups that stream (a
  K/DEF slot takes the 3rd-best free agent when better; a slot that would score 0 takes the
  best free agent who can play it) vs roster-only lineups, every team at every week 3-13 of
  2022-2025 (576 team-weeks, intervals clustered by team-season). Streaming did *not* help:
  playoff Brier 0.1208 vs 0.1169 (+0.0039, 95% interval +0.0001 to +0.0080), worse in 3 of
  4 seasons; rest-of-season wins and single games unchanged; future points per week 0.6%
  better, within noise. The 3rd-best everywhere (+0.0035), K/DEF only (+0.0007) and best
  everywhere (+0.0049) were no better. After the league's 81 trades it was the same (playoff
  Brier +0.0064, wins -0.026, both within noise). Teams that streaming credits did score a
  bit more afterwards, but streaming moves team strength by under a point a week against
  weekly swings of about 25, too little to sharpen the odds. Free agents score about what
  Sleeper projects (K, DEF, TE), RB and WR ones 8-12% less.

