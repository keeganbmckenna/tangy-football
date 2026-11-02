"""Test 10 of the live addendum (PREREGISTRATION_2026.md, 2026-11-02): does a player's own boom-or-bust
(his spread ratio from his earlier weeks that season, the site's playerSpreadRatio) sharpen his
range of points still to come, beyond position, projection and time left (live_sim.py's tables)?

Candidate I adds the ratio, in three bands cut at the training seasons' terciles within each
position; a cell with under 200 moments falls back to the shipped cell. Scored as test 9.

    python live_playerspread.py
"""
import os

import numpy as np
import pandas as pd

import live_sim as LS
from live_gamestate import pinball

HERE = os.path.dirname(os.path.abspath(__file__))
# The site's POSITION_SPREAD_RATIO and SPREAD_PRIOR_GAMES (web/lib/analyze/live.ts)
PRIOR = {'QB': 0.45, 'RB': 0.6, 'WR': 0.6, 'TE': 0.65, 'K': 0.55}
PRIOR_GAMES = 4
MIN_CELL = 200


def spread_ratio(pos, scores):
    """playerSpreadRatio"""
    prior = PRIOR.get(pos, 0.75)
    n = len(scores)
    if n < 2: return prior
    mean = float(np.mean(scores))
    if mean <= 1: return prior
    sd = float(np.std(scores, ddof=1))
    return (n * min(sd / mean, 2) + PRIOR_GAMES * prior) / (n + PRIOR_GAMES)


def with_ratios(df):
    """Each moment's player spread ratio from his earlier weeks of the season (half-PPR game totals)"""
    first = df.sort_values('rem', ascending=False).drop_duplicates(['season', 'week', 'player'])
    games = first.assign(total=first.so_far + first.left)[['season', 'week', 'player', 'pos', 'total']].sort_values(['season', 'player', 'week'])
    ratio = {}
    for (season, player), g in games.groupby(['season', 'player'], observed=True):
        totals = g.total.to_numpy(); weeks = g.week.to_numpy(); pos = g.pos.iloc[0]
        for i, w in enumerate(weeks):
            ratio[(season, w, player)] = spread_ratio(pos, totals[:i])
    keys = list(zip(df.season, df.week, df.player))
    return df.assign(ratio=np.array([ratio[k] for k in keys]))


def band_edges(train):
    """Terciles of the ratio within each position, on the training seasons' player-games"""
    g = train.drop_duplicates(['season', 'week', 'player'])
    return {p: np.quantile(g[g.pos == p].ratio, [1 / 3, 2 / 3]) for p in LS.POS}


def bands(df, edges):
    out = np.zeros(len(df), dtype=int)
    for p in LS.POS:
        m = (df.pos == p).to_numpy()
        out[m] = np.searchsorted(edges[p], df.ratio.to_numpy()[m], side='right')
    return out


def i_tables(df, base, edges):
    Q = np.repeat(base[:, :, :, None, :], 3, axis=3)
    r = (df.left / (df.proj * df.rem)).to_numpy()
    pi = df.pos.map({p: i for i, p in enumerate(LS.POS)}).to_numpy()
    pb, rb, bb = LS.proj_bin(df.proj.to_numpy()), LS.rem_bin(df.rem.to_numpy()), bands(df, edges)
    for i in range(len(LS.POS)):
        for j in range(base.shape[1]):
            for k in range(base.shape[2]):
                for b in range(3):
                    x = r[(pi == i) & (pb == j) & (rb == k) & (bb == b)]
                    if len(x) >= MIN_CELL: Q[i, j, k, b] = np.quantile(x, LS.PROBS)
    return Q


def main():
    df = pd.read_parquet(os.path.join(HERE, 'cache', 'live_state.parquet'), columns=['season', 'week', 'game', 'player', 'pos', 'proj', 'rem', 'so_far', 'left'])
    df['pos'] = df.pos.astype(str)
    df = df[df.pos.isin(LS.POS) & (df.rem > 0) & (df.rem <= 1.05) & (df.proj > 0)]
    df = with_ratios(df)
    rng = np.random.default_rng(2026)
    rows, pooled = [], []
    for s in sorted(df.season.unique()):
        train = df[(df.season >= 2020) & (df.season != s)]
        base = LS.tables(train)
        edges = band_edges(train)
        I = i_tables(train, base, edges)
        t = df[(df.season == s) & (df.rem >= 0.02)]
        pi = t.pos.map({p: i for i, p in enumerate(LS.POS)}).to_numpy()
        pb, rb, bb = LS.proj_bin(t.proj.to_numpy()), LS.rem_bin(t.rem.to_numpy()), bands(t, edges)
        scale = (t.proj * t.rem).to_numpy()[:, None]
        qb, qi = base[pi, pb, rb] * scale, I[pi, pb, rb, bb] * scale
        y = t.left.to_numpy()
        key = t.week.astype(str) + ':' + t.game.astype(str) + ':' + t.player.astype(str)
        pg = pd.DataFrame({'k': key.to_numpy(), 'b': pinball(qb, y), 'i': pinball(qi, y)}).groupby('k')[['b', 'i']].mean()
        b, i_ = pg.b.to_numpy(), pg.i.to_numpy()
        idx = rng.integers(0, len(pg), (1000, len(pg)))
        rel = (i_[idx].mean(1) - b[idx].mean(1)) / b[idx].mean(1)
        rows.append({'base': b.mean(), 'I': i_.mean()})
        if s >= 2020: pooled.append(pg)
        # WRs projected 14+ before kickoff: P(1.6x the projection or more) by band
        m = (t.pos.to_numpy() == 'WR') & (t.proj.to_numpy() >= 14) & (t.rem.to_numpy() > 0.95)
        tail = []
        for band in range(3):
            mb = m & (bb == band)
            if mb.sum() == 0: continue
            hit = lambda q: float((((q[mb] / scale[mb]) >= 1.6) @ LS.WEIGHTS).mean())
            tail.append(f'band {band}: actual {np.mean(y[mb] >= 1.6 * scale[mb, 0]):.1%} base {hit(qb):.1%} I {hit(qi):.1%} (n={mb.sum():,})')
        print(f"{s}: base {b.mean():.4f}  I {i_.mean():.4f}  ({i_.mean() / b.mean() - 1:+.2%} [{np.quantile(rel, 0.025):+.2%}, {np.quantile(rel, 0.975):+.2%}])  "
              f"WR 14+ before kickoff, P(>= 1.6x proj): {'; '.join(tail)}", flush=True)
    p = pd.concat(pooled)
    b, i_ = p.b.to_numpy(), p.i.to_numpy()
    idx = rng.integers(0, len(p), (1000, len(p)))
    rel = (i_[idx].mean(1) - b[idx].mean(1)) / b[idx].mean(1)
    lo, hi = np.quantile(rel, [0.025, 0.975])
    better = sum(r['I'] < r['base'] for r in rows)
    print(f'\npooled 2020-2025: {i_.mean() / b.mean() - 1:+.2%} [{lo:+.2%}, {hi:+.2%}]; I lower in {better} of {len(rows)} seasons')
    print('I passes (>= 1% lower, interval excluding 0, 6 of 8):', i_.mean() / b.mean() - 1 <= -0.01 and hi < 0 and better >= 6)


if __name__ == '__main__':
    main()
