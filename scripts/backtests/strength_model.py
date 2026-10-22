"""Fit team strength directly: predict each team's rest-of-season scoring from what's known.

brier_floor.py showed the lineup model barely beats a coin flip for the remaining games
(Brier 0.1525 vs 0.1581) while perfect knowledge of team strength would reach 0.0919: the
gap is all in estimating how good each team is. Here, from every crawled league-season
(2018-2025) and snapshot week (4, 7, 10), for every team, features known at the snapshot
(each centered within its league):

  lineup     projected best lineup, averaged over the remaining weeks (the current model)
  ppg        points per game so far
  allplay    all-play win share so far (beating every team every week)
  bench      projected points of the best 3 bench players
  top        projected points of the team's best 2 starters

Target: actual average points over the rest of the regular season (centered). A linear model
per snapshot week, fitted leaving one season out; its predictions go into the same simulator
and are scored on who made the playoffs (Brier), against the coin flip, the lineup model at
0.3 and perfect strength. 'fitted + tau' also simulates the uncertainty the fit leaves in each
team's strength (one offset per team per simulated season), measured from the training
seasons' residuals beyond weekly noise, not tuned.
"""
import glob, gzip, json, math, os, pickle, statistics as st
from collections import defaultdict
import numpy as np
import leagues_fit as LF

HERE = os.path.dirname(os.path.abspath(__file__))
FEATURES = ['lineup', 'ppg', 'allplay', 'bench', 'top']


def collect(max_zero=LF.MAX_ZERO, weekly=False):
    """Every snapshot of every played league-season (LF.played), cached in strength_data.pkl.
    weekly: a snapshot every week from 3 (the first with a spread to measure) to the end of the
    regular season, cached in strength_data_weekly.pkl; otherwise weeks 4, 7 and 10 with at
    least 3 weeks left."""
    path = os.path.join(HERE, 'strength_data_weekly.pkl' if weekly else 'strength_data.pkl')
    if os.path.exists(path):
        return [r for r in pickle.load(open(path, 'rb')) if LF.played(r['pts'], r['ids'], r['end'], max_zero)]
    data = []
    for f in sorted(glob.glob(os.path.join(HERE, 'cache', 'leagues', '*', '*.json.gz'))):
        try:
            d = json.load(gzip.open(f, 'rt'))
            data += league_snapshots(d['league'], {int(w): m for w, m in d['matchups'].items()}, weekly)
        except Exception as ex:
            print('skip', os.path.basename(f), ex)
    pickle.dump(data, open(path, 'wb'))
    return [r for r in data if LF.played(r['pts'], r['ids'], r['end'], max_zero)]


def league_snapshots(L, M, weekly=False):
    """Snapshots of one league-season: L the league object, M {week: matchups}"""
    out = []
    season = L['season']; ppr = L['scoring_settings'].get('rec'); slots = L['roster_positions']
    end = (L['settings'].get('playoff_week_start') or 15) - 1; n_po = L['settings'].get('playoff_teams') or 6
    if any(w not in M for w in range(1, end + 1)): return out
    ids = sorted(m['roster_id'] for m in M[1]); ix = {r: i for i, r in enumerate(ids)}; T = len(ids)
    pts = {w: {m['roster_id']: (m.get('points') or 0) for m in M[w]} for w in range(1, end + 1)}
    games = {}
    for w in range(1, end + 1):
        by = defaultdict(list)
        for m in M[w]:
            if m.get('matchup_id') is not None: by[m['matchup_id']].append(ix[m['roster_id']])
        games[w] = [tuple(v) for v in by.values() if len(v) == 2]
    for e in (range(3, end + 1) if weekly else LF.SNAPSHOTS):
        if not weekly and e >= end - 1: continue
        vals = LF.table(season, e, ppr)
        rosters = {m['roster_id']: (m.get('players') or []) for m in M[e]}
        lineup = np.array([np.mean([LF.lineup(rosters.get(r, []), vals, slots, w, 0) for w in range(e, end + 1)]) for r in ids])
        ppg = np.array([st.mean(pts[w][r] for w in range(1, e)) for r in ids])
        allplay = np.array([np.mean([np.mean([pts[w][r] > pts[w][o] for o in ids if o != r]) for w in range(1, e)]) for r in ids])
        def depth(r):
            v = sorted((vals[p][1].get(e, (0, 0))[0] for p in rosters.get(r, []) if p in vals), reverse=True)
            n_start = len([s for s in slots if s not in ('BN', 'IR', 'TAXI')])
            return sum(v[n_start:n_start + 3]), sum(v[:2])
        dep = np.array([depth(r) for r in ids])
        future = np.array([st.mean(pts[w][r] for w in range(e, end + 1)) for r in ids])
        X = np.column_stack([lineup, ppg, allplay, dep[:, 0], dep[:, 1]])
        X = X - X.mean(0)
        out.append(dict(league=L['league_id'], season=season, e=e, ids=ids, games=games, pts=pts, end=end, n_po=n_po,
                         median=bool(L['settings'].get('league_average_match')),
                         X=X, y=future - future.mean(), lg=st.mean(pts[w][r] for w in range(1, e) for r in ids)))
    return out


def fit(rows, cols):
    X = np.vstack([r['X'][:, cols] for r in rows]); y = np.concatenate([r['y'] for r in rows])
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    return b


