"""Does the share of a trade's projected lineup change that shows up depend on
whether the team received a star? Same method as trade_effect.py's trade-time,
bye-aware estimate, split by the best player received."""
import random
import statistics as st
import numpy as np
from common import J, best, leagues, ols

rows = []  # (delta, residual, weeks ahead, trade-side key, top received projection, top received position)
for season in ['2022', '2023', '2024', '2025']:
    L = leagues[season]; slots = L['roster_positions']; end = L['settings']['playoff_week_start'] - 1
    M = {w: {m['roster_id']: m for m in J(f'm_{season}_{w}')} for w in range(1, end + 1)}
    raw = {w: J(f'proj_{season}_{w}') for w in range(1, end + 1)}
    playing = {w: {r['team'] for r in raw[w] if r.get('game_id') and r.get('team')} for w in raw}
    weekof = {w: {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0) for r in raw[w] if r.get('player') and r['player'].get('position')} for w in raw}
    allscores = [M[w][r]['points'] for w in M for r in M[w]]
    for w0 in range(1, 12):
        if w0 + 1 > end: continue
        Pn = {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0, r.get('team'))
              for r in raw[w0 + 1] if r.get('player') and r['player'].get('position')}
        lg = st.mean(M[w][r]['points'] for w in range(1, w0 + 1) for r in M[w])
        for t in J(f'tx_{season}_{w0}'):
            if t['type'] != 'trade' or t['status'] != 'complete' or not t.get('adds'): continue
            for r in t['roster_ids']:
                R = [p for p, x in t['adds'].items() if x == r]
                S = [p for p, x in (t['drops'] or {}).items() if x == r]
                if not R: continue
                top = max(R, key=lambda p: Pn.get(p, ('', 0, ''))[1])
                topProj, topPos = Pn.get(top, ('', 0, ''))[1], Pn.get(top, ('?', 0, ''))[0]
                past = [M[w][r]['points'] for w in range(1, w0 + 1)]
                form = (sum(past) + 2 * lg) / (len(past) + 2)
                A0 = M[w0 + 1][r]['players'] or []
                C0 = [p for p in A0 if p not in R] + [p for p in S if p not in A0]
                for w in range(w0 + 1, end + 1):
                    Pw = {p: (v[0], v[1] if (v[2] in playing[w] or p in playing[w]) else 0) for p, v in Pn.items()}
                    ds = best(A0, Pw, slots) - best(C0, Pw, slots)
                    A = M[w][r]['players'] or []
                    C = [p for p in A if p not in R] + [p for p in S if p not in A]
                    bC = best(C, weekof[w], slots)
                    rows.append((ds, M[w][r]['points'] - (0.75 * bC + 0.25 * form), w - w0, (t['transaction_id'], r), topProj, topPos))

d = np.array([x[0] for x in rows]); res = np.array([x[1] for x in rows]); h = np.array([x[2] for x in rows]); top = np.array([x[4] for x in rows])
keys = [x[3] for x in rows]
def slope_ci(m):
    idx = {}
    for i in np.where(m)[0]: idx.setdefault(keys[i], []).append(i)
    ks = list(idx); b, se, _ = ols([d[m]], res[m]); bs = []
    random.seed(4)
    for _ in range(1500):
        ii = [i for k in random.choices(ks, k=len(ks)) for i in idx[k]]
        bs.append(ols([d[ii]], res[ii])[0][1])
    return b[1], np.percentile(bs, 2.5), np.percentile(bs, 97.5), len(ks), m.sum()
print('top received player projected (pts/wk at trade time)')
for lo, hi, lab in [(0, 12, 'under 12'), (12, 15, '12-15'), (15, 99, '15+ (star)')]:
    m = (top >= lo) & (top < hi)
    b, l, u, n, tw = slope_ci(m)
    print(f'  {lab:11} sides={n:3} team-weeks={tw:4}  share showing up {b:.2f}  (95% CI {l:.2f} to {u:.2f})')
    for hlo, hhi in [(1, 3), (4, 13)]:
        mm = m & (h >= hlo) & (h <= hhi); b2, l2, u2, n2, _ = slope_ci(mm)
        print(f'      weeks {hlo}-{hhi} ahead: {b2:.2f} ({l2:.2f} to {u2:.2f})')

# Split by the size of the side's net projected lineup change (average over its weeks)
avg = {}
for x in rows: avg.setdefault(x[3], []).append(x[0])
size = np.array([abs(np.mean(avg[k])) for k in keys])
print('\nsize of the net projected lineup change (pts/wk, either direction)')
for lo, hi in [(0, 3), (3, 6), (6, 99)]:
    m = (size >= lo) & (size < hi)
    b, l, u, n, tw = slope_ci(m)
    print(f'  {lo}-{hi if hi < 99 else "+"}: sides={n:3}  share showing up {b:.2f}  (95% CI {l:.2f} to {u:.2f})')

print('\nbig changes (6+ pts/wk) by weeks ahead')
for hlo, hhi in [(1, 1), (2, 3), (4, 13), (1, 13)]:
    m = (size >= 6) & (h >= hlo) & (h <= hhi)
    b, l, u, n, tw = slope_ci(m)
    print(f'  {hlo}-{hhi}: team-weeks={tw:4}  {b:.2f} ({l:.2f} to {u:.2f})')
print('\nall changes 3+ pts/wk by weeks ahead')
for hlo, hhi in [(1, 1), (2, 3), (4, 13), (1, 13)]:
    m = (size >= 3) & (h >= hlo) & (h <= hhi)
    b, l, u, n, tw = slope_ci(m)
    print(f'  {hlo}-{hhi}: team-weeks={tw:4}  {b:.2f} ({l:.2f} to {u:.2f})')
