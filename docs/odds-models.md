# Odds models

How the site turns rosters, projections and results into probabilities, and the evidence for
each choice. All of it was fitted and tested out of sample on thousands of other Sleeper
leagues (2018-2025), then checked on this league's own seasons. The research, scripts and full
results are in [`scripts/backtests/`](../scripts/backtests/README.md).

| Odds | Model | Code |
|---|---|---|
| Playoff, division, bye, seed, title and toilet-bowl odds | Fitted team strength with persistent uncertainty, simulated 20,000 times | `fittedStrength`, `simulatePlayoffOdds` in `web/lib/analyze/playoffOdds.ts` |
| Trade tools' season odds | The same, with a trade's lineup change at the fitted lineup weight | `meansAfterTrade`, `tradeSeasonOdds` in `web/lib/analyze/trade.ts` |
| Trade tools' weekly win odds | Single-game model fitted for one week's score | `singleGameModel` in `playoffOdds.ts` |
| Live tab win odds | Starters' remaining projections, game clocks, boom-or-bust spreads, injuries | `web/lib/analyze/live.ts` |

The fitted weights live in [`web/lib/analyze/strengthModel.json`](../web/lib/analyze/strengthModel.json),
written by `scripts/backtests/export_model.py`.

## Player values

Each player is worth half his Sleeper projection for the week and half his points per game this
season, padded with 3 games of projection so a game or two can't swing it (`playerValue`). A
player on a bye or ruled out is worth nothing that week; one who is out is discounted in later
weeks by his chance of being back (`web/lib/analyze/availability.ts`). A team's projected lineup
is its best lineup of those values.

## Playoff odds

For a snapshot week *e* (the first week not yet played), a team's expected weekly score is

```
league average so far
  + lineup(e) x (its projected lineup, averaged over the remaining weeks, minus the league's)
  + ppg(e)    x (its points per game so far, minus the league's)
```

the same in every remaining week, playoff rounds included. The weights are fitted separately for
every week of the season: the lineup weight is about 0.3-0.5 for most of the season (higher in
the last week or two), and the points-per-game weight rises from about 0.1 in week 3 to about
0.5 late in the season. Weeks 1-2 use week 3's weights.

Each simulated season also draws one random offset per team, sd *tau(e)* (about 8.7 points early,
falling to 0 in the last week): the uncertainty the fit leaves in a team's true strength,
measured from the fit's residuals rather than tuned. Each week adds normal noise with the
league's pooled week-to-week spread (at least 15 points). Seeding follows Sleeper: division
winners first by record, then wild cards; ties on record go to points for. The playoff bracket
and toilet bowl are played out in the same simulation.

**Evidence** (`rank_odds.py --weekly --rules ours`; 4,486 crawled 12-team leagues, every week
from 3, this league's rules, real schedules, each season predicted by a model fitted on the
others):

| Model | Playoff Brier | Title Brier |
|---|---|---|
| Coin flip for every remaining game | 0.1420 | 0.0718 |
| Earlier model (75% of the lineup gap) | 0.1432 | 0.0726 |
| **Fitted model** | **0.1371** | **0.0712** |

The fitted model beats the earlier one by 0.0062 (95% 0.0059 to 0.0065) in 8 of 8 seasons, at
every week of the season. Its odds are calibrated on the crawled leagues (teams given 30% made the
playoffs 31% of the time, 50% made it 50%, 88% made it 87%). On this league's own 2022-2025 seasons it ties the earlier
model, whose settings were chosen on those seasons (`own_league.py`).

**Headroom** (`headroom.py`): of the spread in teams' rest-of-season scoring, the model explains
24%, misses 13% that could in principle be known, and the rest is change still to come (8%) and
weekly luck (56%). No team-strength model can get far below about 0.12 on these leagues.

