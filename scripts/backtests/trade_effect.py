"""How much of a trade's projected lineup change shows up in later scores (2022-2025 trades)."""
import json, os, statistics as st
import random
import numpy as np
from common import J, best, leagues, ols, D

rows = []
for season in ['2022', '2023', '2024', '2025']:
    L = leagues[season]; slots = L['roster_positions']; end = L['settings']['playoff_week_start'] - 1
    M = {w: {m['roster_id']: m for m in J(f'm_{season}_{w}')} for w in range(1, end + 1)}
    P = {}
    for w in range(1, end + 1):
        P[w] = {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0)
                for r in J(f'proj_{season}_{w}') if r.get('player') and r['player'].get('position')}
    allscores = [M[w][r]['points'] for w in M for r in M[w]]
    lg = st.mean(allscores)
    for w0 in range(1, 12):
        for t in J(f'tx_{season}_{w0}'):
            if t['type'] != 'trade' or t['status'] != 'complete' or not t.get('adds'): continue
            for r in t['roster_ids']:
                R = [p for p, x in t['adds'].items() if x == r]
                S = [p for p, x in (t['drops'] or {}).items() if x == r]
                past = [M[w][r]['points'] for w in range(1, w0 + 1) if w in M and w < w0 + 1]
                form = (sum(past) + 2 * lg) / (len(past) + 2)
                for w in range(w0 + 1, end + 1):
                    A = M[w][r]['players'] or []
                    C = [p for p in A if p not in R] + [p for p in S if p not in A]
                    bA, bC = best(A, P[w], slots), best(C, P[w], slots)
                    rows.append(dict(season=season, tid=t['transaction_id'], r=r, w0=w0, w=w,
                                     actual=M[w][r]['points'], bA=bA, bC=bC, d=bA - bC, form=form,
                                     # did the received players actually get started?
                                     startedR=sum(1 for p in R if p in (M[w][r]['starters'] or []))))
json.dump(rows, open(os.path.dirname(D) + '/rows.json', 'w'))
print(len(rows), 'team-weeks from', len({x['tid'] for x in rows}), 'trades')
d = np.array([x['d'] for x in rows]); y = np.array([x['actual'] for x in rows])
bC = np.array([x['bC'] for x in rows]); bA = np.array([x['bA'] for x in rows]); f = np.array([x['form'] for x in rows])
print('Δproj: mean %.2f  sd %.2f  |Δ|>3: %d%%' % (d.mean(), d.std(), 100 * (abs(d) > 3).mean()))
for name, X in [('actual ~ bC + form', [bC, f]), ('actual ~ bA + form', [bA, f]), ('actual ~ bC + Δ + form', [bC, d, f])]:
    b, se, rmse = ols(X, y); print(f'{name:28} coef', np.round(b, 3), 'se', np.round(se, 3), 'rmse %.2f' % rmse)
# the app's fixed model: 0.75*proj + 0.25*form
for lab, B in [('model w/ counterfactual roster', bC), ('model w/ actual roster', bA)]:
    pred = 0.75 * B + 0.25 * f; print(f'{lab:32} rmse %.3f  bias %.2f' % (np.sqrt(((y - pred) ** 2).mean()), (y - pred).mean()))
# residual slope on Δ given the app model with counterfactual roster
res = y - (0.75 * bC + 0.25 * f)
b, se, _ = ols([d], res); print('residual ~ Δ: slope %.3f ± %.3f' % (b[1], se[1]))
# cluster bootstrap by trade-team for honest SE
import random
random.seed(1); keys = sorted({(x['tid'], x['r']) for x in rows}); idx = {}
for i, x in enumerate(rows): idx.setdefault((x['tid'], x['r']), []).append(i)
sl = []
for _ in range(2000):
    ii = [i for k in random.choices(keys, k=len(keys)) for i in idx[k]]
    bb, _, _ = ols([d[ii]], res[ii]); sl.append(bb[1])
print('cluster-bootstrap slope 95%% CI: %.2f – %.2f' % tuple(np.percentile(sl, [2.5, 97.5])))

# Robustness: projections as known at trade time (next week's projection for every later week)
print('\n-- stale projections (as of the trade) --')
rows2 = []
for season in ['2022', '2023', '2024', '2025']:
    L = leagues[season]; slots = L['roster_positions']; end = L['settings']['playoff_week_start'] - 1
    M = {w: {m['roster_id']: m for m in J(f'm_{season}_{w}')} for w in range(1, end + 1)}
    for w0 in range(1, 12):
        Pn = {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0)
              for r in J(f'proj_{season}_{w0 + 1}') if r.get('player') and r['player'].get('position')}
        for t in J(f'tx_{season}_{w0}'):
            if t['type'] != 'trade' or t['status'] != 'complete' or not t.get('adds'): continue
            for r in t['roster_ids']:
                R = [p for p, x in t['adds'].items() if x == r]
                S = [p for p, x in (t['drops'] or {}).items() if x == r]
                A0 = M[w0 + 1][r]['players'] or []          # roster right after the trade
                C0 = [p for p in A0 if p not in R] + [p for p in S if p not in A0]
                ds = best(A0, Pn, slots) - best(C0, Pn, slots)
                for w in range(w0 + 1, end + 1):
                    x = next(z for z in rows if z['tid'] == t['transaction_id'] and z['r'] == r and z['w'] == w)
                    rows2.append((ds, x['actual'] - (0.75 * x['bC'] + 0.25 * x['form']), x['d'], w - w0))
