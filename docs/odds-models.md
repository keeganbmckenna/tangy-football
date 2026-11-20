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
| Trade history (odds at the time, hindsight) | The playoff model re-run as of each trade, before and after; starters' points over a waiver pickup | `web/lib/tradeHistory.ts` |

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
every week of the season: the lineup weight is about 0.35-0.45 for most of the season (about 0.55
in weeks 12-13 and 0.84 in the last week), and the points-per-game weight rises from about 0.1 in week 3 to about
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
| Earlier model (75% of the lineup gap) | 0.1414 | 0.0721 |
| **Fitted model** | **0.1369** | **0.0711** |

The fitted model beats the earlier one by 0.0046 (95% 0.0043 to 0.0048) in 8 of 8 seasons, and
on title (-0.0010) and last-place odds (-0.0020), also 8 of 8 (`title_odds.py`). On this league's
own 2022-2025 seasons (the Playoffs tab's odds history) its playoff Brier is 0.1389.

**Headroom** (`headroom.py`): of the spread in teams' rest-of-season scoring, the model explains
24%, misses 13% that could in principle be known, and the rest is change still to come (8%) and
weekly luck (56%). No team-strength model can get far below about 0.12 on these leagues.

**Odds week by week** (`web/lib/oddsHistory.ts`): the Playoffs tab's chart re-runs this model as
of the draft and after every completed week, with only what was known then: the drafted rosters
(then each week's), records and scores so far, season production so far, and that week's
projections carried forward with byes (a player on bye that week goes by the following week's
projection). Past injury statuses aren't kept, so earlier points don't discount injured players.
The trade history's "at the time" odds (`web/lib/tradeHistory.ts`) and the backtests the model is
fitted on (`leagues_fit.table`) work the same way.

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
lineup: the fitted lineup weight on the change averaged over the remaining regular-season weeks
(and, in the playoff weeks, on the change averaged over the playoff weeks) for season odds, and
each week's single-game weight for weekly win odds. The change includes the roster moves the
trade forces: dropping the least useful player when over the limit, picking up the best free
agent for an opened spot.

**Evidence** (`trades.py`, 28,899 teams in two-way trades): a trade's projected change showed up
at 0.43 of its size (95% 0.40 to 0.46), in line with the fitted lineup weight week by week. The
naive weight of 0.75 would overstate trades by about 70%.

**Forced moves and waivers** (`trade_waivers.py`, 28,913 teams): counting the forced drops and
pickups predicted traded teams' later scoring better than the bare swap (squared error -0.21
[-0.33, -0.09], 8 of 8 seasons; playoff Brier -0.00013). Measuring each roster at its best with
waiver moves instead (up to two free-agent swaps, and byes or injuries covered by the best free
agent each week) predicted *worse* (+0.28 [+0.14, +0.42] vs forced moves, 0 of 8 seasons;
playoff Brier +0.00014), so it isn't used. Playoff weeks: the change over the playoff weeks
predicted traded teams' playoff-week scores better than the regular-season change (-0.40
[-0.69, -0.12], 6 of 8), so title and last-place odds use it.

**Change over waiver replacement** (`trades_repl.py`, 28,913 trading teams, rule set before the
run): measuring a trade's lineup change with the best free agents (top 3 per position) added to
both rosters, so a player counts only for his edge over the waiver wire, shrinks the typical
change (median |change| 1.76 vs 2.70 points a week, correlation 0.83) and its fitted weight rises
to 0.68 (vs 0.43), but playoff Brier is no better (+0.00005 [-0.00002, +0.00011]). Not used: the
fitted 0.43 already absorbs the backfilling, and the assumption that a team actually picks up
that free agent often fails.

**Trade history** (`web/lib/tradeHistory.ts`): each past trade is graded two ways.
- *At the time*: the season odds just before and just after it, with only what was known then
  (the week's rosters, results so far, that week's projections carried forward as in Odds week
  by week), 10,000 simulations with the same random draws before and after, so the difference is
  the trade, not simulation noise. The same run gives every other team's change: playoff spots
  are zero-sum, so the teams in a trade gain or lose them from everyone else. Effects on teams
  outside a trade are small (most under half a point; the largest seen 1.8 points).
