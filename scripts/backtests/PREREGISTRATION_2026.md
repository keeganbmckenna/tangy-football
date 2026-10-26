# 2026 out-of-sample evaluation: preregistration

Written on 2026-10-20, before week 7 kicks off. Every parameter in the model was set using
2022-2025 (and weeks 1-6 of 2026 for nothing but bug fixes), so weeks 7-14 of 2026 are the
first data no tuning has touched. This fixes, in advance, what will be scored and how the
results will be used. Changes after the first snapshot are limited to bug fixes, each logged
at the bottom with its date.

## Model under test

The deployed site as of main commit `3b4da99` (the commit hash identifies it; a tag such as `model-2026-w7` can be added on GitHub): the playoff model with
player values half projection, half season points per game (padded with 3 games of
projection), a team's expected score at the league average plus 0.75 of its best lineup's
distance from the league's, single-game spreads of 0.8x the weekly spread next week and 2x
later, the Live tab's whole-game spread of 0.7x, injured players discounted by their measured
return rates (including, new this week, players ruled out after playing their last game, and
this week's game for anyone ruled out), and no streaming from waivers (`streaming.py` found it
no better).

## Data

- **As deployed:** `.github/workflows/prediction-log.yml` saves the site's playoff odds, trade
  data (expected scores per week, spread, every rostered player's injury status and values) and
  Live inputs on Wednesdays after scoring and before the Thursday, Sunday and Monday kickoffs,
  to the `prediction-log` branch. Missed or failed runs are reported as missing, not
  backfilled.
- **Archive replay:** at season end, `fetch_history.py` caches 2026, and the existing backtests
  run on it unchanged except for including 2026 (`live_pregame.py` skips 2026 today; that line
  is removed). Sleeper's archived projections are pre-game, but its injury statuses are as of
  when they're fetched, so injury questions use the as-deployed data only.

## Questions and analyses (`eval_2026.py` unless noted)

Primary:

1. **P1, playoff odds.** Brier score (and log loss) of each Wednesday snapshot's playoff odds,
   weeks 7-14, all 12 teams, against who made the playoffs. Compared with (a) the same
   simulator with every remaining game a coin flip and (b) the 2022-2025 out-of-sample range
   (Brier 0.078-0.148 by season, 0.1177 overall). Calibration table and slope.
   *Expected:* better than coin-flip-the-rest and inside the 2022-2025 range.

Secondary:

2. **P2, single games.** Log loss of next week's game win odds from the Wednesday snapshots
   (about 48 games). *Expected:* about 0.66 (2022-2025), below 0.693 (coin flip).
3. **P3, Live odds at kickoff.** `live_pregame.py` on 2026 at the fixed 0.7 scale (archive
   replay). *Expected:* about 0.59 (2022-2025).
4. **H1, the injury fix.** For players ruled out in a Wednesday snapshot whose team plays
   that week: did he play? Brier of the model's play rates (76% for one hurt in his last game
   or out one game; 40%, 38%, 48% after more; none from IR before 4 games) against the old
   behavior (full value this week whenever Sleeper still projected him), pooled over all
   groups, with a 95% interval resampling players. About 30 such players a week, so roughly
   240 player-weeks; the hurt-in-his-last-game group alone (about 1 a week) is too small to
   judge by itself and is reported descriptively.

## Decision rules

- **Model as is:** kept if P1 beats coin-flip-the-rest and falls inside the 2022-2025 range.
  If it's worse than the worst 2022-2025 season (0.148), look for a cause before changing
  anything; one season is weak evidence.
- **Injury fix:** kept unless the pooled Brier difference is positive with its 95% interval
  above zero.
- **Any change for 2027:** must pass leave-one-season-out on 2022-2026 (five seasons): better
  on a proper scoring rule held out, 95% interval (clustered by team-season) excluding zero,
  and better in at least 3 of 5 held-out seasons. Otherwise the simpler model stays.
- **Not allowed:** re-tuning on 2026 before this analysis is run, adding analyses after seeing
  results without labeling them exploratory, or dropping weeks.

