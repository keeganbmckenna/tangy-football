"""The models fitted on other leagues, scored on ours: 2022-2025, every week from 3.

Our league is kept out of the crawled data (leagues_fit.OURS: two of its seasons had been
crawled), so models fitted on the crawled 12-team leagues (leaving the
same season out, as everywhere else) are out of sample here. Snapshots are built by the same
code (strength_model.league_snapshots) from the archive (data/sleeper/), with our real
divisions (2024 on) and seeding: division winners first, then the rest by record and points.
The rebuilt playoff teams are checked against the real winners brackets.

Four seasons and 48 team-seasons: the per-season numbers matter more than any interval. The
intervals resample team-seasons and are too narrow (teams in a season aren't independent:
six make it). 'site (0.75)' is the deployed model as the backtests rebuild it (without the
site's injury discounts); its settings were chosen on these same seasons, which favours it.

    python own_league.py [--sims 20000]
"""
import argparse, gzip, json, os
import numpy as np
import torch
import gpu_sim as G
import rank_odds as R
from common import ARCHIVE

SEASONS = ('2022', '2023', '2024', '2025')


def own_snapshots():
    """Our seasons' weekly snapshots, each season's divisions (roster order) and real playoff teams"""
    rows, divs, real = [], {}, {}
    for s in SEASONS:
        L = json.load(gzip.open(os.path.join(ARCHIVE, s, 'league.json.gz'), 'rt'))
        end = (L['settings'].get('playoff_week_start') or 15) - 1
        M = {w: json.load(gzip.open(os.path.join(ARCHIVE, s, 'matchups', f'{w}.json.gz'), 'rt')) for w in range(1, end + 1)}
        snaps = G.S.league_snapshots(L, M, weekly=True); rows += snaps
        rosters = json.load(gzip.open(os.path.join(ARCHIVE, s, 'rosters.json.gz'), 'rt'))
        d = {r['roster_id']: (r.get('settings') or {}).get('division') for r in rosters}
        divs[s] = None if None in d.values() else np.array([d[i] - 1 for i in snaps[0]['ids']])
        wb = json.load(gzip.open(os.path.join(ARCHIVE, s, 'winners_bracket.json.gz'), 'rt'))
        real[s] = {t for g in wb for t in (g.get('t1'), g.get('t2')) if isinstance(t, int)}
    return rows, divs, real


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--sims', type=int, default=20000); a = ap.parse_args()
    rows, divs, real = own_snapshots(); P = G.pack(rows); B, T = P['y'].shape
    crawl = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12]; C = G.pack(crawl)
    names = ['coin flip', 'site (0.75)', 'lineup 0.3', 'fitted + tau']
    off = np.zeros((4, B, T)); tau = np.zeros((4, B))
    off[1] = 0.75 * P['X'][:, :, 0]; off[2] = 0.3 * P['X'][:, :, 0]
    for s in SEASONS:
        for e in np.unique(P['e']):
            test = (P['season'] == int(s)) & (P['e'] == e); train = (C['season'] != int(s)) & (C['e'] == e)
            if not test.any(): continue
            b = G.fit(C, train, [0, 1]); off[3, test] = P['X'][test][:, :, [0, 1]] @ b; tau[3, test] = G.tau_for(C, train, [0, 1], b)
    sd = np.repeat(P['sd'][None], 4, 0)
    gen = torch.Generator(device=G.DEV).manual_seed(0)
    brier = {k: np.zeros((4, B)) for k in ('playoff', 'bye')}; label_ok = []
    for s in SEASONS:
        ii = np.where(P['season'] == int(s))[0]
        div = R.t(np.repeat(divs[s][None], len(ii), 0), torch.int64) if divs[s] is not None else None
        real_r, _ = R.season(P, ii, 12, 1, gen, 'real', div=div)
        F, _ = R.season(P, ii, 12, a.sims, gen, 'real', (off[:, ii], tau[:, ii], sd[:, ii]), div=div)
        cF, cG = F.cumsum(-1), real_r.cumsum(-1)
        for k, cut in (('playoff', R.PLAYOFF), ('bye', R.BYE)):
            p, y = cF[..., cut - 1], cG[..., cut - 1]
            brier[k][:, ii] = ((p - y) ** 2).mean(-1).cpu().numpy()
        made = {rows[ii[0]]['ids'][j] for j in range(12) if cG[0, 0, j, R.PLAYOFF - 1] > 0.5}
        label_ok.append((s, made == real[s], 'divisions' if divs[s] is not None else 'no divisions'))
    print('rebuilt playoff teams vs the real winners bracket: ' + ', '.join(f'{s} {"match" if ok else "DIFFER"} ({d})' for s, ok, d in label_ok))
    print(f'{B} snapshots (weeks 3-14 of 2022-2025), {a.sims} simulated seasons, models fitted on {len(np.unique(C["league"]))} crawled 12-team leagues (same season left out)')
    for k in brier:
        print(f'\n{k} Brier' + f"{'':>8}" + ''.join(f'{s:>9}' for s in SEASONS) + f"{'pooled':>9}")
        for m in range(4):
            print(f'  {names[m]:>18}' + ''.join(f'{brier[k][m, P["season"] == int(s)].mean():9.4f}' for s in SEASONS) + f'{brier[k][m].mean():9.4f}')
    print('\nplayoff Brier by week, pooled over the 4 seasons (coin flip / site / lineup 0.3 / fitted + tau):')
    for e in np.unique(P['e']):
        sel = P['e'] == e
        print(f'  week {e:2d}: ' + ' / '.join(f'{brier["playoff"][m, sel].mean():.4f}' for m in range(4)))
    # Paired differences; rough interval resampling team-seasons (too narrow, see above)
    rng = np.random.default_rng(0); team_season = [(int(P['season'][i]), j) for i in range(B) for j in range(12)]
    print('\nfitted + tau minus each, playoff Brier: by season; pooled with a rough interval (team-seasons resampled)')
    for m in range(3):
        d = brier['playoff'][3] - brier['playoff'][m]
        per = [d[P['season'] == int(s)].mean() for s in SEASONS]
        # per team-season contributions
        F_ = {}
        for i in range(B):
            F_.setdefault(int(P['season'][i]), []).append(d[i])
        boot = [np.mean([np.mean(F_[s_]) for s_ in rng.choice(list(F_), len(F_))]) for _ in range(2000)]
        print(f'  vs {names[m]:>12}: ' + '  '.join(f'{s} {v:+.4f}' for s, v in zip(SEASONS, per)) + f'  pooled {d.mean():+.4f}'
              + f'  (seasons better: {sum(v < 0 for v in per)} of 4; season-bootstrap range {np.percentile(boot, 2.5):+.4f} to {np.percentile(boot, 97.5):+.4f})')


if __name__ == '__main__':
    main()
