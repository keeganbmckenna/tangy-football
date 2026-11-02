"""Test 9 of the live addendum (PREREGISTRATION_2026.md, 2026-11-01): finer projection bins in the
player tables (live_sim.py). The shipped tables bin projections at 8 and 14 half-PPR points, so the
lowest bin mixes players projected 1 point with ones projected 7.5. Candidate F bins at 2, 4, 6, 8,
11, 14 and 18, falling back to the shipped cell under 200 moments. Scored as test 8
(live_gamestate.py) over every moment with share left 0.02 or more, before kickoff included.

    python live_projbins.py
"""
import os

import numpy as np
import pandas as pd

import live_sim as LS
from live_gamestate import pinball

HERE = os.path.dirname(os.path.abspath(__file__))
FINE_EDGES = (2.0, 4.0, 6.0, 8.0, 11.0, 14.0, 18.0)
MIN_CELL = 200


def fine_bin(p):
    return np.searchsorted(FINE_EDGES, p, side='right')


def f_tables(df, base):
    """[positions, fine projection bins, rem bins, NQ]: each fine cell, or the shipped cell it sits in"""
    nf = len(FINE_EDGES) + 1
    Q = np.full((len(LS.POS), nf, base.shape[2], LS.NQ), np.nan)
    r = (df.left / (df.proj * df.rem)).to_numpy()
    pi = df.pos.map({p: i for i, p in enumerate(LS.POS)}).to_numpy()
    fb, rb = fine_bin(df.proj.to_numpy()), LS.rem_bin(df.rem.to_numpy())
    # The shipped bin each fine bin falls in (by its lower edge)
    lower = np.concatenate([[0.0], FINE_EDGES])
    coarse = LS.proj_bin(lower)
    for i in range(len(LS.POS)):
        for j in range(nf):
            for k in range(base.shape[2]):
                x = r[(pi == i) & (fb == j) & (rb == k)]
                Q[i, j, k] = np.quantile(x, LS.PROBS) if len(x) >= MIN_CELL else base[i, coarse[j], k]
    return Q


def main():
    df = pd.read_parquet(os.path.join(HERE, 'cache', 'live_state.parquet'), columns=['season', 'week', 'game', 'player', 'pos', 'proj', 'rem', 'left'])
    df['pos'] = df.pos.astype(str)
    df = df[df.pos.isin(LS.POS) & (df.rem > 0) & (df.rem <= 1.05) & (df.proj > 0)]
    rng = np.random.default_rng(2026)
    rows, pooled = [], []
    for s in sorted(df.season.unique()):
        train = df[(df.season >= 2020) & (df.season != s)]
        base = LS.tables(train)
        F = f_tables(train, base)
        t = df[(df.season == s) & (df.rem >= 0.02)]
        pi = t.pos.map({p: i for i, p in enumerate(LS.POS)}).to_numpy()
        rb = LS.rem_bin(t.rem.to_numpy())
        scale = (t.proj * t.rem).to_numpy()[:, None]
        qb = base[pi, LS.proj_bin(t.proj.to_numpy()), rb] * scale
        qf = F[pi, fine_bin(t.proj.to_numpy()), rb] * scale
        y = t.left.to_numpy()
        key = t.week.astype(str) + ':' + t.game.astype(str) + ':' + t.player.astype(str)
        pg = pd.DataFrame({'k': key.to_numpy(), 'b': pinball(qb, y), 'f': pinball(qf, y)}).groupby('k')[['b', 'f']].mean()
        b, f = pg.b.to_numpy(), pg.f.to_numpy()
        idx = rng.integers(0, len(pg), (1000, len(pg)))
        rel = (f[idx].mean(1) - b[idx].mean(1)) / b[idx].mean(1)
        rows.append({'season': s, 'base': b.mean(), 'F': f.mean()})
        if s >= 2020:
            pooled.append(pg)
        # P(half a point or less), WRs projected 6-8 before kickoff
        m = (t.pos.to_numpy() == 'WR') & (t.proj.to_numpy() >= 6) & (t.proj.to_numpy() < 8) & (t.rem.to_numpy() > 0.95)
        zero = lambda q: float(((q[m] <= 0.5) @ LS.WEIGHTS).mean())
        print(f"{s}: base {b.mean():.4f}  F {f.mean():.4f}  ({f.mean() / b.mean() - 1:+.2%} [{np.quantile(rel, 0.025):+.2%}, {np.quantile(rel, 0.975):+.2%}])  "
              f"WR 6-8 before kickoff, P(<= 0.5 pts): actual {np.mean(y[m] <= 0.5):.1%}, base {zero(qb):.1%}, F {zero(qf):.1%}", flush=True)
    p = pd.concat(pooled)
    b, f = p.b.to_numpy(), p.f.to_numpy()
    idx = rng.integers(0, len(p), (1000, len(p)))
    rel = (f[idx].mean(1) - b[idx].mean(1)) / b[idx].mean(1)
    lo, hi = np.quantile(rel, [0.025, 0.975])
    better = sum(r['F'] < r['base'] for r in rows)
    print(f'\npooled 2020-2025: {f.mean() / b.mean() - 1:+.2%} [{lo:+.2%}, {hi:+.2%}]; F lower in {better} of {len(rows)} seasons')
    print('F passes (>= 1% lower, interval excluding 0, 6 of 8):', f.mean() / b.mean() - 1 <= -0.01 and hi < 0 and better >= 6)


if __name__ == '__main__':
    main()