def spread(row):
    ids, pts, e = row['ids'], row['pts'], row['e']
    sq = sum((pts[w][r] - st.mean(pts[x][r] for x in range(1, e))) ** 2 for r in ids for w in range(1, e))
    return max(math.sqrt(sq / (len(ids) * (e - 2))), 15)


def tau_for(rows, cols, b):
    """Uncertainty left in team strength after the fit: residual variance of rest-of-season
    averages, less what weekly noise alone puts in an average of the remaining weeks"""
    excess = []
    for r in rows:
        res = r['y'] - r['X'][:, cols] @ b
        excess.append(np.mean(res ** 2) - spread(r) ** 2 / (r['end'] - r['e'] + 1))
    return math.sqrt(max(np.mean(excess), 0))


def brier(row, mean_offsets, rng, taus=None, team_rng=None):
    ids, games, pts, end, e, n_po = row['ids'], row['games'], row['pts'], row['end'], row['e'], row['n_po']
    T = len(ids)
    def record(through):
        W = np.zeros(T); PF = np.zeros(T)
        for w in range(1, through + 1):
            for a, b in games[w]:
                pa, pb = pts[w][ids[a]], pts[w][ids[b]]
                W[a] += 1 if pa > pb else 0.5 if pa == pb else 0; W[b] += 1 if pb > pa else 0.5 if pa == pb else 0
            for i, r in enumerate(ids): PF[i] += pts[w][r]
        return W, PF
    Wf, PFf = record(end); made = np.zeros(T); made[np.lexsort((-PFf, -Wf))[:n_po]] = 1
    W0, PF0 = record(e - 1)
    sd = spread(row)
    out = {}
    for name, off in mean_offsets.items():
        Wv = np.repeat(W0[None], LF.N, 0); PFv = np.repeat(PF0[None], LF.N, 0)
        tau = (taus or {}).get(name, 0)
        for w in range(e, end + 1):
            sc = (row['lg'] + off)[None] + sd * rng[w] + tau * team_rng
            for a, c in games[w]:
                Wv[:, a] += sc[:, a] > sc[:, c]; Wv[:, c] += sc[:, c] > sc[:, a]
            PFv += sc
        seeds = np.argsort(np.argsort(-(Wv + PFv / (PFv.max(1, keepdims=True) + 1)), axis=1), axis=1)
        out[name] = float(np.mean(((seeds < n_po).mean(0) - made) ** 2))
    return out


def main():
    data = collect()
    seasons = sorted({r['season'] for r in data})
    print(f'{len(data)} league snapshots, {sum(len(r["ids"]) for r in data)} team-snapshots')
    # How much of the rest-of-season scoring each feature set explains (R^2), all data
    for e in LF.SNAPSHOTS:
        rows = [r for r in data if r['e'] == e]
        y = np.concatenate([r['y'] for r in rows])
        for label, cols in (('lineup', [0]), ('ppg', [1]), ('lineup+ppg', [0, 1]), ('all', [0, 1, 2, 3, 4])):
            b = fit(rows, cols); X = np.vstack([r['X'][:, cols] for r in rows])
            r2 = 1 - np.sum((y - X @ b) ** 2) / np.sum(y ** 2)
            print(f'  week {e:2d} {label:11} R^2 {r2:.3f}  coefficients ' + ', '.join(f'{FEATURES[c]} {v:+.3f}' for c, v in zip(cols, b)))
    # Out of sample: fit per snapshot week on the other seasons, simulate the held-out season
    rng0 = np.random.default_rng(71)
    res = defaultdict(list)
    for s in seasons:
        coefs, taus = {}, {}
        for e in LF.SNAPSHOTS:
            train = [r for r in data if r['e'] == e and r['season'] != s]
            coefs[e] = {lab: fit(train, cols) for lab, cols in (('lineup+ppg', [0, 1]), ('all', [0, 1, 2, 3, 4]))}
            taus[e] = tau_for(train, [0, 1], coefs[e]['lineup+ppg'])
        print(f'  held out {s}: strength uncertainty tau ' + ', '.join(f'week {e} {t:.1f}' for e, t in taus.items()), flush=True)
        for r in [r for r in data if r['season'] == s]:
            T = len(r['ids']); noise = {w: rng0.standard_normal((LF.N, T)) for w in range(r['e'], r['end'] + 1)}
            team_noise = rng0.standard_normal((LF.N, T))
            offs = {'coin flip': np.zeros(T), 'lineup 0.3': 0.3 * r['X'][:, 0],
                    'fitted lineup+ppg': r['X'][:, [0, 1]] @ coefs[r['e']]['lineup+ppg'],
                    'fitted all': r['X'] @ coefs[r['e']]['all'],
                    'fitted + tau': r['X'][:, [0, 1]] @ coefs[r['e']]['lineup+ppg'],
                    'perfect strength': r['y']}
            for name, v in brier(r, offs, noise, {'fitted + tau': taus[r['e']]}, team_noise).items():
                res[(r['e'], name)].append(v); res[('all', name)].append(v)
        print(s, 'done', flush=True)
    names = ['coin flip', 'lineup 0.3', 'fitted lineup+ppg', 'fitted + tau', 'perfect strength']
    print('\nplayoff Brier, out of sample (fitted on the other seasons):')
    print(f"{'from week':>9}  " + '  '.join(f'{n:>17}' for n in names))
    for e in list(LF.SNAPSHOTS) + ['all']:
        print(f'{str(e):>9}  ' + '  '.join(f'{np.mean(res[(e, n)]):17.4f}' for n in names))


if __name__ == '__main__':
    main()