- *In hindsight*: what each received player scored in the new team's starting lineup, and that
  over a waiver pickup (each start minus the mean actual points of the 3 best-projected free
  agents at his position that week, so the pickup isn't chosen with hindsight). A player counts
  only while he stays: through the week he's dropped or traded away, or the week before the team
  reacquires him. Waiver pickups on the Rosters tab are credited the same way, once per stint.

## Live tab

Each starter still to play adds his Sleeper projection for the share of his NFL game left, with
a chance of overtime when a game is close late. Before kickoff, players ruled out or Doubtful
count for nothing and Questionable ones for 90% of their projection: no Doubtful player played
(0 of 134) and Questionable players scored 0.89 of their projection (95% 0.84 to 0.94), in NFL
injury reports from 2022-2025 (`injuries.py`). The uncertainty sums the starters' boom-or-bust
spreads, scaled so a whole game matches the league's week-to-week spread.

As one team runs out of players to play, a normal curve misleads: it puts real odds on the other
team's players losing points, which almost never happens. So as the smaller side's share of the
remaining variance falls from 5% to 1%, the odds blend gradually into each player's real
distribution of points still to come (no cutoffs, so they don't jump when it takes over)
(`remainingPointsOdds`, tables in `web/lib/analyze/remainingPoints.json` from
`scripts/backtests/live_sim.py`, 2020-2025, by position, half-PPR projection in 8 bands and share
of game left): often a lot, often nothing, rarely negative. The low bands are fine-grained
because a receiver projected 7 scores nothing only 7-12% of the time, far less than one projected
2. A top
receiver with half his game left ended 0.61+ points down in none of 14,283 cases, so a team up
0.61 with him left and its opponent done is above 99%, not the normal's 92%.

**Evidence** (`live_replay.py`, `live_eval.py`; the preregistered live addendum): the site's
model, ported to PyTorch and checked against this code, replayed every 3 minutes of game time
through 364,672 matchups of crawled 12-team leagues (2018-2025), scored by log loss averaged
over each matchup's week. The spread scale is 1.0, fitted on 2022-2025 (whose projections are
like Sleeper's today); a narrower 0.7 was overconfident at every stage, with final margins
1.4-1.5x the model's spread, and 1.0 lowers log loss in all 8 held-out seasons (by 0.004 to
0.06). Tested and not adopted: a spread that changes with the time left,
skewed scoring, a weight on the projections, scoring that speeds up late in games, per-player
variance growing with the projection rather than its square (real, but 0.0002-0.0027), a
heavier-tailed link, in-game injury flags, Vegas lines, game state and correlated players (each
under 0.002), and Kalshi's player props (in-game prices trail plays by about 47 seconds and add
almost nothing). The player-based blend above: more accurate overall in every season 2020-2025
(up to 0.002) and 7-14% in one-sided close moments; worse in 2018-2019, when projections were
weak, so it was judged on 2020-2025 (logged as a deviation) and the 2026 check confirms or removes
it. A late-game drive model (nflfastR's touchdown and field-goal chances in a game's last
minutes) beat the plain normal where a final drive decided a matchup, but added on top of the
player blend it made those moments worse, so it was dropped.

**Win history** (`web/scripts/build-win-history.ts`): the same model replayed through each
finished week from nflverse play-by-play, every 3 minutes of game time on each game's real
clock, with each starter's replayed points ending at his official total. Past injury reports
come from nflverse. During the week, the odds the site computes live are saved instead
(`web/lib/liveHistory.ts`).

## Views built on these models

- **Power rankings** (`strengthRanks` in `playoffOdds.ts`): teams ranked by the fitted model's
  expected weekly score. The 80% range on each rank comes from drawing every team's strength
  as mean + tau × z and re-ranking. Its tau (`rankTau`, about 9 points all season) is measured
  over every remaining week including the playoffs (`tau_playoffs.py`): the odds' own tau is
  measured over the regular season only and falls to 0 by week 14, when one game left can't
  separate strength from noise, which would collapse every range to a single rank.
- **What If** (`simulatePlayoffOdds` with `forced`): the playoff simulation with picked results
  held fixed (both scores redrawn until the picked team wins, so points-for tiebreaks stay
  realistic), run in the browser
  against the same random draws without the picks.
- **Games Ahead**: the single-game model's win odds for every remaining game.
- **The week being played** (`lib/liveWeek.ts`): once its first NFL game kicks off, its games
  use the Live tab's odds everywhere above and in the trade tools. `simulatePlayoffOdds` takes
  them as `live` (each game's projected finals, margin spread and win chance): a's share of the
  runs is its live chance (the margin drawn around the z that gives it), and points around the
  projected finals. `/api/playoff-odds` returns that run as `live`, leaving `odds` and `gameOdds`
  as the before-kickoff models the 2026 evaluation logs. In the trade tools (`model.live` from
  `/api/trade-data`), a trade or pickup moves a team's projected final by its lineup change among
  players still to play (`liveLineupChange`): a player whose game has started stays on his team,
  with his points, until next week (Sleeper's rule), and started players in a lineup stay in it.

## Tested and not used

Each of these was real or plausible, and each was below the 0.0005 bar for leagues like ours
(details in [`LOG.md`](../scripts/backtests/LOG.md)): team strength that drifts week to week;
heavier-tailed or shrunk weekly noise; recency-weighted, median and last-3-week form; nonlinear
terms; per-team uncertainty; projection-only player values; streaming from waivers; bench depth;
roster activity and managers' track records (they help only by spotting abandoned teams, which
an active league like ours doesn't have); and correlated players such as QB-WR stacks
(+0.29 correlation, but no effect on kickoff win odds). For the Live tab, see its section.

**FAAB bids** (research, not on the site): a model of the highest other bid on a player
(`faab_model.py`, 507,460 bids in 2,997 FAAB league-seasons, fit 2018-2023, test 2024-2025) beats
simple baselines (log loss 0.678 vs 0.696-0.702), and Sleeper's trending adds as the crowd
signal bring it to 0.662. But the chance of winning at the bid actually placed stays
overconfident for big bids (over 20% of budget: 86% predicted, 65% won), because high bidders
know about demand the public data doesn't show, so win chances aren't shown. Details in
`LOG.md`.

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
