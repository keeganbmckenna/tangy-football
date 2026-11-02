"""Test 8 of the live addendum (PREREGISTRATION_2026.md, 2026-11-01): does the score margin sharpen a
player's range of points still to come?

Baseline: the shipped L6 tables (live_sim.py), 64 quantiles of r = points from then on / (half-PPR
projection x share left) by position, projection bin and share-left bin. Candidate G: the same with
his team's score margin (5 buckets) as a fifth dimension while the game is on (share left < 0.95),
falling back to the baseline's cell under 200 moments. Tables fitted on 2020-2025 leaving the scored
season out; scored by quantile (pinball) loss over the 64 levels, in points, on in-game moments
(share left 0.02-0.95), averaged per player-game.

    python live_gamestate.py
"""
import os

import numpy as np
import pandas as pd

import live_sim as LS

HERE = os.path.dirname(os.path.abspath(__file__))
# Margin buckets from his team's side: <= -17, -16..-9, -8..+8, +9..+16, >= +17
MARGIN_EDGES = (-16.5, -8.5, 8.5, 16.5)
IN_GAME = 0.95
MIN_CELL = 200


def margin_bin(m):
    return np.searchsorted(MARGIN_EDGES, m, side='right')


def g_tables(df, base):
    """[positions, projection bins, rem bins, 5 margin bins, NQ]: in-game cells by margin, else the baseline's"""
    nm = len(MARGIN_EDGES) + 1
    Q = np.repeat(base[:, :, :, None, :], nm, axis=3)
    d = df[df.rem < IN_GAME]
    r = (d.left / (d.proj * d.rem)).to_numpy()
    pi = d.pos.map({p: i for i, p in enumerate(LS.POS)}).to_numpy()
    pb, rb, mb = LS.proj_bin(d.proj.to_numpy()), LS.rem_bin(d.rem.to_numpy()), margin_bin(d.margin.to_numpy())
    for i in range(len(LS.POS)):
        for j in range(base.shape[1]):
            for k in range(base.shape[2]):
                for m in range(nm):
                    x = r[(pi == i) & (pb == j) & (rb == k) & (mb == m)]
                    if len(x) >= MIN_CELL:
                        Q[i, j, k, m] = np.quantile(x, LS.PROBS)
    return Q


def pinball(q, y):
    """Weighted pinball loss over the quantile levels: q [n, NQ] predicted points, y [n] actual"""
    diff = y[:, None] - q
    return (np.maximum(LS.PROBS * diff, (LS.PROBS - 1) * diff) * LS.WEIGHTS).sum(axis=1)


def coverage(q, y, lo, hi):
    a, b = np.searchsorted(LS.PROBS, lo), np.searchsorted(LS.PROBS, hi)
    # The nearest levels to 0.25/0.75 and 0.10/0.90 on the grid
    return np.mean((y >= q[:, a]) & (y <= q[:, b]))


def main():
    df = pd.read_parquet(os.path.join(HERE, 'cache', 'live_state.parquet'),
                         columns=['season', 'week', 'game', 'player', 'pos', 'proj', 'rem', 'margin', 'left'])
    df['pos'] = df.pos.astype(str)
    df = df[df.pos.isin(LS.POS) & (df.rem > 0) & (df.rem <= 1.05) & (df.proj > 0)]
    print(f'{len(df):,} player-moments')
    rng = np.random.default_rng(2026)
    rows, pooled = [], []
    for s in sorted(df.season.unique()):
        train = df[(df.season >= 2020) & (df.season != s)]
        base = LS.tables(train)
        G = g_tables(train, base)
        t = df[(df.season == s) & (df.rem >= 0.02) & (df.rem <= IN_GAME)]
        pi = t.pos.map({p: i for i, p in enumerate(LS.POS)}).to_numpy()
        pb, rb, mb = LS.proj_bin(t.proj.to_numpy()), LS.rem_bin(t.rem.to_numpy()), margin_bin(t.margin.to_numpy())
        scale = (t.proj * t.rem).to_numpy()[:, None]
        qb, qg = base[pi, pb, rb] * scale, G[pi, pb, rb, mb] * scale
        y = t.left.to_numpy()
        lb, lg = pinball(qb, y), pinball(qg, y)
        # Per player-game, then resampled over player-games
        key = t.week.astype(str) + ':' + t.game.astype(str) + ':' + t.player.astype(str)
        pg = pd.DataFrame({'k': key.to_numpy(), 'b': lb, 'g': lg}).groupby('k')[['b', 'g']].mean()
        b, g = pg.b.to_numpy(), pg.g.to_numpy()
        idx = rng.integers(0, len(pg), (1000, len(pg)))
        rel = (g[idx].mean(1) - b[idx].mean(1)) / b[idx].mean(1)
        recv = np.isin(t.pos.to_numpy(), ['WR', 'TE']) & (np.abs(t.margin.to_numpy()) >= 9)
        rows.append({'season': s, 'player_games': len(pg), 'base': b.mean(), 'G': g.mean(), 'rel': g.mean() / b.mean() - 1,
                     'lo': np.quantile(rel, 0.025), 'hi': np.quantile(rel, 0.975),
                     'cov50_b': coverage(qb, y, 0.25, 0.75), 'cov50_g': coverage(qg, y, 0.25, 0.75),
                     'cov80_b': coverage(qb, y, 0.10, 0.90), 'cov80_g': coverage(qg, y, 0.10, 0.90),
                     'rcv50_b': coverage(qb[recv], y[recv], 0.25, 0.75), 'rcv50_g': coverage(qg[recv], y[recv], 0.25, 0.75)})
        if s >= 2020:
            pooled.append(pg.assign(season=s))
        print(f"{s}: base {b.mean():.4f}  G {g.mean():.4f}  ({rows[-1]['rel']:+.2%} [{rows[-1]['lo']:+.2%}, {rows[-1]['hi']:+.2%}])  "
              f"25-75 {rows[-1]['cov50_b']:.1%} -> {rows[-1]['cov50_g']:.1%}  10-90 {rows[-1]['cov80_b']:.1%} -> {rows[-1]['cov80_g']:.1%}  "
              f"receivers 9+ either way 25-75 {rows[-1]['rcv50_b']:.1%} -> {rows[-1]['rcv50_g']:.1%}", flush=True)
    p = pd.concat(pooled)
    b, g = p.b.to_numpy(), p.g.to_numpy()
    idx = rng.integers(0, len(p), (1000, len(p)))
    rel = (g[idx].mean(1) - b[idx].mean(1)) / b[idx].mean(1)
    better = sum(r['G'] < r['base'] for r in rows)
    lo, hi = np.quantile(rel, [0.025, 0.975])
    passes = g.mean() / b.mean() - 1 <= -0.01 and hi < 0 and better >= 6
    print(f'\npooled 2020-2025: {g.mean() / b.mean() - 1:+.2%} [{lo:+.2%}, {hi:+.2%}]; G lower in {better} of {len(rows)} seasons')
    print('G passes (>= 1% lower, interval excluding 0, 6 of 8):', passes)


if __name__ == '__main__':
    main()
