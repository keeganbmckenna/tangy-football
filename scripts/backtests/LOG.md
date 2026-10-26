# Research log

Every model variant tried on the crawled leagues, in order, with its result and whether it
was adopted, failures included, so a reader can see how much searching led to the model in
use. Scores are out of sample (leave one season out) unless marked. Details in `README.md`.

| Date | Script | Variant | Result | Adopted |
|---|---|---|---|---|
| 2026-10-20 | `leagues_fit.py` | projection weight 0.1-1.1 (2,025 leagues) | 0.3 best (0.1525 vs 0.1604 at 0.75), in 8 of 8 seasons | candidate |
| 2026-10-20 | `leagues_fit.py` | persistent team offset sd 5/10/15 at weight 0.75 | helps (0.1564 at 15), doesn't replace the lower weight | no |
| 2026-10-20 | `leagues_fit.py` | projection-only values; bye-week waiver fill | help at 0.75, little once the weight is lower | no |
| 2026-10-21 | `strength_model.py` | fitted lineup + points per game, no uncertainty | overconfident (0.154 vs 0.153 for weight 0.3) | no |
| 2026-10-21 | `strength_model.py` | fitted lineup + ppg + all-play, bench, top-2 | no better than lineup + ppg (R^2 +0.003) | no |
| 2026-10-21 | `strength_model.py` | **fitted lineup + ppg + measured tau** | best: 0.152 (2,025 leagues), 0.1544 (7,312) | candidate |
| 2026-10-21 | scratch | weight 0.3 + measured tau | worse than weight 0.3 (+0.0016), 0 of 8 seasons | no |
| 2026-10-21 | `gpu_sim.py` | cleaning rule: drop >10% zero team-weeks (5%, 30%, none) | results unchanged at every threshold | yes (data) |
| 2026-10-21 | `drift.py` | AR(1) or random-walk strength drift vs fixed offset | -0.00005 from drift alone, 7-8 of 8 seasons; too small | no |
| 2026-10-21 | `schedule_luck.py` | random round robins instead of the real remaining schedule | real schedule better by 0.0003 | real schedule kept |
| 2026-10-21 | `rank_odds.py` | our rules (top 6 / top half), rank, wins, byes, schedule-averaged targets | fitted + tau best on all, 12-team leagues alone too | evaluation method |
| 2026-10-21 | scratch | learning curve: 5-100% of training leagues | flat from ~320 leagues | no more crawling |
| 2026-10-21 | `rank_odds.py --weekly` | every snapshot week 3 to the end (85,710 snapshots) | fitted + tau best or tied at every week; site model worse than a coin flip until week 8 | evaluation method |
| 2026-10-21 | `rank_odds.py --weekly --rules ours` | our rules with divisions, 12-team leagues, our schedule format | fitted + tau 0.1371 vs site 0.1432 (-0.0062 [-0.0065, -0.0059], 8 of 8) vs lineup 0.3 0.1378 (-0.00075 [-0.00098, -0.00053], 7 of 8) | **M1 passes the adoption rule** |
| 2026-10-21 | `headroom.py` | ceiling: share of the fitted model's missed strength known (rho 0-1), knowable share from the random-walk split | knowable gain 0.013 (0.1368 -> ~0.124), 2.6x the gain so far, almost all in weeks 3-10 | continue the ladder |
| 2026-10-21 | `own_league.py` | fitted on crawl, scored on our 2022-2025 | fitted + tau 0.126 vs site 0.125 (+0.0014, 1 of 4 seasons); ~5% chance for a typical league; site tuned on these seasons | reported, not tuned |
| 2026-10-21 | `league_activity.py` | fitted vs site edge by roster churn fifth | flat (-0.0058 to -0.0068); activity doesn't explain our league | no |
| 2026-10-22 | `rank_odds.py --rules ours` | divisions from each league's own schedule (twice-played groups of 4, 74% of snapshots) instead of random | baseline fitted + tau 0.1372 (vs 0.1371 random) | evaluation method |
| 2026-10-22 | `improvements.py` | ewm / last-3 / median ppg, score vs starters' projections, all four, nonlinear terms, per-team tau, shrunk spread, t(8) noise | best: all four -0.00020 [-0.00039, -0.00000] (7 of 8); vs projection alone -0.00017; t noise worse (+0.00006); none reaches 0.0005 | no |
| 2026-10-22 | `player_values.py` | player value share of season ppg 0 / 0.25 / 0.5 (site) / 0.75, padding 1 / 3 / 8 | projection-only best: -0.00027 [-0.00033, -0.00021] (6 of 8), monotone in the share; below 0.0005 | no (simplification noted) |
| 2026-10-22 | `manager_features.py` | + players added so far, + empty slots so far, + manager track record (41% coverage), all three | adds -0.00078 [-0.00100, -0.00056] (7 of 8); track record -0.00025 (8 of 8); empty -0.00006; all three -0.00101 [-0.00124, -0.00078] (8 of 8) | candidates |
| 2026-10-22 | `manager_features.py` | **+ adds + track record** (fixed before its run: empty slots added nothing) | -0.00097 [-0.00120, -0.00074], 8 of 8 seasons; adds +1.6-2.3 pts/wk per add/wk, track +0.8-0.9 per sd | **passes the adoption rule (exploratory batch: confirm on 2026)** |
| 2026-10-22 | `candidate_checks.py` | adds + track record by league type; without the busiest managers; our league | all its gain is in leagues with a fading team (-0.00148); in leagues where every team stays active, like ours: +0.00024 [-0.00021, +0.00067] (2 of 8); robust to busy managers (-0.00124); our league -0.0034 (3 of 4 seasons) | **not adopted for our league** |
| 2026-10-22 | `active_leagues.py` | fit on active leagues only (1,333), with track record or adds | fit on active -0.00016; + track record -0.00029; + adds -0.00029 [-0.00051, -0.00008]; all below 0.0005. Fitted vs site in active leagues -0.0060 (8 of 8) | no; the shipping case holds |
| 2026-10-22 | `title_odds.py` | title and last-place odds of the shipped model (bracket rebuilt from real playoff-week points; replay matches our real champions 2022-2025) | title Brier 0.0712 vs site 0.0726 vs coin flip 0.0718 (vs site -0.00138, log loss -0.121, 8 of 8); last place 0.0704 vs 0.0730 (8 of 8); tau in the playoffs helps (-0.00047 title, 8 of 8) | validates the ship |
| 2026-10-22 | injuries (player_weeks.py by season) | Live tab: Doubtful 0, Questionable 0.9 of projection before kickoff | Questionable 0.889 (95% 0.840-0.941; 0.83-0.95 by season) vs 0.975 not listed; no Doubtful player played (0 of 134) | yes (Live tab) |
| 2026-10-22 | `single_games.py` | trade tools' weekly odds: A earlier (0.75, 0.8x/2x), B fitted, C fitted + week lineup, D C + scale, E single-week fit (fixed after A won next week) | next week: E -0.00071 [-0.00086, -0.00057] (6 of 8), B/C/D worse (+0.0022 to +0.0025); 2-4 weeks: E -0.00344 (8 of 8) | **E adopted** |
| 2026-10-22 | `trades.py` | weight on a trade's projected lineup change: 0, fitted lineup weight, 0.75, fitted on trades (28,899 trading teams, two-way swaps) | weight from trades 0.43 [0.40, 0.46], ~ the fitted lineup weight by week; fitted weight vs 0.75 playoff Brier -0.00049 [-0.00062, -0.00037] (8 of 8, diluted over non-trading teams) | **fitted weight adopted** |
| 2026-10-22 | `live_correlation.py` | kickoff win odds with player correlations (QB-WR +0.29, QB-TE +0.26, QB vs opposing DEF -0.36, shared NFL games across the two fantasy teams) vs independent players | 370,170 matchups: log loss 0.6385 -> 0.6385 (-0.00003 [-0.00005, -0.00000], 5 of 8); 30x below the 0.001 minimum | no |
| 2026-10-22 | `active_leagues.py` (with league histories) | manager track record in active leagues, coverage 41% -> 42% after the history crawl | + track record -0.00032 [-0.00047, -0.00016] (7 of 8); + adds -0.00032; fit on active -0.00019; all below 0.0005 | no; research closed for 2026 |
| 2026-10-26 | `live_diagnostics.py` | exploratory diagnostics of the Live tab's odds through each week (this league's replays, 428 matchups; preregistered addendum 2026-10-26) | calibration slope 0.84 / 0.97 / 0.75 / 0.72 by quarter of the week (mid and late below 1); outcomes 1.4-1.5x the model's spread at every stage; spread x1.25-1.3 sizes at -0.006 log loss but 3 of 5 seasons; last 10% of a game holds ~15% of points | diagnostics only; tested on crawled leagues next |
