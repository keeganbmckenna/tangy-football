"""Shared helpers for the backtests: cached Sleeper data, best lineup, least squares."""
import json, glob, os, statistics as st
import numpy as np


def ols(X, y):
    X = np.column_stack([np.ones(len(y))] + X)
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    e = y - X @ b
    s2 = e @ e / (len(y) - X.shape[1])
    se = np.sqrt(np.diag(s2 * np.linalg.inv(X.T @ X)))
    return b, se, np.sqrt(e @ e / len(y))

D = os.path.dirname(os.path.abspath(__file__)) + '/cache'
J = lambda n: json.load(open(f'{D}/{n}.json'))
SLOT = {'FLEX': ['RB', 'WR', 'TE']}
def best(players, proj, slots):
    pool = sorted([(proj[p][1], p, proj[p][0]) for p in players if p in proj], reverse=True)
    sl = sorted([SLOT.get(s, [s]) for s in slots if s != 'BN'], key=len)
    used, tot = set(), 0.0
    for el in sl:
        for pts, p, pos in pool:
            if p not in used and pos in el:
                used.add(p); tot += pts; break
    return tot

# League settings by season
leagues = {J(os.path.basename(f)[:-5])['season']: J(os.path.basename(f)[:-5]) for f in glob.glob(f'{D}/league_*')}
