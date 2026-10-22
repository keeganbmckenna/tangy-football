"""Stress tests for the 'adds + track record' candidate before it ships (manager_features.py).

1. What drives it: the gain in leagues where every team stayed active all season (each
   adding at least 0.5 players a week), like ours, against leagues with a team that faded.
   If it only spots abandoned teams, it won't help us.
2. Shared managers: the gain without the leagues of the busiest managers (in 10 or more
   crawled league-seasons), so it doesn't rest on a few people.
3. Our league, 2022-2025: the candidate fitted on crawled 12-team leagues only (same season
   left out), our real divisions; adds from our weekly rosters, the track record from our
   managers' earlier seasons in our league and in any crawled league.

Needs manager_features.py's saved scores (cache/manager_features.npz).

    python candidate_checks.py
"""
import gzip, json, os
from collections import Counter, defaultdict
import numpy as np
import torch
import gpu_sim as G
import manager_features as MF
import own_league as OL
import rank_odds as R
from common import ARCHIVE

HERE = os.path.dirname(os.path.abspath(__file__))
CAND, BASE = '+ adds + track record', 'fitted + tau'


def season_adds(rosters):
    """Players added per week over the whole regular season, per team (a league trait for this check)"""
    W = sorted(rosters)
    return {r: np.mean([len(rosters[w][r][0] - rosters[w - 1][r][0]) for w in W[1:]]) for r in rosters[W[0]]}


