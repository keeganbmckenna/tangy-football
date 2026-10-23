"""Which trade weighting predicts what actually happened after each trade?

For every 2022-2025 trade, simulate the rest of the regular season from the
week it counted from (records, rosters and projections known then) under:
  - ignore: the trade doesn't change anyone's expected score
  - damped: the analyzer's original shares of the lineup change (70/45/25%)
  - model:  the playoff model's own projection weight (75%) every week, i.e.
            treat the new roster exactly like any other roster
and score each trading team's predicted rest-of-season wins and playoff odds
against what happened. Prints squared error of wins and Brier of playoffs.
"""
import json, random, statistics as st, math
import numpy as np
from common import J, best, leagues

rng = np.random.default_rng(11); N = 3000
VARIANTS = {
    'ignore': lambda h: 0.0,
    'damped': lambda h: 0.7 if h <= 1 else 0.45 if h <= 3 else 0.25,
    'model': lambda h: 0.75,
}

def seeds(wins, pf, div, has_div):
    val = wins + pf / (pf.max(axis=1, keepdims=True) + 1)
    order = np.argsort(-val, axis=1)
    if not has_div:
        return np.argsort(order, axis=1) + 1
    n_sims, T = wins.shape; seed = np.zeros((n_sims, T), int)
    for n in range(n_sims):
        o = list(order[n]); leaders = [next(t for t in o if div[t] == d) for d in sorted(set(div))]
        rest = [t for t in o if t not in leaders]
        for i, t in enumerate(leaders + rest): seed[n, t] = i + 1
    return seed

