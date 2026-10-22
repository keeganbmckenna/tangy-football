# Backtests

Checks behind the playoff odds and the Trades tab, run on this league's 2022-2025
seasons. Every script reads a local cache of Sleeper data, falling back to the completed
seasons archived in `data/sleeper/` (`scripts/archive_season.py`, refreshed each offseason
by `.github/workflows/archive-seasons.yml`), so the 2022-2025 backtests run without
fetching anything; `fetch_history.py` is only needed for the current season. Run
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
python stream_weight.py        # waiver pickups for empty/bye slots, with the projection weight re-fitted
python loso.py                 # leave-one-season-out check of the five parameters tuned on these seasons
python injuries.py             # official NFL injury reports (nflverse) vs who played and what they scored
python crawl_leagues.py        # collect other Sleeper leagues like ours (local cache, not committed)
python crawl_leagues.py --divisions --seed-from-cache --per-season 1000   # leagues in our exact format (12 teams, 3 divisions, 6 playoff teams) -> cache/leagues_div
python crawl_leagues.py --check-divisions  # per season: division leagues kept, and how many play our schedule exactly
python crawl_leagues.py --transactions     # weeks 1-18 of transactions (waivers, trades, FAAB) for every cached league -> cache/transactions
python crawl_leagues.py --histories        # earlier seasons of every cached league (previous_league_id, back to 2017) -> cache/history
python crawl_leagues.py --summary          # files per season in each cache folder, each read back
python leagues_fit.py          # the playoff model on those leagues
python player_weeks.py         # every rostered player-week of those leagues: projection, points, played, injury report (--check)
python brier_floor.py          # how low the playoff Brier can go: coin flip vs model vs perfect team strength
python strength_model.py       # fit team strength (lineup + points so far) and its uncertainty
python gpu_sim.py              # the same simulation on the GPU, every snapshot at once, with intervals (--check: matches the CPU)
python drift.py                # does team strength drift through the season? (GPU)
python schedule_luck.py        # how much the schedule decides, and the value of knowing it (GPU)
python rank_odds.py            # rank, wins, playoff and bye odds under our rules, scored without schedule luck (GPU)
python headroom.py             # how much better any team-strength model could do: a ceiling for the playoff odds (GPU)
python own_league.py           # the models fitted on crawled leagues, scored on our 2022-2025 seasons
python league_activity.py      # the fitted model's edge over the site's model by league activity (roster churn)
python eval_2026.py DIR        # after the 2026 season: score the saved predictions (PREREGISTRATION_2026.md)
```

Requires numpy (installed with pandas by `uv sync`); `gpu_sim.py` also needs PyTorch (with CUDA for speed).

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

- **Leave-one-season-out check** (`loso.py`): the five numbers tuned on 2022-2025 (projection
  weight 0.75, season share 0.5, padding games 3, win-odds spreads 0.8/2.0, live spread 0.7),
  each re-picked on three seasons and scored on the fourth. None should change:
  - *Season share and padding* can't be pinned down: re-picked on weekly team points, share
    ranged 0.25-1.0 and padding 6-10 across folds. The middle values stay.
  - *Projection weight*: weekly points prefer 0.4-0.5 in every fold, but those values made
    playoff odds clearly worse out of sample (Brier 0.1250 vs 0.1177, difference +0.0074,
    95% +0.0019 to +0.0134). 0.75 was chosen on the playoff outcomes the tab shows.
  - *Win-odds spreads* (lineup values as now): re-picked 0.5-0.6 next week and 1.4-1.8
    later, better in 2 of 4 seasons; overall log loss 0.6584 vs 0.6593 (-0.0009, 95% -0.0031
    to +0.0014). No scaling at all: 0.6639.
  - *Live spread*: re-picked 0.60-0.75; 0.7 scored best out of sample (0.5904, vs 0.5941
    for the picks and 0.5988 with no scaling).
  - With no fitting at all (Sleeper projections at face value, no scaling), playoff Brier
    was 0.1207 vs 0.1177 for the current values (+0.0031, 95% -0.0028 to +0.0091) and
    single games clearly worse (log loss 0.6764 vs 0.6593).
  The current values were chosen on these same seasons, so their scores here are slightly
  optimistic; 2026, untouched by any tuning, is the clean test.

- **Waiver pickups for holes, re-checked** (`stream_weight.py`, `streaming.py`'s `empty`):
  managers here do cover byes and injuries. In 2022-2025's real lineups, 13 of 672
  team-weeks started an empty slot or a player on bye (2%), and 41 of 48 team-seasons never
  did. Yet filling a hole (or only a bye-week hole) with the best free agent still scored
  worse on playoff odds, even with the projection weight re-picked out of sample for each
  rule: Brier 0.1200 vs 0.1156 (+0.0044, 95% -0.0001 to +0.0095), worse in 3 of 4 seasons.
  Without the re-fit, filling only holes (no K/DEF streaming) was +0.0041 (95% +0.0023 to
  +0.0060); K/DEF streaming alone was neutral. The playoff odds keep holes at 0. Side
  finding, not acted on (to test after 2026, per the preregistration): picked on playoff
  Brier, the projection weight comes out 0.9-1.0 in every fold, not 0.75.

- **Official injury reports** (`injuries.py`): nflverse's weekly reports for 2022-2025 (6,941
  QB/RB/WR/TE/K rows, all matched to Sleeper through DynastyProcess's ID table), against
  Sleeper's stats and pre-game projections. Of players listed **Doubtful, 0 of 134 played**
  (the Live tab counts 30% of a doubtful player's projection before kickoff); Out, 1 of 937.
  **Questionable** players played 73% of the time and scored 0.89 of their pre-game
  projection (95% 0.84-0.94), against 0.98 for players not on the report; the model counts
  them in full. Players who played last week and are on this week's report played 81%
  (Questionable 79%). Among players missing games for any reason, 52%, 30%, 22% and 19%
  played after missing 1, 2, 3 and 4+; not comparable to the model's return rates, which
  only cover injuries Sleeper projects to end.

- **Other leagues** (`crawl_leagues.py`, `leagues_fit.py`): 2,025 redraft league-seasons like
  ours, 2018-2025 (about 300 a season for 2018-2021, 200 for 2022-2025; found through
  dezdroppedit27's and our managers' leagues and league histories; Sleeper's projections
  start in 2018 and are equally predictive every season, correlation 0.52-0.56 with actual
  points). Playoff odds from weeks 4, 7 and 10 (6,075 snapshots), intervals resampling
  leagues:
  - **The projection weight should be much lower.** Brier 0.1525 at 0.3 vs 0.1604 at 0.75
    (the site's), 0.1674 at 1.0; 0.2 and 0.1 are worse again. Better than 0.75 in all 8
    seasons; picked out of sample (leave one season out) it's 0.3 every time, scoring
    0.1525 vs 0.1604. The best weight rises through the season: 0.2-0.3 from week 4, 0.3
    from week 7, 0.4-0.5 from week 10. Projected gaps between teams regress most of the way
    to the mean.
  - **Persistent team uncertainty** (one random offset per team per simulated season) helps
    at 0.75 (sd 15: 0.1564) but doesn't replace the lower weight.
  - **Projection-only values and bye-week waiver fill** each help at 0.75 (0.1599, 0.1593)
    and in all 8 seasons, but little once the weight is lower (projection-only with fill at
    0.4: 0.1528, vs 0.1525 for the blend at 0.3).
  - The same in the most, middle and least active thirds of leagues; our league sits in the
    most active third, whose best was projection-only with fill at 0.4.
  Our league alone pointed to 0.9-1.0 on 48 team-seasons; against 2,025 league-seasons that
  is most likely noise. The site is unchanged for now (see PREREGISTRATION_2026.md).

- **How low can the Brier go?** (`brier_floor.py`, `strength_model.py`, the 2,025 crawled
  league-seasons, weeks 4/7/10). With every remaining game a coin flip (standings only):
  0.200/0.159/0.116 (0.158 overall). The site's lineup model at 0.75: 0.205/0.164/0.112
  (0.160), no better than the coin flip. Knowing each team's actual rest-of-season average
  (unknowable, the floor for any strength model, since weekly swings stay random):
  0.110/0.093/0.072 (0.092). A Brier near 0.10 needs nearly perfect team strength; the
  number mostly measures how much season is left.
  - **Team strength fitted directly** on 68,784 team-snapshots: projected lineup and points
    per game so far each explain about as much of a team's rest-of-season scoring (week 10:
    R^2 0.26 each, 0.34 together; coefficients about 0.35-0.39 on the lineup and 0.18-0.48 on
    points per game, the latter rising through the season). Simulated with the uncertainty
    the fit leaves (sd about 10 points a week at week 4, 9.5 at week 7, 7.8 at week 10,
    measured from training residuals beyond weekly noise, the same in every fold), out of
    sample: **0.194/0.152/0.109 (0.152)**, the best of everything tried; without that
    uncertainty the fitted means are overconfident (0.154).

- **More leagues, cleaned, on the GPU** (`crawl_leagues.py`, `gpu_sim.py`): the crawl now has
  7,385 league-seasons (about 1,000 a season 2019-2025; 2018 ran out at 353). League-seasons
  where more than 10% of team-weeks scored 0 (teams that started nobody; 73, 1%) are dropped
  (`leagues_fit.played`); the results are the same at 5%, 30% or keeping them. On 21,928
  snapshots, 10,000 simulated seasons each, out of sample: coin flip 0.1599, lineup 0.3
  0.1553, **fitted + tau 0.1544**; fitted + tau beats lineup 0.3 by 0.0009 (95% 0.0007 to
  0.0011), better in 7 of 8 seasons, tied at week 4. Coefficients and tau barely moved
  (tau about 9.4/9.0/7.5). `gpu_sim.py --check` feeds the CPU simulator the same random
  draws and matches it to 1e-16; the whole table with intervals takes 13s instead of about 6
  minutes. With 1,000 simulated seasons every Brier carries about +0.00015 of simulation
  noise (p(1-p)/1000), the same for every model; 10,000 brings it to 0.00002.
- **Calibration** (exploratory): fitted + tau's playoff odds are calibrated (Brier
  reliability term 0.0000-0.0001, calibration slope 0.96), so what's left is resolution:
  knowing team strength better, not reshaping the odds.
- **Drift** (`drift.py`): weekly residuals' covariance falls with the gap between weeks
  (strength changes during a season). Measured on training residuals, not tuned: an AR(1)
  drift (fixed part about 8 + drifting part about 9 points, week-to-week correlation
  0.56-0.73) or a random walk (7.5 + about 4 points a week). Both beat the current fixed
  offset in 8 of 8 seasons, but by 0.0001 (95% 0.00007 to 0.00013), and half of that is the
  measurement method (a fixed offset measured the same way: 0.00005). Drift alone: 0.00005,
  about 1% of the fitted model's gain over the coin flip. It passes the rule set before the
  run (which had no minimum size); too small to be worth adding to the site on its own, but
  the state-space strength model should let strength drift.
- **Schedule luck** (`schedule_luck.py`): 99% of the crawled leagues' schedules are round
  robins (everyone once before anyone twice). Replaying each league's actual weekly scores
  under 1,000 random round robins, the schedule alone could change the playoff fate of 70%
  of teams (5-95%); 8.3% made it on their real schedule though they'd miss on most, 8.9%
  missed though they'd make it on most. With every score known, the schedule still leaves a
  playoff Brier of 0.120. Knowing the real remaining schedule improves the forecast a little:
  0.0003 (95% 0.0002 to 0.0004), 8 of 8 seasons, 0.0006 at week 10, so the site keeps
  simulating the real schedule.
- **Our rules, without schedule luck** (`rank_odds.py`): every league scored under our rules
  (head-to-head wins only, then points; top 6 make the playoffs, top 2 get byes), on
  playoff and bye Brier and on the full distributions of final rank (ranked probability
  score) and wins (CRPS). Development target: actual remaining scores averaged over random
  round robins, against forecasts made without the schedule (an exact expected score, same
  ranking of models in expectation). It narrows intervals 1.3-2.0x (worth about 2-4 times the
  leagues) and agrees with the real-schedule check. Fitted + tau is best on all four, in both:
  real schedule playoff Brier 0.1555 vs 0.1564 (lineup 0.3) vs 0.1611 (coin flip); vs lineup
  0.3 -0.0009 [-0.0011, -0.0006], bye -0.0002 [-0.0004, -0.0001], rank RPS -0.0006
  [-0.0008, -0.0005], wins CRPS -0.024 [-0.026, -0.023] wins (8 of 8 seasons). Still tied at
  week 4. 10,000 round robins per target instead of 2,000 change nothing (the target's
  noise cancels in the scoring).
- **Every week, our league's rules** (`rank_odds.py --weekly --rules ours`; the primary score
  preregistered on 2026-10-21): a snapshot every week from 3 to the end of the regular season,
  12-team leagues (4,488), 3 random divisions with division winners seeded first (our league
  has used divisions since 2024: rivals twice, the other 8 once), real schedules. Playoff
  Brier pooled over weeks: coin flip 0.1420, site (lineup 0.75) 0.1432, lineup 0.3 0.1378,
  **fitted + tau 0.1371**; fitted + tau beats the site by 0.0062 (95% 0.0059 to 0.0065, 8 of
  8 seasons) and lineup 0.3 by 0.00075 (0.00053 to 0.00098, 7 of 8), and is best or tied at
  every week (week 3: 0.214 vs 0.220 for a coin flip; week 10: 0.117 vs 0.122; week 13:
  0.067 vs 0.069). The site's model is worse than a coin flip through week 8. Without
  divisions the numbers are within 0.0003 of these.
- **Headroom** (`headroom.py`, 12-team leagues, every week): a team's rest-of-season average
  splits into what the fitted model explains (24% of its variance), current strength it
  misses but could know (13%), change still to come (8%: injuries, trades) and weekly luck
  (56%). The model captures about two thirds of the knowable part. In a simulated world
  where the missed strength is real (fair to within 0.003 Brier: the real world is slightly
  noisier), knowing every team's current strength would lower the pooled playoff Brier from
  0.1368 to about 0.124. That's a gain of 0.013, against 0.0049 gained so far over a coin flip,
  almost all of it in weeks 3-10 (0.030 at week 3, 0.007 at week 10, nothing after week 12).
  Knowing future changes too: 0.114. So better team strength is worth pursuing, mostly for
  early-season odds; no strength model can get far below 0.12 on these leagues.
- **Our own league** (`own_league.py`, 2022-2025, every week from 3, our real divisions; the
  rebuilt playoff teams match the real brackets in all 4 seasons). Fitted on crawled leagues
  only: playoff Brier coin flip 0.145, site (0.75) 0.125, lineup 0.3 0.132, fitted + tau
  0.126. Fitted + tau beats the coin flip and lineup 0.3 here too but not the site's model
  (+0.0014; better in 1 of 4 seasons), whose settings were chosen on these same seasons.
  Among crawled 12-team leagues, 4 league-seasons that unfavourable to the fitted model turn
  up about 5% of the time (per league-season difference: mean -0.0062, sd 0.0095).
  **Activity doesn't explain it** (`league_activity.py`): our league is among the most active
  (roster churn 1.75-2.46 players added per team per week, 66th-93rd percentile), and the
  fitted model's edge over the site is the same in every fifth of activity (-0.0058 to
  -0.0068, most active fifth -0.0064 [-0.0075, -0.0053]).

