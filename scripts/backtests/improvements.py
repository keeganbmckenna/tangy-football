"""A batch of candidate improvements to the fitted model, scored together (exploratory).

Every variant is fitted leaving one season out (the weights per snapshot week by least
squares on the rest-of-season average, the persistent spread measured from residuals as in
strength_model.tau_for) and scored by rank_odds.py under our rules (--weekly --rules ours:
12-team leagues, every week from 3, divisions from each league's schedule where it implies
them), against 'fitted + tau'. Variants:

  ewm ppg        + points per game weighted to recent weeks (half-life 3 weeks)
  last-3 ppg     + the average of the last 3 weeks
  median ppg     + the median week (one blowout can't drag it)
  vs projection  + how far the team has scored above its starters' projections so far
                   (lineup calls, and projection bias for that roster; player_weeks.py)
  all four       the four together
  nonlinear      + squares and the product of the lineup and points-per-game gaps
  per-team tau   the persistent spread grows with how far the team's lineup and points per
                   game disagree: tau_i^2 = a + b (lineup gap - ppg gap)^2, a, b from residuals
  shrunk spread  each league's weekly spread pulled toward the typical one for that week
                   (3 weeks' worth of the typical spread added to the league's own weeks)
  t noise (8)    weekly scores with fatter tails (Student t, 8 degrees of freedom; the
                   measured excess kurtosis of weekly residuals is about 0.5-1)

Testing several at once: a winner here is exploratory until the one-shot 2026 check.

    python improvements.py   (needs cache/player_weeks.parquet from player_weeks.py)
"""
import math, os, sys
import numpy as np
import gpu_sim as G
import rank_odds as R

HERE = os.path.dirname(os.path.abspath(__file__))


def vs_projection(data):
    """Per snapshot: each team's average of (its score - its starters' projections) so far"""
    import pyarrow.parquet as pq
    t = pq.read_table(os.path.join(HERE, 'cache', 'player_weeks.parquet'), columns=['league_id', 'roster_id', 'week', 'started', 'proj'],
                      filters=[('started', '=', True)])
    df = t.to_pandas(); df['proj'] = df['proj'].fillna(0)
    proj = df.groupby(['league_id', 'roster_id', 'week'])['proj'].sum().to_dict()
    out = []
    for r in data:
        lid = int(r['league']); e = r['e']
        out.append(np.array([np.mean([r['pts'][w][i] - proj.get((lid, i, w), r['pts'][w][i]) for w in range(1, e)]) for i in r['ids']]))
    return out


def features(data):
    """Extra team features per snapshot, centered within the league: (B, T, 4)"""
    B, T = len(data), max(len(r['ids']) for r in data)
    F = np.zeros((B, T, 4)); vp = vs_projection(data)
    for b, r in enumerate(data):
        e = r['e']; S = np.array([[r['pts'][w][i] for w in range(1, e)] for i in r['ids']])  # teams x past weeks
        wts = 0.5 ** ((e - 1 - np.arange(1, e)) / 3)
        cols = [S @ wts / wts.sum(), S[:, -3:].mean(1), np.median(S, 1), vp[b]]
        n = len(r['ids'])
        for k, c in enumerate(cols): F[b, :n, k] = c - c.mean()
    return F


def fit_tau(X, y, m, sd, rem):
    """Least squares weights and the persistent spread (strength_model.tau_for), on rows X (n, T, k)"""
    b, *_ = np.linalg.lstsq(X[m], y[m], rcond=None)
    res = (y - X @ b) * m
    tau = math.sqrt(max(((res ** 2).sum(1) / m.sum(1) - sd ** 2 / rem).mean(), 0))
    return b, tau, res


NAMES = ['fitted + tau', 'ewm ppg', 'last-3 ppg', 'median ppg', 'vs projection', 'all four', 'nonlinear', 'per-team tau', 'shrunk spread', 't noise (8)']


def model_set(P, F):
    B, T = P['y'].shape; M = len(NAMES); m = P['teams']
    off = np.zeros((M, B, T)); tau = np.zeros((M, B, T)); sd = np.repeat(P['sd'][None], M, 0); df = np.zeros(M)
    L, Q = P['X'][:, :, 0], P['X'][:, :, 1]
    base = np.stack([L, Q], -1)
    sq = lambda v: (v ** 2 - (v ** 2 * m).sum(1, keepdims=True) / m.sum(1, keepdims=True)) * m
    designs = {1: [0], 2: [1], 3: [2], 4: [3], 5: [0, 1, 2, 3]}
    for s in np.unique(P['season']):
        for e in np.unique(P['e']):
            tr = (P['season'] != s) & (P['e'] == e); te = (P['season'] == s) & (P['e'] == e)
            if not te.any(): continue
            def apply(i, X):
                b, t_, _ = fit_tau(X[tr], P['y'][tr], m[tr], P['sd'][tr], P['rem'][tr])
                off[i, te] = X[te] @ b; tau[i, te] = t_
                return b, t_
            b0, t0 = apply(0, base)
            for i, cols in designs.items(): apply(i, np.concatenate([base, F[:, :, cols]], -1))
            apply(6, np.concatenate([base, np.stack([sq(L), sq(Q), (L * Q - (L * Q * m).sum(1, keepdims=True) / m.sum(1, keepdims=True)) * m], -1)], -1))
            # per-team tau: excess squared residual against the lineup/ppg disagreement
            res = (P['y'][tr] - base[tr] @ b0) * m[tr]
            ex = (res ** 2 - (P['sd'][tr] ** 2 / P['rem'][tr])[:, None])[m[tr]]
            d2 = ((L - Q)[tr] ** 2)[m[tr]]
            A = np.c_[np.ones_like(d2), d2]; ab = np.linalg.lstsq(A, ex, rcond=None)[0]; ab = np.maximum(ab, 0)
            off[7, te] = off[0, te]; tau[7, te] = np.sqrt(np.maximum(ab[0] + ab[1] * (L - Q)[te] ** 2, 0))
            # shrunk spread: 3 weeks of the training seasons' typical spread for this week
            s0 = np.median(P['sd'][tr]); n = e - 1
            sd[8, te] = np.sqrt((n * P['sd'][te] ** 2 + 3 * s0 ** 2) / (n + 3)); off[8, te] = off[0, te]; tau[8, te] = t0
            off[9, te] = off[0, te]; tau[9, te] = t0
    df[9] = 8
    return NAMES, off * m, tau * m, sd, df


def main():
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12]
    print(f'{len(data)} snapshots; building features ...', flush=True)
    F = features(data)
    G.S.collect = lambda *a, **k: data  # rank_odds.main reloads; hand it the same snapshots
    sys.argv = [sys.argv[0], '--weekly', '--rules', 'ours', '--sims', '2000', '--target-sims', '1000', '--save', os.path.join(HERE, 'cache', 'improvements.npz')]
    R.main(lambda P: model_set(P, F), [('ewm ppg', 'fitted + tau'), ('last-3 ppg', 'fitted + tau'), ('median ppg', 'fitted + tau'),
                                      ('vs projection', 'fitted + tau'), ('all four', 'fitted + tau'), ('nonlinear', 'fitted + tau'),
                                      ('per-team tau', 'fitted + tau'), ('shrunk spread', 'fitted + tau'), ('t noise (8)', 'fitted + tau')])


if __name__ == '__main__':
    main()
