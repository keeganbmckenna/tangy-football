"""Score the 2026 season's saved predictions (PREREGISTRATION_2026.md, "as deployed").

Reads the snapshots that .github/workflows/prediction-log.yml saved on the prediction-log
branch (check it out, or pass its predictions/2026 folder) and Sleeper's results, and reports
the preregistered analyses:

  P1  playoff odds (Wednesday after-scoring snapshots, weeks 7-14): Brier and log loss
      against who made the playoffs, against a coin-flip-the-rest baseline, and the
      2022-2025 out-of-sample range; calibration
  P2  next week's single-game win odds from the same snapshots (the site's weekly win
      probability: expected scores, 0.8x the spread): log loss and Brier against results
  H1  the injury fix: of players ruled out (Out/IR/PUP...) in a Wednesday snapshot, how
      often each group played his team's next game, against the rate the model used
      (76% for one hurt in his last game or out one game, 40%, 38%, 48% after more), and
      Brier of the model's rates vs the old behavior (no discount for those hurt in their
      last game)

Run fetch_history.py first so the 2026 results are cached, then:
    python eval_2026.py path/to/predictions/2026
Nothing here may be changed after the first 2026 snapshot except to fix bugs (log them).
"""
import glob, gzip, json, math, os, statistics as st, sys
from collections import defaultdict
import numpy as np
from form_options import Season, N

SEASON = '2026'
RULED_OUT = {'Out', 'IR', 'PUP', 'Sus', 'NA', 'DNR', 'COV'}
RETURN_RATE = [0.76, 0.4, 0.38, 0.48]
NEXT_WEEK_SCALE = 0.8
# Out-of-sample playoff Brier of the current values on 2022-2025, by season (loso.py)
BACKTEST_BRIER = {'2022': 0.1397, '2023': 0.1479, '2024': 0.0784, '2025': 0.1047}


