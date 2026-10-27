"""Player-level remaining-points distributions for the live addendum's test 7 (PREREGISTRATION_2026.md).

From every projected player's in-game moments 2018-2025 (live_state.py): r = the points he
actually scored from then on / (his half-PPR projection x share of his game left). Its
distribution, as 64 quantiles, by position (QB, RB, WR, TE, K), half-PPR projection (under 8,
8-14, 14+) and share of game left (6 bins). It carries what the normal curve can't: often a lot,
often nothing (a point mass at 0), rarely negative (a lost fumble or interception).

    python live_sim.py     # cache/live_sim_fit/{held-out season}.npz and a summary

The replay (live_replay.py, LIVE_USE=sim) draws each starter's remaining points as r x his
remaining projection in the league's scoring.
"""
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'cache', 'live_sim_fit')
POS = ('QB', 'RB', 'WR', 'TE', 'K')
PROJ_EDGES = (8.0, 14.0)
REM_EDGES = (0.05, 0.1, 0.25, 0.5, 0.75)
NQ = 64


def proj_bin(p):
    return np.searchsorted(PROJ_EDGES, p, side='right')


def rem_bin(r):
    return np.searchsorted(REM_EDGES, r, side='right')


def tables(df):
    """[5 positions, 3 projection bins, 6 rem bins, 64] quantiles of r (nan where too few)"""
    Q = np.full((len(POS), len(PROJ_EDGES) + 1, len(REM_EDGES) + 1, NQ), np.nan)
    probs = (np.arange(NQ) + 0.5) / NQ
    for i, pos in enumerate(POS):
        d = df[df.pos == pos]
        pb, rb = proj_bin(d.proj.to_numpy()), rem_bin(d.rem.to_numpy())
        r = (d.left / (d.proj * d.rem)).to_numpy()
        for j in range(Q.shape[1]):
            for k in range(Q.shape[2]):
                x = r[(pb == j) & (rb == k)]
                if len(x) < 200:  # thin cell: pool projection bins
                    x = r[rb == k]
                Q[i, j, k] = np.quantile(x, probs)
    return Q


def main():
    df = pd.read_parquet(os.path.join(HERE, 'cache', 'live_state.parquet'), columns=['season', 'pos', 'proj', 'rem', 'left'])
    df['pos'] = df.pos.astype(str)
    df = df[df.pos.isin(POS) & (df.rem > 0) & (df.rem <= 1.05) & (df.proj > 0)]
    print(f'{len(df):,} player-moments')
    for pos in POS:
        d = df[(df.pos == pos) & (df.rem > 0.4) & (df.rem < 0.6)]
        print(f'  {pos}, half his game left: points from then on negative {np.mean(d.left < 0):.1%}, exactly 0 {np.mean(d.left == 0):.1%}, '
              f'under 2 {np.mean(d.left < 2):.1%}  (n={len(d):,})')
    os.makedirs(OUT, exist_ok=True)
    for s in sorted(df.season.unique()):
        np.savez(os.path.join(OUT, f'{s}.npz'), Q=tables(df[df.season != s]))
    print('fold tables written to', OUT)


if __name__ == '__main__':
    main()
