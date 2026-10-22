"""Which player values make the best projected lineup? (exploratory)

The projected lineup, the fitted model's main input, values each player as a blend of his
projection and his season points per game padded with k games of projection:
    value = (1 - share) x projection + share x (season points + k x projection) / (games + k)
The site's share 0.5 and padding 3 were chosen on our league's 48 team-seasons only
(form_options.py). Here the lineups of every crawled 12-team league-season, every week from
3, are rebuilt under several blends (the rest of each snapshot unchanged), the fitted model
is refitted on each (leave one season out) and scored by rank_odds.py under our rules.

    python player_values.py [--workers 8]
"""
import argparse, gzip, json, os, sys
from collections import defaultdict
from multiprocessing import Pool
import numpy as np
import gpu_sim as G
import leagues_fit as LF
import rank_odds as R

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDS = [(0.0, 3), (0.25, 3), (0.5, 3), (0.75, 3), (0.5, 1), (0.5, 8)]  # (share, padding games); (0.5, 3) is the site's
_tables = {}


def table(season, e, ppr):
    """LF.table with one value per blend: id -> (position, {week: (value per blend...)})"""
    key = (season, e, ppr)
    if key in _tables: return _tables[key]
    col = 'pts_ppr' if ppr == 1.0 else 'pts_half_ppr'
    sched = LF.arch(season, 'schedule'); playing = defaultdict(set)
    for g in sched: playing[g['week']].update((g['home'], g['away']))
    tot, gp = defaultdict(float), defaultdict(int)
    for w in range(1, e):
        for p, s in LF.arch(season, f'stats/{w}').items():
            if s.get('gp'): tot[p] += s.get(col) or 0; gp[p] += 1
    out = {}
    for r in LF.arch(season, f'projections/{e}'):
        pos = (r.get('player') or {}).get('position')
        if pos not in LF.POS: continue
        pid = r['player_id']; pts = (r.get('stats') or {}).get(col) or 0
        if pos == 'DEF': gp[pid] = sum(1 for w in range(1, e) if pid in playing[w])
        vals = tuple((1 - sh) * pts + sh * (tot[pid] + k * pts) / (gp[pid] + k) for sh, k in BLENDS)
        team = r.get('team') or (pid if pos == 'DEF' else None)
        out[pid] = (pos, {w: (vals if (team in playing[w] and pts > 0) else (0.0,) * len(BLENDS)) for w in range(e, 19)})
    _tables[key] = out
    return out


def league_lineups(path):
    """(league_id, e) -> lineup per blend (blends x teams), averaged over the remaining weeks"""
    d = json.load(gzip.open(path, 'rt')); L = d['league']; M = {int(w): m for w, m in d['matchups'].items()}
    if len(d['rosters']) != 12 or L['league_id'] in LF.OURS: return {}
    end = (L['settings'].get('playoff_week_start') or 15) - 1
    if any(w not in M for w in range(1, end + 1)): return {}
    ids = sorted(m['roster_id'] for m in M[1]); slots = L['roster_positions']; ppr = L['scoring_settings'].get('rec')
    out = {}
    for e in range(3, end + 1):
        vals = table(L['season'], e, ppr); rosters = {m['roster_id']: (m.get('players') or []) for m in M[e]}
        out[(L['league_id'], e)] = np.array([[np.mean([LF.lineup(rosters.get(r, []), vals, slots, w, j) for w in range(e, end + 1)])
                                              for r in ids] for j in range(len(BLENDS))])
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--workers', type=int, default=8); a = ap.parse_args()
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12]
    cache = os.path.join(HERE, 'cache', 'player_values_lineups.npz')
    if os.path.exists(cache):
        z = np.load(cache, allow_pickle=True); lineups = dict(zip(map(tuple, z['keys']), z['vals']))
    else:
        files = sorted({f for f in __import__('glob').glob(os.path.join(HERE, 'cache', 'leagues', '*', '*.json.gz'))})
        lineups = {}
        with Pool(a.workers) as pool:
            for i, part in enumerate(pool.imap_unordered(league_lineups, files, chunksize=8)):
                lineups.update(part)
                if i % 1000 == 0: print(f'  {i}/{len(files)} leagues', flush=True)
        keys = list(lineups); np.savez(cache, keys=np.array(keys, dtype=object), vals=np.array([lineups[k] for k in keys]))
    Lb = np.stack([lineups[(r['league'], r['e'])] for r in data])  # (B, blends, 12)
    Lb = Lb - Lb.mean(-1, keepdims=True)
    # check: the site's blend reproduces the cached lineup feature
    site = BLENDS.index((0.5, 3))
    print(f'site blend vs cached lineup feature: max difference {np.abs(Lb[:, site] - np.stack([r["X"][:, 0] for r in data])).max():.2e}')
    names = [f'share {sh:g}, pad {k}' + (' (site)' if (sh, k) == (0.5, 3) else '') for sh, k in BLENDS]

    def model_set(P):
        B, T = P['y'].shape; m = P['teams']; M = len(BLENDS)
        off = np.zeros((M, B, T)); tau = np.zeros((M, B))
        for j in range(M):
            X = np.stack([Lb[:, j], P['X'][:, :, 1]], -1)
            for s in np.unique(P['season']):
                for e in np.unique(P['e']):
                    tr = (P['season'] != s) & (P['e'] == e); te = (P['season'] == s) & (P['e'] == e)
                    if not te.any(): continue
                    b, *_ = np.linalg.lstsq(X[tr][m[tr]], P['y'][tr][m[tr]], rcond=None)
                    res = (P['y'][tr] - X[tr] @ b) * m[tr]
                    off[j, te] = X[te] @ b
                    tau[j, te] = np.sqrt(max(((res ** 2).sum(1) / m[tr].sum(1) - P['sd'][tr] ** 2 / P['rem'][tr]).mean(), 0))
        return names, off * m, tau, np.repeat(P['sd'][None], M, 0)

    G.S.collect = lambda *a_, **k: data
    sys.argv = [sys.argv[0], '--weekly', '--rules', 'ours', '--sims', '2000', '--target-sims', '1000', '--save', os.path.join(HERE, 'cache', 'player_values.npz')]
    R.main(model_set, [(n, names[site]) for n in names if n != names[site]])


if __name__ == '__main__':
    main()