## Known limitations

- One season, 12 teams: P1 rests on 12 playoff outcomes seen from 8 weeks, so its interval
  will be wide. It can flag a broken model, not fine-tune a working one.
- Wednesday snapshots come after waivers but before late-week injury news; Live odds at
  kickoff (P3) cover that.
- GitHub can start scheduled runs late; a Sunday snapshot that lands after 1 PM ET kickoff is
  excluded from anything about kickoff.

## Addendum (2026-10-21): rules for a better simulator, set before its every-week results

The model research (`README.md`, `HANDOFF.md`) moves to building the most accurate simulator
for every odds the site shows. The owner chose to ship each improvement as soon as it is
proven, logged below with its date; the questions above (P1-P3, H1) are still scored on the
deployed model as of each Wednesday snapshot, and `eval_2026.py` scores old against new.

- **Primary score** (weeks 4, 7 and 10 had already been studied; every other week had not):
  playoff Brier on the crawled leagues with 12 teams, under our rules (3 divisions of 4,
  assigned at random in the crawled leagues; head-to-head wins, then points for; the
  division winners and 3 wildcards make the playoffs, division winners seeded 1-3, top 2
  get byes), on real schedules (`rank_odds.py --weekly --rules ours`), from a snapshot every week from week 3 to the end of the regular season (week
  3 is the first with a weekly spread to measure), leave one season out on 2018-2025.
- **Secondary:** bye Brier, final rank (ranked probability score), wins (CRPS), playoff
  Brier pooled over all league sizes and with each league's own playoff size, title and
  toilet bowl, single games and Live at kickoff (log loss), calibration slope.
- **A change is adopted only if** it beats the model it would replace on the primary score
  held out, with a 95% interval resampling leagues (checked again resampling groups of
  leagues that share managers) excluding zero, in at least 5 of 8 seasons, **and by at
  least 0.0005 Brier**. Otherwise the simpler model stays. Development may use the
  schedule-averaged targets (`rank_odds.py`); the decision uses real schedules.
- **One-shot confirmation:** after the 2026 season, 2026 leagues are crawled with the same
  rules (`crawl_leagues.py --seasons 2026`) and the adopted model, frozen, is scored on them
  once. Nothing is tuned on 2026 before that.
- **Own league:** each candidate is also scored on our 2022-2025 seasons, which are not in
  the crawl (fitted on crawled leagues only); reported with intervals, never tuned on.
- Every variant tried goes in `LOG.md`, failures included.
- Drafted the same day without divisions; corrected on finding that our league has used 3
  divisions since 2024 (2026 too). Both versions are run and reported; they agree.

## Addendum (2026-10-26): rules for improving the live win odds, set before any results

The Live tab's win odds (`liveWinOdds`, web/lib/analyze/live.ts) are replayed through every
finished week from nflverse play-by-play (scripts/build_play_timelines.py,
web/scripts/build-win-history.ts). These rules are fixed before any variant is fitted.

- **Data.** Exploratory diagnostics on this league's 2022-2026 replays (about 440 matchups):
  used to choose what to test, never to fit or to decide. Fitting and evaluation on crawled
  12-team leagues 2018-2025, replayed the same way, this league excluded. Crawled 2026
  leagues are a one-shot confirmation after the season.
- **Primary score.** Log loss of the live odds, averaged over each matchup's game time (a
  sample every 3 minutes while games are on), each matchup weighted equally; decided
  matchups only. Secondary: the same by stage of the week (kickoff, then quarters of the
  week's game time), Brier, and the calibration slope (logistic regression of the outcome on
  the odds' log-odds).
- **Adoption.** A variant replaces the current model only if, predicting each season from a
  fit on the other seasons, it lowers the primary score by at least 0.002, with a 95%
  interval resampling leagues that excludes zero, in at least 6 of 8 seasons. Ties go to the
  simpler model. Variants are tried in order of complexity: recalibrating the spread by time
  left, correcting the projections' skew, a game-clock production curve, game state
  (score, possession, field position), correlated players, and player-level simulation.
- **No tuning on 2026 data** before the season's confirmation.

## Log of changes after the first snapshot

- 2026-10-20: snapshots before kickoffs also save Sleeper's full projection file (every player's
  injury status at the time), for future injury backtests. Data collection only; no analysis
  above changes.
