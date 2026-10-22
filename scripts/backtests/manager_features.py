"""Information the fitted model doesn't have: the manager's track record and activity (exploratory).

headroom.py found about 13% of the spread in teams' rest-of-season scoring that is knowable
at the snapshot but missed, and improvements.py / player_values.py found almost none of it in
past scores or projections. Candidates from outside them, per team and snapshot week e
(centered within the league):

  adds so far      players added per week through week e-1 (from the weekly rosters)
  empty so far     share of starting slots left empty through week e-1
  adds + track record  the candidate fixed after the first run (empty slots added nothing)
  track record     the manager's standardized points per game ((team - league mean) / sd)
                   averaged over earlier seasons in any crawled league (cache/leagues,
                   cache/leagues_div, cache/history), 0 without one, with a 0/1 flag

Each is added to 'fitted + tau', fitted leaving one season out, and scored by rank_odds.py
under our rules. Testing several at once: a winner is exploratory until the 2026 check.

    python manager_features.py [--coverage]
"""
import argparse, glob, gzip, json, os, sys
from collections import defaultdict
import numpy as np
import gpu_sim as G
import leagues_fit as LF
import rank_odds as R

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = ('leagues', 'leagues_div', 'history')


def league_files():
    return [f for src in SOURCES for f in glob.glob(os.path.join(HERE, 'cache', src, '*', '*.json.gz'))]


def scan():
    """owners[(league, roster)] = owner; record[owner][season] = [standardized ppg, ...];
    weekly rosters and starters for the activity features"""
    owners, record, rosters = {}, defaultdict(lambda: defaultdict(list)), {}
    for f in league_files():
        try: d = json.load(gzip.open(f, 'rt'))
        except Exception: continue
        L = d['league']; lid = L['league_id']
        if lid in LF.OURS: continue
        end = (L['settings'].get('playoff_week_start') or 15) - 1
        M = {int(w): m for w, m in d['matchups'].items()}
        if any(w not in M for w in range(1, end + 1)): continue
        own = {r['roster_id']: r.get('owner_id') for r in d['rosters']}
        ppg = defaultdict(list)
        for w in range(1, end + 1):
            for m in M[w]: ppg[m['roster_id']].append(m.get('points') or 0)
        means = {r: np.mean(v) for r, v in ppg.items()}
        mu, sd = np.mean(list(means.values())), np.std(list(means.values())) or 1
        if mu < 50: continue  # not played (leagues_fit.played's spirit)
        for r, v in means.items():
            owners[(lid, r)] = own.get(r)
            if own.get(r): record[own[r]][int(L['season'])].append((v - mu) / sd)
        if os.path.basename(os.path.dirname(os.path.dirname(f))) == 'leagues':
            rosters[lid] = {w: {m['roster_id']: (set(m.get('players') or []), m.get('starters') or []) for m in M[w]} for w in range(1, end + 1)}
    return owners, record, rosters


def features(data, owners, record, rosters):
    B, T = len(data), 12
    F = np.zeros((B, T, 4)); has = np.zeros((B, T), bool)
    for b, r in enumerate(data):
        lid, e, ids = r['league'], r['e'], r['ids']; W = rosters.get(lid, {})
        adds = [np.mean([len(W[w][i][0] - W[w - 1][i][0]) for w in range(2, e)]) if e > 2 and W else 0 for i in ids]
        empty = [np.mean([sum(p in ('0', None) for p in W[w][i][1]) / max(len(W[w][i][1]), 1) for w in range(1, e)]) if W else 0 for i in ids]
        track = []
        for j, i in enumerate(ids):
            o = owners.get((lid, i)); past = [np.mean(v) for s, v in record.get(o, {}).items() if s < int(r['season'])] if o else []
            track.append(np.mean(past) if past else 0.0); has[b, j] = bool(past)
        for k, c in enumerate([adds, empty, track, has[b, :len(ids)].astype(float)]):
            c = np.array(c, float); F[b, :len(ids), k] = c - c.mean()
    return F, has


NAMES = ['fitted + tau', '+ adds so far', '+ empty so far', '+ track record', 'all three', '+ adds + track record']


def model_set(P, F):
    B, T = P['y'].shape; m = P['teams']; M = len(NAMES)
    off = np.zeros((M, B, T)); tau = np.zeros((M, B)); base = np.stack([P['X'][:, :, 0], P['X'][:, :, 1]], -1)
    designs = {0: [], 1: [0], 2: [1], 3: [2, 3], 4: [0, 1, 2, 3], 5: [0, 2, 3]}
    for s in np.unique(P['season']):
        for e in np.unique(P['e']):
            tr = (P['season'] != s) & (P['e'] == e); te = (P['season'] == s) & (P['e'] == e)
            if not te.any(): continue
            for i, cols in designs.items():
                X = np.concatenate([base, F[:, :, cols]], -1)
                b, *_ = np.linalg.lstsq(X[tr][m[tr]], P['y'][tr][m[tr]], rcond=None)
                res = (P['y'][tr] - X[tr] @ b) * m[tr]
                off[i, te] = X[te] @ b
                tau[i, te] = np.sqrt(max(((res ** 2).sum(1) / m[tr].sum(1) - P['sd'][tr] ** 2 / P['rem'][tr]).mean(), 0))
    return NAMES, off * m, tau, np.repeat(P['sd'][None], M, 0)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--coverage', action='store_true'); a = ap.parse_args()
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12]
    owners, record, rosters = scan()
    F, has = features(data, owners, record, rosters)
    seasons = np.array([int(r['season']) for r in data])
    print(f'{len(data)} snapshots; teams with a track record: {has.mean():.0%} overall, by season: '
          + ', '.join(f'{s} {has[seasons == s].mean():.0%}' for s in np.unique(seasons)))
    if a.coverage: return
    G.S.collect = lambda *a_, **k: data
    sys.argv = [sys.argv[0], '--weekly', '--rules', 'ours', '--sims', '2000', '--target-sims', '1000', '--save', os.path.join(HERE, 'cache', 'manager_features.npz')]
    R.main(lambda P: model_set(P, F), [(n, 'fitted + tau') for n in NAMES[1:]])


if __name__ == '__main__':
    main()