ds = np.array([z[0] for z in rows2]); rr = np.array([z[1] for z in rows2]); dd = np.array([z[2] for z in rows2]); h = np.array([z[3] for z in rows2])
b, se, _ = ols([ds], rr); print('residual ~ Δ(at trade time): slope %.3f ± %.3f' % (b[1], se[1]))
for lo, hi in [(1, 2), (3, 5), (6, 13)]:
    m = (h >= lo) & (h <= hi); b, se, _ = ols([ds[m]], rr[m]); print(f'  weeks {lo}-{hi} after: slope %.2f ± %.2f (n={m.sum()})' % (b[1], se[1]))
print('corr(Δ at trade time, Δ week-of): %.2f' % np.corrcoef(ds, dd)[0, 1])

print('\n-- by horizon: week-of Δ vs trade-time Δ --')
for k in [1, 2, 3, 4, 6, 9]:
    m = (h == k) if k < 9 else (h >= 9)
    b1, s1, _ = ols([dd[m]], rr[m]); b2, s2, _ = ols([ds[m]], rr[m])
    print(f'h={k}{"+" if k==9 else ""}: n={m.sum():4} week-of %.2f±%.2f  trade-time %.2f±%.2f  corr %.2f' % (b1[1], s1[1], b2[1], s2[1], np.corrcoef(ds[m], dd[m])[0,1]))

print('\n-- trade-time projections, bye-aware --')
rows3 = []
for season in ['2022', '2023', '2024', '2025']:
    L = leagues[season]; slots = L['roster_positions']; end = L['settings']['playoff_week_start'] - 1
    M = {w: {m['roster_id']: m for m in J(f'm_{season}_{w}')} for w in range(1, end + 1)}
    raw = {w: J(f'proj_{season}_{w}') for w in range(1, end + 1)}
    playing = {w: {r['team'] for r in raw[w] if r.get('game_id') and r.get('team')} for w in raw}
    for w0 in range(1, 12):
        Pn = {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0, r.get('team'))
              for r in raw[w0 + 1] if r.get('player') and r['player'].get('position')}
        for t in J(f'tx_{season}_{w0}'):
            if t['type'] != 'trade' or t['status'] != 'complete' or not t.get('adds'): continue
            for r in t['roster_ids']:
                R = [p for p, x in t['adds'].items() if x == r]
                S = [p for p, x in (t['drops'] or {}).items() if x == r]
                A0 = M[w0 + 1][r]['players'] or []
                C0 = [p for p in A0 if p not in R] + [p for p in S if p not in A0]
                for w in range(w0 + 1, end + 1):
                    Pw = {p: (v[0], v[1] if (v[2] in playing[w] or v[0] == 'DEF' and p in playing[w]) else 0) for p, v in Pn.items()}
                    dsw = best(A0, Pw, slots) - best(C0, Pw, slots)
                    x = next(z for z in rows if z['tid'] == t['transaction_id'] and z['r'] == r and z['w'] == w)
                    rows3.append((dsw, x['actual'] - (0.75 * x['bC'] + 0.25 * x['form']), w - w0, x['tid'], r))
d3 = np.array([z[0] for z in rows3]); r3 = np.array([z[1] for z in rows3]); h3 = np.array([z[2] for z in rows3])
b, se, _ = ols([d3], r3); print('slope %.3f ± %.3f   sd(Δ) %.2f' % (b[1], se[1], d3.std()))
for lo, hi in [(1, 1), (2, 3), (4, 6), (7, 13)]:
    m = (h3 >= lo) & (h3 <= hi); b, se, _ = ols([d3[m]], r3[m]); print(f'  h {lo}-{hi}: slope %.2f ± %.2f (n={m.sum()})' % (b[1], se[1]))
keys3 = sorted({(z[3], z[4]) for z in rows3}); idx3 = {}
for i, z in enumerate(rows3): idx3.setdefault((z[3], z[4]), []).append(i)
sl = []
for _ in range(2000):
    ii = [i for k in random.choices(keys3, k=len(keys3)) for i in idx3[k]]
    bb, _, _ = ols([d3[ii]], r3[ii]); sl.append(bb[1])
print('cluster-bootstrap 95%% CI: %.2f – %.2f' % tuple(np.percentile(sl, [2.5, 97.5])))
# how often were received players still on the roster / started
kept = [x for x in rows]; print('received player still started in week: %.0f%% of team-weeks with a received player' % (100*np.mean([x['startedR']>0 for x in rows])))
