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

Projections are always the ones known at the time: the week after the cutoff, carried
forward with each NFL team's bye weeks. Sleeper's archived projections for later weeks
were made just before those games, which would leak information.
