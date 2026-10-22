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

## Log of changes after the first snapshot

- 2026-10-20: snapshots before kickoffs also save Sleeper's full projection file (every player's
  injury status at the time), for future injury backtests. Data collection only; no analysis
  above changes.
