"""The injury return fix in leagues_fit.table: does the strength model fitted on it predict better?

leagues_fit.table values a player projected 0 in the snapshot week while his team plays (out hurt)
at 0 for the rest of the season: his projection that week is carried forward. The fix
(leagues_fit.RETURNING) counts him from the first later week he's projected to play, as the site's
trade grades and odds chart do (web/lib/oddsData.ts carriedValues). This rebuilds the weekly
snapshots (strength_model.collect) with the fix for exactly the league-seasons in the current
cache (strength_data_weekly_byefix.pkl, the table with the bye fix), to
strength_data_weekly_return.pkl, refits the adopted model (lineup + ppg, each week, leaving the
season out) on each, and compares them with rank_odds.py --weekly --rules ours.

A bug fix ships whatever the result (PREREGISTRATION_2026.md allows bug fixes mid-season); this
measures what it changes. Scored on active leagues (every team 0.5+ adds a week; backtests/README)
with --active, otherwise on all 12-team leagues.

    python injury_return_check.py [--active] [--workers 16]
"""
import argparse, gzip, json, os, pickle, sys
from multiprocessing import Pool
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OLD = os.path.join(HERE, 'strength_data_weekly_byefix.pkl')
NEW = os.path.join(HERE, 'strength_data_weekly_return.pkl')


def rebuild(path):
    import strength_model as S
    S.LF.RETURNING = True
    try:
        d = json.load(gzip.open(path, 'rt'))
        return S.league_snapshots(d['league'], {int(w): m for w, m in d['matchups'].items()}, True)
    except Exception as ex:
        print('skip', os.path.basename(path), ex, flush=True)
        return []


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--active', action='store_true'); ap.add_argument('--workers', type=int, default=16)
    a = ap.parse_args()
    old = pickle.load(open(OLD, 'rb'))
    if not os.path.exists(NEW):
        leagues = sorted({(str(r['season']), r['league']) for r in old})
        files = [os.path.join(HERE, 'cache', 'leagues', s, f'{l}.json.gz') for s, l in leagues]
        print(f'rebuilding {len(files):,} league-seasons ({len(old):,} snapshots)', flush=True)
        new = []
        with Pool(a.workers) as pool:
            for i, part in enumerate(pool.imap(rebuild, files, chunksize=8)):
                new += part
                if i % 500 == 0: print(f'  {i}/{len(files)}', flush=True)
        pickle.dump(new, open(NEW, 'wb'))
    new = pickle.load(open(NEW, 'rb'))

    import gpu_sim as G
    import leagues_fit as LF
    import rank_odds as R
    keep = lambda r: len(r['ids']) == 12 and LF.played(r['pts'], r['ids'], r['end'], LF.MAX_ZERO) and r['league'] not in LF.OURS
    by_key = {(r['league'], r['e']): r for r in new if keep(r)}
    old_k = [r for r in old if keep(r) and (r['league'], r['e']) in by_key]
    if a.active:
        import manager_features as MF, candidate_checks as CC
        _, _, rosters = MF.scan()
        active = {lid for lid, rs in rosters.items() if min(CC.season_adds(rs).values()) >= 0.5}
        old_k = [r for r in old_k if r['league'] in active]
    new_k = [by_key[(r['league'], r['e'])] for r in old_k]
    print(f'{len(old_k):,} snapshots{" in active leagues" if a.active else ""}', flush=True)
    changed = np.mean([np.abs(o['X'][:, 0] - n['X'][:, 0]).max() > 1e-9 for o, n in zip(old_k, new_k)])
    print(f'snapshots whose lineup feature changed: {changed:.0%}', flush=True)

    # Each version fitted on all of its 12-team snapshots (as export_model does), leaving the season out
    def fitted(all_rows, rows):
        allP, P = G.pack(all_rows), G.pack(rows)
        B = len(rows); off = np.zeros(P['y'].shape); tau = np.zeros(B); w = []
        for s in np.unique(P['season']):
            for e in np.unique(P['e']):
                te = (P['season'] == s) & (P['e'] == e); tr = (allP['season'] != s) & (allP['e'] == e)
                if not te.any(): continue
                b = G.fit(allP, tr, [0, 1]); off[te] = P['X'][te][:, :, [0, 1]] @ b; tau[te] = G.tau_for(allP, tr, [0, 1], b)
                w.append((e, b[0]))
        return P, off * P['teams'], tau, w
    P_old, off_old, tau_old, w_old = fitted([r for r in old if keep(r)], old_k)
    P_new, off_new, tau_new, w_new = fitted([r for r in new if keep(r)], new_k)
    for name, w in (('flawed', w_old), ('fixed', w_new)):
        by_e = {}
        for e, b in w: by_e.setdefault(e, []).append(b)
        print(f'  lineup weight by week, {name}: ' + ', '.join(f'{e} {np.mean(v):.2f}' for e, v in sorted(by_e.items())))
    names = ['flawed', 'fixed']
    G.S.collect = lambda *a_, **k: new_k
    sys.argv = [sys.argv[0], '--weekly', '--rules', 'ours', '--sims', '4000', '--target-sims', '2000',
                '--save', os.path.join(HERE, 'cache', f'injury_return{"_active" if a.active else ""}.npz')]
    R.main(lambda P_: (names, np.stack([off_old, off_new]), np.stack([tau_old, tau_new]), np.stack([P_old['sd'], P_new['sd']])),
           [('fixed', 'flawed')])


if __name__ == '__main__':
    main()