- 2026-10-22, before any week-7 game: **the fitted model ships and becomes the model under
  test.** The site's playoff odds now use `fittedStrength` (web/lib/analyze/playoffOdds.ts:
  lineup and points-per-game weights and a persistent team spread per snapshot week, fitted
  on 2018-2025 crawled 12-team leagues by scripts/backtests/export_model.py; no 2026 data
  used), adopted under the addendum's rule (rank_odds.py --weekly --rules ours: -0.0062 vs the
  earlier model, 8 of 8 seasons). Frozen as of the commit that adds this entry.
  - **P1 becomes a head-to-head.** Every playoff-odds snapshot from deploy on logs both
    models: `odds` (fitted) and `previousModel` (the earlier model above, unchanged). Scored
    on weeks 7-14: playoff Brier of each and the difference, with an interval resampling
    teams. Snapshots before deploy have the earlier model only and are scored as before.
    Twelve teams over eight weeks is weak evidence; no decision rests on it alone.
  - **The confirmatory test** is the addendum's one-shot crawl of 2026 leagues after the
    season, on this frozen model.
  - P2 (single games), P3 (Live) and H1 (injury fix) are unchanged: the trade tools, single
    games and Live still use the earlier model.
- 2026-10-22, before any week-7 game: **the trade tools and the Live tab's injury handling ship.**
  - Trade tools: single-game win odds from a model fitted for one week's score
    (`singleGameModel`; single_games.py: next week -0.00071 Brier, 6 of 8 seasons; 2-4 weeks
    -0.00344, 8 of 8), and a trade's lineup change weighted by the fitted lineup weight
    instead of 0.75 (trades.py: a trade's projected change showed up at 0.43, 95% 0.40-0.46).
    The trade data keeps logging the earlier model's `meanByWeek` and `spread`, so **P2 is
    scored on both**: the earlier model as specified above, and the shipped single-game model
    (`model.games`) on the same games.
  - Live tab: Doubtful players count 0 and Questionable 0.9 of their projection before
    kickoff (injuries.py). **P3** (archive replay at kickoff) is unaffected: the archive's
    injury statuses are from after the season.
  - Past seasons' trade grades regenerated on the fitted models.

- 2026-10-26: **the Live tab's spread scale changes from 0.7 to 1.0** under the live addendum's
  rule. Rung 1 (one multiplier on the spread) lowered the primary score in all 8 held-out
  seasons of the crawled replay (-0.004 to -0.146; live_eval.py, LOG.md); the value shipped is
  the fit on 2022-2025 (x1.43; projections like Sleeper's now). Rungs 2-3 and two added variants
  (logged as deviations before their runs) failed. No 2026 data used. The win history is
  rebuilt with the new scale. **P3** (the archive replay at kickoff) is scored on both scales.
  The one-shot crawled-2026 confirmation covers this model.
- 2026-10-26: **the playoff and trade tools' injury return rates change** (RETURN_RATE, web/lib/
  analyze/availability.ts: 0.76, 0.40, 0.38, 0.48 -> 0.66, 0.44, 0.43, 0.43), rebuilt reproducibly
  by scripts/backtests/returns.py and better leaving each season out (5 of 8 seasons on absences
  that ended, 8 of 8 on all; the earlier rates came from an unkept scratch run). They only scale
  injured players' later weeks, so the fitted strength model under test is otherwise unchanged;
  `previousModel` keeps logging for P1. No 2026 data used. The Power Rankings' rank ranges now use
  a strength uncertainty measured including the playoff weeks (descriptive; the odds' tau is
  unchanged, tau_playoffs.py fell under the bar).
