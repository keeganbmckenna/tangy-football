"""How well do projections known at week t0 predict a team's score h weeks later?"""
import statistics as st, numpy as np
from common import J, best, leagues, ols
out = []
for season in ['2022', '2023', '2024', '2025']:
    L = leagues[season]; slots = L['roster_positions']; end = L['settings']['playoff_week_start'] - 1
    M = {w: {m['roster_id']: m for m in J(f'm_{season}_{w}')} for w in range(1, end + 1)}
    raw = {w: J(f'proj_{season}_{w}') for w in range(1, end + 1)}
    playing = {w: {r['team'] for r in raw[w] if r.get('game_id') and r.get('team')} for w in raw}
    weekof = {w: {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0) for r in raw[w] if r.get('player') and r['player'].get('position')} for w in raw}
    for t0 in range(2, end):
        Pn = {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0, r.get('team'))
              for r in raw[t0 + 1] if r.get('player') and r['player'].get('position')}
        allpast = [M[w][r]['points'] for w in range(1, t0 + 1) for r in M[w]]; lg = st.mean(allpast)
        for r in M[t0 + 1]:
            past = [M[w][r]['points'] for w in range(1, t0 + 1)]; form = (sum(past) + 2 * lg) / (len(past) + 2)
            roster = M[t0 + 1][r]['players'] or []
            for w in range(t0 + 1, end + 1):
                Pw = {p: (v[0], v[1] if (v[2] in playing[w] or p in playing[w]) else 0) for p, v in Pn.items()}
                out.append((w - t0, M[w][r]['points'], best(roster, Pw, slots), best(M[w][r]['players'] or [], weekof[w], slots), form, lg))
a = np.array(out)
print('n', len(a))
print(' h   n    trade-time: b_proj  b_form  rmse | blend75 rmse | form-only rmse | week-of b_proj')
for lo, hi in [(1, 1), (2, 3), (4, 6), (7, 12)]:
    m = (a[:, 0] >= lo) & (a[:, 0] <= hi); y = a[m, 1]
    b, se, rm = ols([a[m, 2], a[m, 4]], y)
    r75 = np.sqrt(((y - (0.75 * a[m, 2] + 0.25 * a[m, 4])) ** 2).mean())
    _, _, rf = ols([a[m, 4]], y)
    bw, _, _ = ols([a[m, 3], a[m, 4]], y)
    # best fixed blend weight on projection (no intercept, weights sum to 1)
    ws = np.linspace(0, 1, 21); errs = [np.sqrt(((y - (wt * a[m, 2] + (1 - wt) * a[m, 4])) ** 2).mean()) for wt in ws]
    print(f'{lo}-{hi:<3} {m.sum():5}   %.2f    %.2f   %.2f |  %.2f | %.2f | %.2f   best blend w=%.2f (rmse %.2f)' % (b[1], b[2], rm, r75, rf, bw[1], ws[int(np.argmin(errs))], min(errs)))
