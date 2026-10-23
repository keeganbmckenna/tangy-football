"""Season-level backtest: playoff and bye odds at each week vs what actually happened
(writes season.pkl; several minutes)."""
import statistics as st, numpy as np, math
from common import J, best, leagues
rng = np.random.default_rng(7); N = 4000
def seeds(wins, pf, div, has_div):
    # wins: (N,T) arrays; returns (N,T) seed rank 1..T (playoff seeds 1-6 per league rules)
    val = wins + pf / (pf.max(axis=1, keepdims=True) + 1)
    order = np.argsort(-val, axis=1)
    if not has_div: return np.argsort(order, axis=1) + 1
    Nn, T = wins.shape; seed = np.zeros((Nn, T), int)
    for n in range(Nn):
        o = list(order[n]); leaders = []
        for d in sorted(set(div)):
            leaders.append(next(t for t in o if div[t] == d))
        rest = [t for t in o if t not in leaders]
        for i, t in enumerate(leaders + rest): seed[n, t] = i + 1
    return seed
VARIANTS = {
    'current':                 dict(k=1.0, s=1.0),
    'widen later weeks x1.6':  dict(k=1.0, s=1.6),
    'widen later weeks x2.0':  dict(k=1.0, s=2.0),
    'shrink later means x0.6': dict(k=0.6, s=1.0),
    'shrink later means x0.5': dict(k=0.5, s=1.0),
    'shrink x0.7 + widen x1.4':dict(k=0.7, s=1.4),
    'form only':               dict(k=None, s=1.0),
}
out = {v: [] for v in VARIANTS}
for season in ['2022', '2023', '2024', '2025']:
    L = leagues[season]; slots = L['roster_positions']; end = L['settings']['playoff_week_start'] - 1
    has_div = bool(L['settings'].get('divisions'))
    R = J(f'rosters_{season}'); ids = sorted(r['roster_id'] for r in R)
    ix = {r: i for i, r in enumerate(ids)}; div = [next(x['settings'].get('division') or 0 for x in R if x['roster_id'] == r) for r in ids]
    M = {w: {m['roster_id']: m for m in J(f'm_{season}_{w}')} for w in range(1, end + 1)}
    raw = {w: J(f'proj_{season}_{w}') for w in range(1, end + 1)}
    playing = {w: {r['team'] for r in raw[w] if r.get('game_id') and r.get('team')} for w in raw}
    def results(w):
        res = []
        for r in ids:
            m = M[w][r]; o = next(x for x in M[w].values() if x['matchup_id'] == m['matchup_id'] and x['roster_id'] != r)
            res.append((r, o['roster_id'], m['points'], o['points']))
        return res
    # truth
    W = np.zeros(12); PF = np.zeros(12)
    for w in range(1, end + 1):
        for r, o, a, b in results(w): W[ix[r]] += 1 if a > b else 0.5 if a == b else 0; PF[ix[r]] += a
    tseed = seeds(W[None], PF[None], div, has_div)[0]
    made, bye = (tseed <= 6).astype(float), (tseed <= 2).astype(float)
    for t0 in range(2, end):
        W0 = np.zeros(12); PF0 = np.zeros(12)
        for w in range(1, t0 + 1):
            for r, o, a, b in results(w): W0[ix[r]] += 1 if a > b else 0.5 if a == b else 0; PF0[ix[r]] += a
        lg = st.mean(M[w][r]['points'] for w in range(1, t0 + 1) for r in ids)
        form = np.array([(sum(M[w][r]['points'] for w in range(1, t0 + 1)) + 2 * lg) / (t0 + 2) for r in ids])
        sq = sum((M[w][r]['points'] - st.mean(M[x][r]['points'] for x in range(1, t0 + 1))) ** 2 for r in ids for w in range(1, t0 + 1))
        sd = max(math.sqrt(sq / (12 * (t0 - 1))), 15)
        Pn = {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0, r.get('team')) for r in raw[t0 + 1] if r.get('player') and r['player'].get('position')}
        proj = {}
        for w in range(t0 + 1, end + 1):
            Pb = {p: (v[0], v[1] if (v[2] in playing[w] or p in playing[w]) else 0) for p, v in Pn.items()}
            proj[w] = np.array([best(M[t0 + 1][r]['players'] or [], Pb, slots) for r in ids])
        for name, v in VARIANTS.items():
            Wv = np.repeat(W0[None], N, 0); PFv = np.repeat(PF0[None], N, 0)
            for w in range(t0 + 1, end + 1):
                h = w - t0
                mean = form if v['k'] is None else 0.75 * proj[w] + 0.25 * form
                if v['k'] is not None and h > 1: mean = lg + v['k'] * (mean - lg)
                s = sd * (v['s'] if h > 1 else 1.0)
                sc = mean[None] + s * rng.standard_normal((N, 12))
                for r, o, _, _ in results(w):
                    if r < o:
                        a, b = ix[r], ix[o]; Wv[:, a] += sc[:, a] > sc[:, b]; Wv[:, b] += sc[:, b] > sc[:, a]
                PFv += sc
            sd_ = seeds(Wv, PFv, div, has_div)
            pm, pb = (sd_ <= 6).mean(0), (sd_ <= 2).mean(0)
            out[name].append((season, t0, pm, pb, made, bye))
    print(season, 'done', flush=True)
import pickle; pickle.dump(out, open('season.pkl', 'wb'))
