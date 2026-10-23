"""Shared helpers for the backtests: cached Sleeper data, best lineup, least squares."""
import json, glob, gzip, os
import numpy as np


def ols(X, y):
    X = np.column_stack([np.ones(len(y))] + X)
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    e = y - X @ b
    s2 = e @ e / (len(y) - X.shape[1])
    se = np.sqrt(np.diag(s2 * np.linalg.inv(X.T @ X)))
    return b, se, np.sqrt(e @ e / len(y))

D = os.path.dirname(os.path.abspath(__file__)) + '/cache'
# Completed seasons archived in the repo (scripts/archive_season.py), used when the cache
# doesn't have a file
ARCHIVE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'data', 'sleeper')
_ARCHIVED = {'m': 'matchups', 'tx': 'transactions', 'proj': 'projections', 'stats': 'stats'}


def _archive_path(n):
    """m_2024_5 -> data/sleeper/2024/matchups/5.json.gz; rosters_2024 -> .../2024/rosters.json.gz"""
    parts = n.split('_')
    if parts[0] in _ARCHIVED and len(parts) == 3:
        return os.path.join(ARCHIVE, parts[1], _ARCHIVED[parts[0]], f'{parts[2]}.json.gz')
    if parts[0] == 'rosters' and len(parts) == 2:
        return os.path.join(ARCHIVE, parts[1], 'rosters.json.gz')
    if parts[0] == 'league' and len(parts) == 2:
        for season in os.listdir(ARCHIVE) if os.path.isdir(ARCHIVE) else []:
            path = os.path.join(ARCHIVE, season, 'league.json.gz')
            if os.path.exists(path) and json.load(gzip.open(path, 'rt'))['league_id'] == parts[1]:
                return path
    return None


def J(n):
    path = f'{D}/{n}.json'
    if os.path.exists(path):
        return json.load(open(path))
    archived = _archive_path(n)
    if archived and os.path.exists(archived):
        return json.load(gzip.open(archived, 'rt'))
    raise FileNotFoundError(f'{n}: not in the cache or the archive (run fetch_history.py)')
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
leagues = {json.load(gzip.open(f, 'rt'))['season']: json.load(gzip.open(f, 'rt')) for f in glob.glob(f'{ARCHIVE}/*/league.json.gz')}
leagues.update({J(os.path.basename(f)[:-5])['season']: J(os.path.basename(f)[:-5]) for f in glob.glob(f'{D}/league_*')})