def cdf(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def load(folder):
    snaps = []
    for path in sorted(glob.glob(os.path.join(folder, '*.json.gz'))):
        with gzip.open(path, 'rt') as f:
            s = json.load(f)
        s['file'] = os.path.basename(path)
        snaps.append(s)
    return snaps


def wednesday(snaps):
    """The first after-scoring snapshot of each week (complete)"""
    out = {}
    for s in snaps:
        po, td = s.get('playoffOdds'), s.get('tradeData')
        if s['label'] != 'after-scoring' or not po or not td: continue
        week = po['lastScoredWeek'] + 1
        out.setdefault(week, s)
    return out


def scores(ps, ys):
    ps = np.clip(np.array(ps, float), 1e-4, 1 - 1e-4); ys = np.array(ys, float)
    return float(np.mean((ps - ys) ** 2)), float(-np.mean(ys * np.log(ps) + (1 - ys) * np.log(1 - ps)))


def p1(S, wed):
    Wf, made = S.final()
    rng = np.random.default_rng(2026)
    ps, ys, base = [], [], []
    print('\nP1 playoff odds (after-scoring snapshots)')
    print('  week   n   Brier   coin-flip-the-rest Brier')
    for week, s in sorted(wed.items()):
        if week > S.end: continue
        odds = s['playoffOdds']['odds']['teams']
        p = [odds[str(r)]['playoffs'] for r in S.ids]
        # Baseline: every remaining game a coin flip (equal expected scores), same simulator
        e = week
        lg = st.mean(S.M[w][r]['points'] for w in range(1, e) for r in S.ids)
        res, _ = S.simulate(e, {'flat': {w: np.full(len(S.ids), lg) for w in range(e, S.end + 1)}}, 25.0, rng)
        b = list(res['flat'][1])
        y = list(made)
        print(f'  {week:4d}  {len(p):3d}  {scores(p, y)[0]:.4f}  {scores(b, y)[0]:.4f}')
        ps += p; ys += y; base += b
    if not ps: return
    (bm, lm), (bb, lb) = scores(ps, ys), scores(base, ys)
    print(f'  all weeks: Brier {bm:.4f} (log loss {lm:.4f}); coin-flip-the-rest {bb:.4f} ({lb:.4f}); '
          f'2022-2025 out of sample {min(BACKTEST_BRIER.values()):.4f}-{max(BACKTEST_BRIER.values()):.4f}')
    calibration(ps, ys)


def calibration(ps, ys):
    ps, ys = np.array(ps), np.array(ys)
    print('  calibration: bucket   n   predicted   happened')
    for lo, hi in ((0, .1), (.1, .3), (.3, .5), (.5, .7), (.7, .9), (.9, 1.01)):
        m = (ps >= lo) & (ps < hi)
        if m.any(): print(f'    {lo:.1f}-{min(hi, 1):.1f}   {m.sum():4d}   {ps[m].mean():.3f}      {ys[m].mean():.3f}')
    # Calibration slope: logistic regression of outcome on logit(p), by Newton's method
    x = np.log(np.clip(ps, 1e-4, 1 - 1e-4) / np.clip(1 - ps, 1e-4, 1)); X = np.column_stack([np.ones_like(x), x]); b = np.zeros(2)
    for _ in range(50):
        p = 1 / (1 + np.exp(-X @ b)); W = p * (1 - p)
        H = X.T @ (X * W[:, None]) + 1e-9 * np.eye(2); b += np.linalg.solve(H, X.T @ (ys - p))
    se = np.sqrt(np.diag(np.linalg.inv(H)))
    print(f'  calibration slope {b[1]:.2f} (95% {b[1] - 1.96 * se[1]:.2f}-{b[1] + 1.96 * se[1]:.2f}); 1 = well calibrated, <1 overconfident')


def p2(S, wed):
    ps, ys = [], []
    for week, s in sorted(wed.items()):
        td = s['tradeData']; means = td['meanByWeek'].get(str(week)); spread = td['spread']
        if not means or week > S.end: continue
        for a, b, pa, pb in S.games(week):
            if pa == pb: continue
            d = means[str(a)] - means[str(b)]
            ps.append(cdf(d / (NEXT_WEEK_SCALE * spread * math.sqrt(2)))); ys.append(float(pa > pb))
    if not ps: return
    br, ll = scores(ps, ys)
    print(f'\nP2 next week\'s games: {len(ps)} games, log loss {ll:.4f} (coin flip 0.6931; 2022-2025 next week ~0.66), Brier {br:.4f}')


def h1(S, wed):
    """Did ruled-out players play their team's next game, as often as the model assumed?"""
    stats = S.stats
    played = lambda p, w: bool((stats.get(w, {}).get(p) or {}).get('gp'))
    team_plays = lambda team, w: team in S.playing.get(w, set())
    groups = defaultdict(list)  # missed so far -> [(model p, played, old behavior's p, player)]
    proj = {w: {r['player_id']: (r.get('stats') or {}).get('pts_half_ppr') or 0 for r in S.raw[w]} for w in S.raw}
    for week, s in sorted(wed.items()):
        if week > S.end: continue
        for pid, p in s['tradeData']['players'].items():
            if p.get('injury') not in RULED_OUT or not p.get('team') or p.get('position') == 'DEF': continue
            team = p['team']
            if not team_plays(team, week): continue
            # Games in a row he's missed, through last week
            missed = 0
            for w in range(week - 1, 0, -1):
                if not team_plays(team, w): continue
                if played(pid, w): break
                missed += 1
            rate = 0.0 if (p['injury'] == 'IR' and max(missed, 1) < 4) else RETURN_RATE[min(max(missed, 1), 4) - 1]
            # The old behavior gave a ruled-out player his full value this week whenever Sleeper
            # still projected him (projected nothing: 0 either way)
            projected = (proj.get(week, {}).get(pid) or 0) > 0
            groups[missed].append((rate, float(played(pid, week)), 1.0 if projected else rate, pid))
    print('\nH1 ruled-out players: did they play the next game?')
    print('  missed so far   n   model rate   played   old behavior rate')
    pooled = []
    for k in sorted(groups):
        g = groups[k]
        print(f'  {k:13d}  {len(g):4d}   {st.mean(x[0] for x in g):.2f}         {st.mean(x[1] for x in g):.2f}     {st.mean(x[2] for x in g):.2f}')
        pooled += g
    if pooled:
        # The same player shows up week after week: resample players, not rows
        by = defaultdict(list)
        for p, y, o, pid in pooled: by[pid].append((p - y) ** 2 - (o - y) ** 2)
        sums = np.array([sum(v) for v in by.values()]); counts = np.array([len(v) for v in by.values()])
        b = np.random.default_rng(7).integers(0, len(sums), (4000, len(sums)))
        boot = sums[b].sum(1) / counts[b].sum(1)
        print(f'  {len(pooled)} player-weeks, {len(by)} players. Brier: model {st.mean((p - y) ** 2 for p, y, _, _ in pooled):.4f} '
              f'vs old behavior {st.mean((o - y) ** 2 for _, y, o, _ in pooled):.4f}; '
              f'difference {sums.sum() / counts.sum():+.4f} (95% {np.percentile(boot, 2.5):+.4f} to {np.percentile(boot, 97.5):+.4f}, by player). '
              f'Keep the fix unless the difference is clearly positive.')


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join('prediction-log', 'predictions', SEASON)
    snaps = load(folder)
    wed = wednesday(snaps)
    print(f'{len(snaps)} snapshots; after-scoring weeks: {sorted(wed)}')
    S = Season(SEASON)
    p1(S, wed); p2(S, wed); h1(S, wed)


if __name__ == '__main__':
    main()
