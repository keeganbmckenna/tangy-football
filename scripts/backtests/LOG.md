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

