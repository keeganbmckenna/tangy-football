"""Diagnostics for the Live tab's win odds, through each week, before trying to improve them.

Exploratory, per PREREGISTRATION_2026.md (addendum 2026-10-26): run on this league's replays
to choose what to test; nothing here is fitted or decided on. Needs the replay's diagnostics
(cd web && npx tsx scripts/build-win-history.ts 2022 2023 2024 2025 2026 --diagnostics) and the
play-by-play timelines (scripts/build_play_timelines.py).

  1. Calibration slope by stage of the week (logistic regression of the result on the odds'
     log-odds; 1 is right, below 1 overconfident)
  2. Is the spread right: z = (final margin - projected margin) / the model's sd, by stage
  3. The same at kickoff, in points, on the earlier kickoff study's sample (live_pregame.py)
  4. Log loss with the spread widened by c (exploratory sizing; leave one season out)
  5. When in a game players' points arrive (the model assumes evenly)

    uv run --extra research python live_diagnostics.py
"""
import bisect, glob, json, math, os
from collections import defaultdict

import numpy as np
import statsmodels.api as sm
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '..', 'cache')
STAGES = [(0, .25), (.25, .5), (.5, .75), (.75, 1)]


def load():
    rows = []  # season, week, matchup key, elapsed share of the week's game time, projected margin, sd, final margin
    for f in sorted(glob.glob(os.path.join(CACHE, 'live_diag', '*', '*.json'))):
        season, week = f.split(os.sep)[-2], int(os.path.basename(f)[:-5])
        for m in json.load(open(f))['matchups']:
            r = m['rows']
            if len(r) < 3 or abs(r[-1][1] - r[-1][2]) < 1e-6:
                continue
            t0, t1, final = r[0][0], r[-1][0], r[-1][1] - r[-1][2]
            for t, _, _, pa, pb, sd in r[:-1]:
                rows.append((season, week, f'{season}-{week}-{m["id"]}', (t - t0) / (t1 - t0), pa - pb, max(sd, 1e-6), final))
    return rows


def main():
    rows = load()
    season = np.array([r[0] for r in rows]); week = np.array([r[1] for r in rows]); key = np.array([r[2] for r in rows])
    el, mu, sd, fin = (np.array([r[i] for r in rows], float) for i in (3, 4, 5, 6))
    y = (fin > 0).astype(float)
    p = stats.norm.cdf(mu / sd)
    z = (fin - mu) / sd
    uniq, inv = np.unique(key, return_inverse=True)
    print(f'{len(uniq)} decided matchups, {len(rows)} samples (every 3 minutes of game time)')

    print('\n1) calibration slope by stage of the week (95% interval clustered by matchup)')
    for lo, hi in STAGES:
        s = (el >= lo) & (el < hi) & (p > 1e-4) & (p < 1 - 1e-4)
        x = sm.add_constant(np.log(p[s] / (1 - p[s])))
        fit = sm.GLM(y[s], x, family=sm.families.Binomial()).fit(cov_type='cluster', cov_kwds={'groups': inv[s]})
        a, b = fit.conf_int()[1]
        print(f'  {lo:.2f}-{hi:.2f}: slope {fit.params[1]:.2f} ({a:.2f} to {b:.2f})')

    print('\n2) z = (final margin - projected) / sd: sd(z) should be 1')
    for lo, hi in STAGES:
        s = (el >= lo) & (el < hi)
        zz = z[s]
        print(f'  {lo:.2f}-{hi:.2f}: sd(z) {zz.std():.2f}  mean {zz.mean():+.2f}  skew {stats.skew(zz):+.2f}  excess kurtosis {stats.kurtosis(zz):+.2f}'
              f'  |z|>2: {np.mean(np.abs(zz) > 2) * 100:.1f}% (normal 4.6%)')

    print('\n3) kickoff, in points')
    first = np.array(sorted({k: i for i, k in reversed(list(enumerate(key)))}.values()))
    for label, sel in [('all', np.ones(len(first), bool)),
                       ('2022-2025 weeks 3-14 (live_pregame.py sample)', (season[first] != '2026') & (week[first] >= 3) & (week[first] <= 14))]:
        e = fin[first][sel] - mu[first][sel]
        print(f'  {label}: n={sel.sum()}  model sd {sd[first][sel].mean():.1f}  actual RMS {math.sqrt((e ** 2).mean()):.1f}  mean error {e.mean():+.1f}')

    print('\n4) exploratory sizing: spread widened by c (log loss averaged over each matchup\'s week)')
    counts = np.bincount(inv)
    mseason = np.array([u.split('-')[0] for u in uniq])
    grid = np.round(np.arange(0.8, 2.01, 0.05), 2)
    per = {}
    for c in grid:
        q = np.clip(stats.norm.cdf(mu / (sd * c)), 1e-4, 1 - 1e-4)
        per[c] = np.bincount(inv, weights=-(y * np.log(q) + (1 - y) * np.log(1 - q))) / counts
    print('  ' + '  '.join(f'c={c:.1f}: {per[c].mean():.4f}' for c in (1.0, 1.2, 1.3, 1.4, 1.6)))
    for s in sorted(set(mseason)):
        best = min(grid, key=lambda c: per[c][mseason != s].mean())
        te = mseason == s
        print(f'  {s}: c from the other seasons {best:.2f}, log loss {per[1.0][te].mean():.4f} -> {per[best][te].mean():.4f}')

    print('\n5) share of a player\'s final points scored by each share of his game played (even: 25/50/75/90%)')
    pos = {}
    for f in glob.glob(os.path.join(HERE, '..', '..', 'web', 'public', 'data', 'season-insights', '*.json')):
        pos.update({pid: q['position'] for pid, q in json.load(open(f))['players'].items()})
    marks = np.array([0.25, 0.5, 0.75, 0.9])
    curves = defaultdict(list)
    for f in glob.glob(os.path.join(HERE, '..', 'cache', 'timelines', '202[2-5]', '*.json')):
        d = json.load(open(f))
        games = [([s[0] for s in g['snaps']], [min(1, ((min(s[1], 4) - 1) * 900 + (900 - s[2])) / 3600) for s in g['snaps']]) for g in d['games'].values()]
        for pid, series in d['players'].items():
            final = series[-1][1]
            g = next((g for g in games if g[0][0] <= series[0][0] <= g[0][-1] + 60), None)
            if final < 5 or pid not in pos or not g:
                continue
            played = [g[1][max(0, bisect.bisect_right(g[0], t) - 1)] for t, _ in series]
            pts = [v for _, v in series]
            curves[pos[pid]].append([(pts[bisect.bisect_right(played, x) - 1] if played[0] <= x else 0) / final for x in marks])
    for q in ['QB', 'RB', 'WR', 'TE', 'K']:
        a = np.array(curves[q])
        print(f'  {q:3} n={len(a):5}  ' + '  '.join(f'{int(m * 100)}%: {v * 100:4.1f}%' for m, v in zip(marks, a.mean(0))))


if __name__ == '__main__':
    main()