def main():
    z = np.load(os.path.join(HERE, 'cache', 'manager_features.npz'), allow_pickle=True)
    names = list(z['names']); final = z['final']; league = z['league']; season = z['season']
    d = final[names.index(CAND), :, 0] - final[names.index(BASE), :, 0]
    P = {'league': league}
    owners, record, rosters = MF.scan()
    seasons = np.unique(season)
    def report(label, sel):
        m, lo, hi = G.interval(P, d, sel)
        won = sum(d[sel & (season == s)].mean() < 0 for s in seasons if (sel & (season == s)).any())
        print(f'  {label:<52} {len(set(league[sel])):5d} leagues  {m:+.5f} [{lo:+.5f}, {hi:+.5f}]  ({won} of {len(seasons)} seasons)')
    print(f'{CAND} minus {BASE}, playoff Brier (12-team leagues, every week, our rules, real schedules):')
    report('all', np.ones(len(d), bool))
    # 1. every team active all season
    min_adds = {lid: min(season_adds(rs).values()) for lid, rs in rosters.items()}
    active = np.array([min_adds.get(l, 0) >= 0.5 for l in league])
    report('every team added 0.5+ players a week (like ours)', active)
    report('some team added under 0.5 a week', ~active)
    # 2. busiest managers
    per_owner = Counter(o for (lid, r), o in owners.items() if o)
    busy = {o for o, c in per_owner.items() if c >= 10}
    has_busy = {lid for (lid, r), o in owners.items() if o in busy}
    report(f'without leagues of the {len(busy)} managers in 10+ league-seasons', np.array([l not in has_busy for l in league]))
    ours = {s: season_adds({w: {m['roster_id']: (set(m.get('players') or []), None) for m in json.load(gzip.open(os.path.join(ARCHIVE, s, 'matchups', f'{w}.json.gz'), 'rt'))}
                                 for w in range(1, 15)}) for s in ('2022', '2023', '2024', '2025')}
    print('  our league, least active team (players added a week): ' + ', '.join(f'{s} {min(v.values()):.2f}' for s, v in ours.items()))

    # 3. our league
    print('\nour league 2022-2025 (fitted on crawled 12-team leagues only, same season left out):')
    rows, divs, real = OL.own_snapshots()
    for s in ('2022', '2023', '2024', '2025'):  # our seasons in the track record too (earlier seasons only are used)
        Lg = json.load(gzip.open(os.path.join(ARCHIVE, s, 'league.json.gz'), 'rt')); end = Lg['settings']['playoff_week_start'] - 1
        M = {w: json.load(gzip.open(os.path.join(ARCHIVE, s, 'matchups', f'{w}.json.gz'), 'rt')) for w in range(1, end + 1)}
        R_ = json.load(gzip.open(os.path.join(ARCHIVE, s, 'rosters.json.gz'), 'rt'))
        ppg = {r['roster_id']: np.mean([next(m.get('points') or 0 for m in M[w] if m['roster_id'] == r['roster_id']) for w in range(1, end + 1)]) for r in R_}
        mu, sd = np.mean(list(ppg.values())), np.std(list(ppg.values()))
        for r in R_:
            owners[(Lg['league_id'], r['roster_id'])] = r.get('owner_id')
            if r.get('owner_id'): record[r['owner_id']][int(s)].append((ppg[r['roster_id']] - mu) / sd)
        rosters[Lg['league_id']] = {w: {m['roster_id']: (set(m.get('players') or []), m.get('starters') or []) for m in M[w]} for w in range(1, end + 1)}
    Fo, has = MF.features(rows, owners, record, rosters)
    print(f'  our teams with a track record: ' + ', '.join(f'{s} {has[np.array([r["season"] == s for r in rows])].mean():.0%}' for s in ('2022', '2023', '2024', '2025')))
    Po = G.pack(rows); B, T = Po['y'].shape
    crawl = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12]; C = G.pack(crawl)
    Fc, _ = MF.features(crawl, owners, record, rosters)
    off = np.zeros((2, B, T)); tau = np.zeros((2, B))
    for s in ('2022', '2023', '2024', '2025'):
        for e in np.unique(Po['e']):
            te = (Po['season'] == int(s)) & (Po['e'] == e); tr = (C['season'] != int(s)) & (C['e'] == e)
            if not te.any(): continue
            for i, cols in ((0, []), (1, [0, 2, 3])):
                Xc = np.concatenate([C['X'][:, :, :2], Fc[:, :, cols]], -1); Xo = np.concatenate([Po['X'][:, :, :2], Fo[:, :, cols]], -1)
                m = C['teams'][tr]; b, *_ = np.linalg.lstsq(Xc[tr][m], C['y'][tr][m], rcond=None)
                res = (C['y'][tr] - Xc[tr] @ b) * m
                off[i, te] = Xo[te] @ b; tau[i, te] = np.sqrt(max(((res ** 2).sum(1) / m.sum(1) - C['sd'][tr] ** 2 / C['rem'][tr]).mean(), 0))
    gen = torch.Generator(device=G.DEV).manual_seed(0); br = np.zeros((2, B))
    for s in ('2022', '2023', '2024', '2025'):
        ii = np.where(Po['season'] == int(s))[0]
        div = R.t(np.repeat(divs[s][None], len(ii), 0), torch.int64) if divs[s] is not None else None
        real_r, _ = R.season(Po, ii, 12, 1, gen, 'real', div=div)
        F, _ = R.season(Po, ii, 12, 20000, gen, 'real', (off[:, ii], tau[:, ii], np.repeat(Po['sd'][None], 2, 0)[:, ii]), div=div)
        br[:, ii] = ((F.cumsum(-1)[..., R.PLAYOFF - 1] - real_r.cumsum(-1)[..., R.PLAYOFF - 1]) ** 2).mean(-1).cpu().numpy()
    for i, n in enumerate((BASE, CAND)):
        print(f'  {n:<24}' + ''.join(f'  {s} {br[i, Po["season"] == int(s)].mean():.4f}' for s in ('2022', '2023', '2024', '2025')) + f'  pooled {br[i].mean():.4f}')
    dd = br[1] - br[0]
    print(f'  difference: ' + '  '.join(f'{s} {dd[Po["season"] == int(s)].mean():+.4f}' for s in ('2022', '2023', '2024', '2025')) + f'  pooled {dd.mean():+.4f}')


if __name__ == '__main__':
    main()
