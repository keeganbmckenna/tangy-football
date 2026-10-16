import statistics as st, numpy as np, math, random
from common import J, best, leagues

G = []  # season, t0, h, won, dProjBye, dProjNoBye, dForm, sd
for season in ['2022', '2023', '2024', '2025']:
    L = leagues[season]; slots = L['roster_positions']; end = L['settings']['playoff_week_start'] - 1
    M = {w: {m['roster_id']: m for m in J(f'm_{season}_{w}')} for w in range(1, end + 1)}
    raw = {w: J(f'proj_{season}_{w}') for w in range(1, end + 1)}
    playing = {w: {r['team'] for r in raw[w] if r.get('game_id') and r.get('team')} for w in raw}
    for t0 in range(2, end):
        Pn = {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0, r.get('team'))
              for r in raw[t0 + 1] if r.get('player') and r['player'].get('position')}
        ids = list(M[t0 + 1]); lg = st.mean(M[w][r]['points'] for w in range(1, t0 + 1) for r in ids)
        form = {r: (sum(M[w][r]['points'] for w in range(1, t0 + 1)) + 2 * lg) / (t0 + 2) for r in ids}
        sq = sum((M[w][r]['points'] - st.mean(M[x][r]['points'] for x in range(1, t0 + 1))) ** 2 for r in ids for w in range(1, t0 + 1))
        sd = max(math.sqrt(sq / (len(ids) * (t0 - 1))), 15)
        projn = {r: best(M[t0 + 1][r]['players'] or [], {p: (v[0], v[1]) for p, v in Pn.items()}, slots) for r in ids}
        for w in range(t0 + 1, end + 1):
            Pb = {p: (v[0], v[1] if (v[2] in playing[w] or p in playing[w]) else 0) for p, v in Pn.items()}
            projb = {r: best(M[t0 + 1][r]['players'] or [], Pb, slots) for r in ids}
            seen = set()
            for r in ids:
                m = M[w][r]; o = next((x for x in M[w].values() if x['matchup_id'] == m['matchup_id'] and x['roster_id'] != r), None)
                if not o or o['roster_id'] in seen: continue
                seen.add(r); oi = o['roster_id']
                if m['points'] == o['points']: continue
                G.append((int(season), t0, w - t0, float(m['points'] > o['points']), projb[r] - projb[oi], projn[r] - projn[oi], form[r] - form[oi], sd))
np.save('games.npy', np.array(G)); print(len(G), 'game predictions')
