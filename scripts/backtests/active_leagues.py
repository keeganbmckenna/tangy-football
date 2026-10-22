"""Fit on leagues like ours? (exploratory)

candidate_checks.py found the new features' gain comes from leagues where some team faded
(added under 0.5 players a week over the season); in leagues where every team stayed active,
like ours, it vanished. The fitted model's weights are learned from all 12-team leagues,
70% of which have a fading team. Here, scored on the active leagues only (every team 0.5+
adds a week; our league's least active team is at 0.62-0.92), every model fitted leaving
one season out on:

  all leagues       the adopted model as is ('fitted + tau')
  active leagues    the same model, fitted on active leagues only
  + track record    fitted on active leagues, with the manager's track record
  + adds            fitted on active leagues, with players added so far

    python active_leagues.py
"""
import os, sys
import numpy as np
import gpu_sim as G
import manager_features as MF
import candidate_checks as CC
import rank_odds as R

HERE = os.path.dirname(os.path.abspath(__file__))
NAMES = ['fitted on all', 'fitted on active', 'active + track record', 'active + adds']


def main():
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12]
    owners, record, rosters = MF.scan()
    min_adds = {lid: min(CC.season_adds(rs).values()) for lid, rs in rosters.items()}
    act = [min_adds.get(r['league'], 0) >= 0.5 for r in data]
    print(f'{sum(act)} of {len(data)} snapshots in active leagues', flush=True)
    F, _ = MF.features(data, owners, record, rosters)
    Pa = G.pack(data); A = np.array(act)

    def coefs(X, rows):
        m = Pa['teams'][rows]; b, *_ = np.linalg.lstsq(X[rows][m], Pa['y'][rows][m], rcond=None)
        res = (Pa['y'][rows] - X[rows] @ b) * m
        return b, np.sqrt(max(((res ** 2).sum(1) / m.sum(1) - Pa['sd'][rows] ** 2 / Pa['rem'][rows]).mean(), 0))

    designs = [(None, []), ('active', []), ('active', [2, 3]), ('active', [0])]
    off = np.zeros((len(NAMES),) + Pa['y'].shape); tau = np.zeros((len(NAMES), len(data)))
    for s in np.unique(Pa['season']):
        for e in np.unique(Pa['e']):
            te = (Pa['season'] == s) & (Pa['e'] == e) & A
            if not te.any(): continue
            for i, (pop, cols) in enumerate(designs):
                tr = (Pa['season'] != s) & (Pa['e'] == e) & (A if pop else True)
                if tr.sum() < 50: tr = (Pa['season'] != s) & (Pa['e'] == e)  # too few active leagues this late: all leagues
                X = np.concatenate([Pa['X'][:, :, :2], F[:, :, cols]], -1)
                b, t_ = coefs(X, tr); off[i, te] = X[te] @ b; tau[i, te] = t_
    keep = np.where(A)[0]
    sub = [data[i] for i in keep]; off, tau = off[:, keep], tau[:, keep]
    G.S.collect = lambda *a_, **k: sub
    def model_set(P):
        return NAMES, off * P['teams'], tau, np.repeat(P['sd'][None], len(NAMES), 0)
    sys.argv = [sys.argv[0], '--weekly', '--rules', 'ours', '--sims', '4000', '--target-sims', '2000', '--save', os.path.join(HERE, 'cache', 'active_leagues.npz')]
    R.main(model_set, [(n, 'fitted on all') for n in NAMES[1:]])


if __name__ == '__main__':
    main()
