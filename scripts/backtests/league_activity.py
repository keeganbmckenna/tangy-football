"""Does the fitted model's edge over the site's depend on how active a league is?

Our own seasons (own_league.py) preferred the site's model (projected lineup at 0.75), against
4,488 crawled 12-team leagues that clearly preferred the fitted model. Our league is among
the most active, and an active league keeps its lineups close to the projected best, so
projections may predict better there. Activity here is roster churn: players added per team
per week (a player on a roster this week who wasn't last week), from the weekly matchups,
over the whole regular season (a league trait for this check, not a forecasting feature).

Needs rank_odds.py --weekly --rules ours --save cache/rank_odds_weekly_ours.npz first.

    python league_activity.py
"""
import glob, gzip, json, os
import numpy as np
import gpu_sim as G
from common import ARCHIVE

HERE = os.path.dirname(os.path.abspath(__file__))


def churn(M, end):
    """Players added per team per week, weeks 2..end"""
    adds = n = 0
    for w in range(2, end + 1):
        prev = {m['roster_id']: set(m.get('players') or []) for m in M[w - 1]}
        for m in M[w]:
            adds += len(set(m.get('players') or []) - prev.get(m['roster_id'], set())); n += 1
    return adds / n


def main():
    z = np.load(os.path.join(HERE, 'cache', 'rank_odds_weekly_ours.npz'), allow_pickle=True)
    names = list(z['names']); final = z['final']; league = z['league']
    i_fit, i_site, i_03 = names.index('fitted + tau'), names.index('site (0.75)'), names.index('lineup 0.3')
    act = {}
    for f in glob.glob(os.path.join(HERE, 'cache', 'leagues', '*', '*.json.gz')):
        d = json.load(gzip.open(f, 'rt')); L = d['league']
        end = (L['settings'].get('playoff_week_start') or 15) - 1
        act[L['league_id']] = churn({int(w): m for w, m in d['matchups'].items()}, end)
    ours = {}
    for s in ('2022', '2023', '2024', '2025'):
        L = json.load(gzip.open(os.path.join(ARCHIVE, s, 'league.json.gz'), 'rt')); end = L['settings']['playoff_week_start'] - 1
        ours[s] = churn({w: json.load(gzip.open(os.path.join(ARCHIVE, s, 'matchups', f'{w}.json.gz'), 'rt')) for w in range(1, end + 1)}, end)
    a = np.array([act[l] for l in league])
    uniq = np.array(sorted({act[l] for l in set(league)}))
    print(f'roster churn (players added per team per week), {len(set(league))} crawled 12-team leagues: '
          f'median {np.median(uniq):.2f}, 10-90% {np.percentile(uniq, 10):.2f}-{np.percentile(uniq, 90):.2f}')
    print('our league: ' + ', '.join(f'{s} {v:.2f} ({(uniq < v).mean():.0%} of leagues below)' for s, v in ours.items()))
    P = {'league': league}
    edges = np.percentile(uniq, [0, 20, 40, 60, 80, 100])
    print('\nplayoff Brier (final check, every week, our rules) by activity fifth; differences with 95% intervals resampling leagues:')
    print(f"{'fifth':>6} {'churn':>11} {'leagues':>8} {'site':>8} {'fitted':>8} {'0.3':>8}   fitted - site                 fitted - 0.3")
    for q in range(5):
        sel = (a >= edges[q]) & (a <= edges[q + 1]) if q == 4 else (a >= edges[q]) & (a < edges[q + 1])
        d1 = final[i_fit, :, 0] - final[i_site, :, 0]; d2 = final[i_fit, :, 0] - final[i_03, :, 0]
        m1, l1, h1 = G.interval(P, d1, sel); m2, l2, h2 = G.interval(P, d2, sel)
        print(f'{q + 1:>6} {edges[q]:5.2f}-{edges[q + 1]:4.2f} {len(set(league[sel])):8d} {final[i_site, sel, 0].mean():8.4f} {final[i_fit, sel, 0].mean():8.4f} '
              f'{final[i_03, sel, 0].mean():8.4f}   {m1:+.4f} [{l1:+.4f}, {h1:+.4f}]   {m2:+.4f} [{l2:+.4f}, {h2:+.4f}]')


if __name__ == '__main__':
    main()