**Odds week by week** (`web/lib/oddsHistory.ts`): the Playoffs tab's chart re-runs this model as
of the draft and after every completed week, with only what was known then: the drafted rosters
(then each week's), records and scores so far, season production so far, and that week's
projections carried forward with byes. Past injury statuses aren't kept, so earlier points don't
discount injured players.

## Single-game win odds (trade tools)

A team's score in a week *h* weeks ahead is modelled directly: a weight on that week's lineup gap
(about 0.8 next week, when byes, injuries and pickups are already in the lineup; about 0.3 later)
plus a weight on the points-per-game gap, with that week's residual spread (about 23 points).
Fitted per snapshot week and horizon.

**Evidence** (`single_games.py`, 1.1 million games): better than the earlier odds next week
(Brier -0.0007, 6 of 8 seasons) and 2-4 weeks ahead (-0.0034, 8 of 8). The playoff model's
strengths, built for season averages, were worse than the earlier odds for next week's game.

## Trades

A trade moves each team's expected score by the model's weight on its change in projected
lineup: the fitted lineup weight on the change averaged over the remaining weeks for season odds,
and each week's single-game weight for weekly win odds.

**Evidence** (`trades.py`, 28,899 teams in two-way trades): a trade's projected change showed up
at 0.43 of its size (95% 0.40 to 0.46), in line with the fitted lineup weight week by week. The
earlier tools used 0.75, overstating trades by about 70%.

## Live tab

Each starter still to play adds his Sleeper projection for the share of his NFL game left, with
a chance of overtime when a game is close late. Before kickoff, players ruled out or Doubtful
count for nothing and Questionable ones for 90% of their projection: no Doubtful player played
(0 of 134) and Questionable players scored 0.89 of their projection (95% 0.84 to 0.94), in NFL
injury reports from 2022-2025 (`injuries.py`). The uncertainty sums the starters' boom-or-bust
spreads, scaled so a whole game matches 0.7 of the league's weekly spread, which was well
calibrated at kickoff (`live_pregame.py`).

**Win history** (`web/scripts/build-win-history.ts`): the same model replayed through each
finished week from nflverse play-by-play, every 3 minutes of game time on each game's real
clock, with each starter's replayed points ending at his official total. Past injury reports
come from nflverse. During the week, the odds the site computes live are saved instead
(`web/lib/liveHistory.ts`).

## Views built on these models

- **Power rankings** (`strengthRanks` in `playoffOdds.ts`): teams ranked by the fitted model's
  expected weekly score. The 80% range on each rank comes from drawing every team's strength
  as mean + tau × z and re-ranking, so it shows how sure the model is, not a separate model.
- **What If** (`simulatePlayoffOdds` with `forced`): the playoff simulation with picked results
  held fixed (the picked team gets the higher of the two drawn scores), run in the browser
  against the same random draws without the picks.
- **Games Ahead**: the single-game model's win odds for every remaining game.

## Tested and not used

Each of these was real or plausible, and each was below the 0.0005 bar for leagues like ours
(details in [`LOG.md`](../scripts/backtests/LOG.md)): team strength that drifts week to week;
heavier-tailed or shrunk weekly noise; recency-weighted, median and last-3-week form; nonlinear
terms; per-team uncertainty; projection-only player values; streaming from waivers; bench depth;
roster activity and managers' track records (they help only by spotting abandoned teams, which
an active league like ours doesn't have); and correlated players such as QB-WR stacks
(+0.29 correlation, but no effect on kickoff win odds).

## Changing a model

1. Test the change with the harness in `scripts/backtests/` against the rule in
   [`PREREGISTRATION_2026.md`](../scripts/backtests/PREREGISTRATION_2026.md), and add it to
   `LOG.md` whatever the result.
2. Refit and export: `python export_model.py --fixture`.
3. Port it to `web/lib/analyze/`; `playoffOdds.test.ts` checks the TypeScript simulator against
   the Python reference on two real snapshots.
4. Bump the affected API route's `CACHE_VERSION`, and log the shipped change with its date in the
   preregistration.

## Evaluation in 2026

The `Prediction log` workflow saves the site's odds before kickoffs and on Wednesdays to the
`prediction-log` branch, logging the earlier model's odds alongside the current ones. After the
season, `scripts/backtests/eval_2026.py` scores both on 2026, and the frozen models are scored
once on newly crawled 2026 leagues, as preregistered.