out = []  # (variant, trade key, rosterId, predicted wins, actual wins, p playoffs, made)
for season in ['2022', '2023', '2024', '2025']:
    L = leagues[season]; slots = L['roster_positions']; end = L['settings']['playoff_week_start'] - 1
    has_div = bool(L['settings'].get('divisions'))
    R = J(f'rosters_{season}'); ids = sorted(r['roster_id'] for r in R)
    ix = {r: i for i, r in enumerate(ids)}
    div = [next(x['settings'].get('division') or 0 for x in R if x['roster_id'] == r) for r in ids]
    M = {w: {m['roster_id']: m for m in J(f'm_{season}_{w}')} for w in range(1, end + 1)}
    raw = {w: J(f'proj_{season}_{w}') for w in range(1, end + 1)}
    playing = {w: {r['team'] for r in raw[w] if r.get('game_id') and r.get('team')} for w in raw}
    def games(w):
        seen, g = set(), []
        for r in ids:
            m = M[w][r]; o = next(x for x in M[w].values() if x['matchup_id'] == m['matchup_id'] and x['roster_id'] != r)
            if (o['roster_id'], r) not in seen:
                seen.add((r, o['roster_id'])); g.append((r, o['roster_id'], m['points'], o['points']))
        return g
    def record(through):
        W = np.zeros(12); PF = np.zeros(12)
        for w in range(1, through + 1):
            for a, b, pa, pb in games(w):
                W[ix[a]] += 1 if pa > pb else 0.5 if pa == pb else 0; W[ix[b]] += 1 if pb > pa else 0.5 if pa == pb else 0
                PF[ix[a]] += pa; PF[ix[b]] += pb
        return W, PF
    Wf, PFf = record(end)
    made = (seeds(Wf[None], PFf[None], div, has_div)[0] <= 6).astype(float)
    for leg in range(1, 12):
        for t in J(f'tx_{season}_{leg}'):
            if t['type'] != 'trade' or t['status'] != 'complete' or not t.get('adds'): continue
            sides = {r: ([p for p, x in t['adds'].items() if x == r], [p for p, x in (t['drops'] or {}).items() if x == r]) for r in t['roster_ids']}
            landed = any(p in (M[leg][r]['players'] or []) for r, (rec, _) in sides.items() for p in rec)
            e = leg if landed else leg + 1
            if e > end or e < 2: continue
            W0, PF0 = record(e - 1)
            Pn = {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0, r.get('team')) for r in raw[e] if r.get('player') and r['player'].get('position')}
            lg = st.mean(M[w][r]['points'] for w in range(1, e) for r in ids)
            form = np.array([(sum(M[w][r]['points'] for w in range(1, e)) + 2 * lg) / (e + 1) for r in ids])
            if e > 2:
                sq = sum((M[w][r]['points'] - st.mean(M[x][r]['points'] for x in range(1, e))) ** 2 for r in ids for w in range(1, e))
                sd = max(math.sqrt(sq / (12 * (e - 2))), 15)
            else:
                sd = 25
            after = {r: M[e][r]['players'] or [] for r in ids}
            before = dict(after)
            for r, (rec, sent) in sides.items():
                before[r] = [p for p in after[r] if p not in rec] + [p for p in sent if p not in after[r]]
            means = {}
            for name, wt in VARIANTS.items():
                means[name] = {}
            for w in range(e, end + 1):
                Pw = {p: (v[0], v[1] if (v[2] in playing[w] or p in playing[w]) else 0) for p, v in Pn.items()}
                pb = np.array([best(before[r], Pw, slots) for r in ids])
                pa = np.array([best(after[r], Pw, slots) for r in ids])
                base = 0.75 * (lg + pb - pb.mean()) + 0.25 * form
                for name, wt in VARIANTS.items():
                    means[name][w] = base + wt(w - e + 1) * (pa - pb)
            # Same random draws for every variant
            noise = {w: rng.standard_normal((N, 12)) for w in range(e, end + 1)}
            Wact, _ = record(end)
            for name in VARIANTS:
                Wv = np.repeat(W0[None], N, 0); PFv = np.repeat(PF0[None], N, 0)
                for w in range(e, end + 1):
                    sc = means[name][w][None] + sd * noise[w]
                    for a, b, _, _ in games(w):
                        Wv[:, ix[a]] += sc[:, ix[a]] > sc[:, ix[b]]; Wv[:, ix[b]] += sc[:, ix[b]] > sc[:, ix[a]]
                    PFv += sc
                pm = (seeds(Wv, PFv, div, has_div) <= 6).mean(0)
                for r in sides:
                    i = ix[r]
                    out.append((name, t['transaction_id'], r, Wv[:, i].mean() - W0[i], Wact[i] - W0[i], pm[i], made[i]))
    print(season, 'done', flush=True)

json.dump(out, open('trade_season.json', 'w'))
keys = sorted({(x[1], x[2]) for x in out}); trades = sorted({x[1] for x in out})
by = {(x[0], x[1], x[2]): x for x in out}
def score(name, tr):
    xs = [by[(name, t, r)] for t, r in keys if t in tr]
    return np.mean([(x[3] - x[4]) ** 2 for x in xs]), np.mean([(x[5] - x[6]) ** 2 for x in xs])
print(f'{len(trades)} trades, {len(keys)} trading teams')
for name in VARIANTS:
    w, b = score(name, set(trades)); print(f'  {name:7} wins squared error {w:.3f}   playoffs Brier {b:.4f}')
random.seed(5)
for a, b in [('model', 'damped'), ('damped', 'ignore'), ('model', 'ignore')]:
    dw, db = [], []
    for _ in range(2000):
        s = set(random.choices(trades, k=len(trades)))
        sa, sb = score(a, s), score(b, s); dw.append(sb[0] - sa[0]); db.append(sb[1] - sa[1])
    print(f'  {a} better than {b}: wins error {np.mean(dw):+.3f} (95% CI {np.percentile(dw, 2.5):+.3f} to {np.percentile(dw, 97.5):+.3f}), Brier {np.mean(db):+.4f} (95% CI {np.percentile(db, 2.5):+.4f} to {np.percentile(db, 97.5):+.4f})')
