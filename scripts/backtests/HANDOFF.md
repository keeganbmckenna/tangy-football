# Handoff: model research state (October 21, 2026)

Read this first when picking the model work up on another machine.

## Where things are

- **Branch:** `claude/draft-page-week-data-eult1a` has everything below; `main` is the deployed
  site (Vercel, root directory `web/`). Push to main only when the owner says so.
- **Site model (deployed, frozen for 2026 per `PREREGISTRATION_2026.md`):** playoff odds
  from player values (half Sleeper projection, half season points per game padded with 3
  games of projection), team expected score = league average + 0.75 x (best lineup - league
  average lineup), weekly noise only, holes (byes/injuries with no backup) score 0. Injury
  fix shipped: players ruled out are discounted from this week, and one hurt in his last
  game counts as having missed one.
- **Data in the repo:** `data/sleeper/2022-2025/` (our league + NFL data, every season we
  played) and `data/sleeper/2018-2021/` (NFL projections, stats, schedules only; Sleeper's
  projections start in 2018). `scripts/backtests/common.py` reads the archive
  automatically.
- **Data not in the repo (public repo; other people's leagues):** 7,385 crawled redraft
  league-seasons (2018-2025; 2,025 in `crawled-leagues-2018-2025.tar`, the rest crawled
  October 21 with `--calls-per-min 900`, about 3 hours) for `leagues_fit.py`, `brier_floor.py`, `strength_model.py`.
  Unpack `crawled-leagues-2018-2025.tar` so files sit at
  `scripts/backtests/cache/leagues/{season}/{league_id}.json.gz`, or rebuild with
  `crawl_leagues.py` (about 3 hours, rate limited).
- **Scheduled jobs (GitHub Actions on main):** `Prediction log` saves the site's predictions
  and pre-kickoff injury statuses to the `prediction-log` branch; `Archive seasons` adds each
  finished season to `data/sleeper/` every March 15.

## What the research found (details in `README.md` here)

- On 2,025 leagues like ours, the site's model is no better than a coin flip for the
  remaining games (playoff Brier 0.160 vs 0.158); knowing every team's true rest-of-season
  strength would reach 0.092 (the floor). Brier mostly tracks how much season is left
  (week 4/7/10 floors 0.110/0.093/0.072).
- Best so far, out of sample (leave one season out): **team strength fitted from projected
  lineup + points per game so far, with the uncertainty the fit leaves simulated as one
  offset per team per season** (sd ~10/9.5/7.8 at weeks 4/7/10, measured from residuals):
  Brier 0.194/0.152/0.109 (0.152 overall). Coefficients (centered within league): lineup
  ~0.36/0.34/0.39, points per game ~0.18/0.39/0.48 at weeks 4/7/10.
- Simpler alternative: projection weight ~0.3 (rising ~0.25 early to ~0.45 late): 0.153.
- NFL injury reports (nflverse, 2022-2025): Doubtful players played 0 of 134 (the Live tab
  counts 30% of the projection before kickoff); Questionable scored 0.89 of projection
  (counted in full).
- Not worth it: Kalshi markets, streaming/waiver fill once the strength model is right.
- Our league alone (48 team-seasons) disagreed on several of these; the 2,025 leagues
  outweigh it.

## Open decisions (ask the owner)

1. Ship the fitted strength model + measured uncertainty, and the Doubtful (0) /
   Questionable (0.9) fixes, logging the change in `PREREGISTRATION_2026.md` and scoring old
   vs new on 2026 at season end. Not yet approved.
2. The trade tools use the same 0.75 weight on a trade's lineup change; test trades at
   scale (crawl the leagues' transactions) before changing it.

Update (October 21, evening): on all 7,385 leagues, run on the GPU (`gpu_sim.py`), the
same conclusions hold: fitted + tau 0.1544 vs lineup 0.3 0.1553 vs coin flip 0.1599. Strength
drift (`drift.py`) is real but worth only 0.00005. See the end of `README.md`.

## Next experiments

1. **Manager skill from past seasons:** league histories (`previous_league_id`) link
   managers across years; prior finish / points could predict rest-of-season strength.
2. **In-season activity:** waiver and trade counts from transactions.
3. **GPU work (local RTX 5090):** a learned correction to Sleeper's projections on
   ~100k+ player-weeks 2018-2025 (projection, actual, injury report status, position,
   usage), strict leave-one-season-out; player-level score distributions for title and Live
   odds; large parameter sweeps with bootstrap intervals in PyTorch.

## Rules of the road

- Every change must win out of sample (leave one season out), with an interval clustered
  by league or team-season excluding zero, and in most seasons; otherwise keep the simpler
  model. Don't tune on 2026 before the preregistered evaluation.
- Cite sources for factual claims. Commits end with the Claude Code co-author line.
