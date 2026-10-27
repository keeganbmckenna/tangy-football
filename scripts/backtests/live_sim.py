"""Player-level remaining-points distributions for the live addendum's test 7 (PREREGISTRATION_2026.md).

From every projected player's in-game moments 2018-2025 (live_state.py): r = the points he
actually scored from then on / (his half-PPR projection x share of his game left). Its
distribution, as 64 quantiles (dense in the tails), by position (QB, RB, WR, TE, K), half-PPR projection (under 8,
8-14, 14+) and share of game left (6 bins). It carries what the normal curve can't: often a lot,
often nothing (a point mass at 0), rarely negative (a lost fumble or interception).

    python live_sim.py     # cache/live_sim_fit/{held-out season}.npz, the site's tables
                           # (web/lib/analyze/remainingPoints.json, fitted on 2020-2025) and a summary

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
# Quantile levels: dense in both tails (a lost fumble is a 0.5% event; 64 equal steps of 1.6% would
# miss it), evenly spaced between; each quantile stands for the probability between its neighbours
_TAIL = [0.001, 0.003, 0.006, 0.01, 0.015, 0.02]
PROBS = np.array(_TAIL + list(np.linspace(0.025, 0.975, 52)) + [1 - p for p in reversed(_TAIL)])
_CUTS = np.concatenate([[0], (PROBS[1:] + PROBS[:-1]) / 2, [1]])
WEIGHTS = np.diff(_CUTS)
NQ = len(PROBS)


def proj_bin(p):
    return np.searchsorted(PROJ_EDGES, p, side='right')


def rem_bin(r):
    return np.searchsorted(REM_EDGES, r, side='right')


def tables(df):
    """[5 positions, 3 projection bins, 6 rem bins, NQ] quantiles of r at PROBS (weights WEIGHTS)"""
    Q = np.full((len(POS), len(PROJ_EDGES) + 1, len(REM_EDGES) + 1, NQ), np.nan)
    probs = PROBS
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


SITE = os.path.join(HERE, '..', '..', 'web', 'lib', 'analyze', 'remainingPoints.json')


def export(Q):
    """The site's tables (fitted on 2020-2025, the seasons with projections like today's)"""
    import json
    json.dump({'about': "points a player scores from a moment on / (half-PPR projection x share of game left): 64 quantiles by "
                        "position, projection bin and share-left bin, 2020-2025 (scripts/backtests/live_sim.py)",
               'positions': list(POS), 'projEdges': list(PROJ_EDGES), 'remEdges': list(REM_EDGES),
               'weights': np.round(WEIGHTS, 6).tolist(), 'quantiles': np.round(Q, 4).tolist()}, open(SITE, 'w'))
    print('site tables written to', SITE)


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
    export(tables(df[df.season >= 2020]))
    for s in sorted(df.season.unique()):
        np.savez(os.path.join(OUT, f'{s}.npz'), Q=tables(df[df.season != s]))
    print('fold tables written to', OUT)


# --- The site's version (web/lib/analyze/live.ts remainingPointsOdds), for its parity fixture ---

STEP = 0.5
FIXTURE = os.path.join(HERE, '..', '..', 'web', 'lib', '__tests__', 'fixtures', 'remainingOdds.json')


def one_sided_odds(current, players, defenses, Q, pos_list=POS, weights=None):
    """a's chance of winning: current margin + the remaining margin > 0. players: (position, half-PPR
    projection, expected remaining points, share of game left, +1 for a's / -1 for b's); defenses:
    (expected remaining, sd, sign). The margin's distribution on a half-point grid, players from the
    quantile tables (linear split between neighbouring points), defenses as normals."""
    import math
    dist = {0: 1.0}
    def combine(dist, values, weights):
        out = {}
        for b, p in dist.items():
            for v, w in zip(values, weights):
                x = v / STEP; lo = math.floor(x); f = x - lo
                out[b + lo] = out.get(b + lo, 0.0) + p * w * (1 - f)
                if f: out[b + lo + 1] = out.get(b + lo + 1, 0.0) + p * w * f
        return out
    for pos, proj, expected, rem, sign in players:
        if expected <= 0 or rem <= 0 or pos not in pos_list: continue
        q = Q[pos_list.index(pos), int(proj_bin(proj)), int(rem_bin(rem))]
        dist = combine(dist, [sign * v * expected for v in q], list(WEIGHTS if weights is None else weights))
    for mean, sd, sign in defenses:
        if sd <= 0: dist = combine(dist, [sign * mean], [1.0]); continue
        lo, hi = math.floor((mean - 6 * sd) / STEP), math.ceil((mean + 6 * sd) / STEP)
        cdf = lambda x: 0.5 * (1 + math.erf((x - mean) / (sd * math.sqrt(2))))
        vals = [k * STEP for k in range(lo, hi + 1)]
        w = [cdf(v + STEP / 2) - cdf(v - STEP / 2) for v in vals]
        tot = sum(w); dist = combine(dist, [sign * v for v in vals], [x / tot for x in w])
    cdf = lambda z: 0.5 * (1 + math.erf(z / math.sqrt(2)))
    return sum(p * cdf((current + b * STEP) / (STEP / 2)) for b, p in dist.items())


def write_fixture(n=40, seed=7):
    import json
    rng = np.random.default_rng(seed)
    site = json.load(open(SITE)); Q = np.array(site['quantiles'])
    cases = []
    for _ in range(n):
        players = [(str(rng.choice(POS)), float(rng.uniform(2, 25)), float(rng.uniform(0, 15)), float(rng.choice([1.0, rng.uniform(0, 1), rng.uniform(0, 0.08)])),
                    float(rng.choice([1, -1]))) for _ in range(int(rng.integers(0, 4)))]
        defenses = [(float(rng.uniform(-4, 6)), float(rng.uniform(0, 5)), float(rng.choice([1, -1]))) for _ in range(int(rng.integers(0, 2)))]
        current = float(rng.uniform(-12, 12))
        # The site's table exactly as shipped (rounded quantiles and weights)
        cases.append({'current': current, 'players': players, 'defenses': defenses, 'odds': one_sided_odds(current, players, defenses, Q, weights=site['weights'])})
    json.dump(cases, open(FIXTURE, 'w'))
    print(f'{FIXTURE}: {n} cases')


if __name__ == '__main__':
    import sys
    write_fixture() if '--fixture' in sys.argv else main()
