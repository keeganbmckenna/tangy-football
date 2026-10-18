"""Depth in roster values: does counting missed games predict a roster's lineup better?

The trade tools value a roster by its best lineup. Starters miss games (about 10% of
their team's next game, rising to 19% eight games out; QBs more), and the bench covers
them, so a roster's real best lineup depends on its depth. This takes every team's
roster at each week of 2022-2025, predicts its best-lineup points over the rest of the
regular season (up to 8 weeks) from the projections known then (carried forward, byes
zeroed), with and without random missed games, and compares with what that roster really
scored with the lineup a good manager would have set: each week the best lineup by that
week's pre-game projections (so players ruled out sit), scored with real points.
"""
import random, statistics as st
from collections import defaultdict
from common import J, leagues

HORIZON = 8
# Share of games missed by how many team games ahead, measured on 2022-2025 (RB/WR/TE)
MISS = [0.095, 0.126, 0.146, 0.164, 0.167, 0.175, 0.179, 0.19]
POSITION_FACTOR = {'QB': 1.27, 'RB': 1.0, 'WR': 1.0, 'TE': 1.0, 'K': 0.0, 'DEF': 0.0}
SCENARIOS = 64
FLEX = {'FLEX': {'RB', 'WR', 'TE'}, 'SUPER_FLEX': {'QB', 'RB', 'WR', 'TE'}}

def lineup(players, slots, actual=None):
    """Best lineup by points; players: list of (points, position[, id]). With actual, scores the chosen players' real points"""
    pool = sorted(players, key=lambda x: -x[0])
    used = [False] * len(pool)
    total = 0.0
    for s in slots:
        ok = FLEX.get(s, {s})
        for i, p in enumerate(pool):
            if not used[i] and p[1] in ok:
                used[i] = True
                total += p[0] if actual is None else ((actual.get(p[2]) or {}).get('pts_half_ppr') or 0.0)
                break
    return total

data = {}
for s in ('2022', '2023', '2024', '2025'):
    for w in range(1, 19):
        try: data[(s, w)] = (J(f'proj_{s}_{w}'), J(f'stats_{s}_{w}'), J(f'm_{s}_{w}'))
        except FileNotFoundError: pass
played = defaultdict(set)
for (s, w), (P, S, _) in data.items():
    for r in P:
        if (S.get(r['player_id']) or {}).get('gp') and r.get('team'): played[(s, w)].add(r['team'])

rng = random.Random(7)
rows = []
for (s, w), (P, S, M) in data.items():
    lg = leagues[s]
    end = lg['settings']['playoff_week_start'] - 1
    if w >= end or (s, w + 1) not in data: continue
    slots = sorted([x for x in lg['roster_positions'] if x not in ('BN', 'IR')], key=lambda x: len(FLEX.get(x, {x})))
    nxt = {r['player_id']: r for r in data[(s, w + 1)][0]}
    for m in M:
        roster = m.get('players') or []
        # Projections known after week w, carried forward
        info = {}
        for pid in roster:
            r = nxt.get(pid)
            if not r: continue
            pos = (r.get('player') or {}).get('position')
            info[pid] = (pos, r.get('team'), (r.get('stats') or {}).get('pts_half_ppr') or 0)
        pred_a = pred_b = real = 0.0
        k = 0
        for ww in range(w + 1, min(w + HORIZON, end) + 1):
            if (s, ww) not in data: continue
            k += 1
            week = [(pts if team in played[(s, ww)] else 0.0, pos) for pos, team, pts in info.values() if pos]
            pred_a += lineup(week, slots)
            miss = [MISS[min(k, HORIZON) - 1] * POSITION_FACTOR.get(pos, 1.0) for _, pos in week]
            acc = 0.0
            for _ in range(SCENARIOS):
                acc += lineup([(pts, pos) for (pts, pos), q in zip(week, miss) if rng.random() >= q], slots)
            pred_b += acc / SCENARIOS
            # The lineup a good manager sets that week: by its pre-game projections, real points
            pre = {r['player_id']: (r.get('stats') or {}).get('pts_half_ppr') or 0 for r in data[(s, ww)][0]}
            real += lineup([(pre.get(pid, 0), pos, pid) for pid, (pos, team, _) in info.items() if pos], slots, data[(s, ww)][1])
        if k: rows.append((pred_a / k, pred_b / k, real / k))

def corr(x, y):
    mx, my = st.mean(x), st.mean(y)
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / ((sum((a - mx) ** 2 for a in x) * sum((b - my) ** 2 for b in y)) ** 0.5)

A = [r[0] for r in rows]; B = [r[1] for r in rows]; R = [r[2] for r in rows]
print(f'{len(rows)} rosters (each held for up to {HORIZON} weeks); points per week')
print(f'actual points with a good manager setting the lineup: {st.mean(R):.1f}')
print(f'without missed games: predicted {st.mean(A):.1f} (bias {st.mean(R) - st.mean(A):+.1f}), correlation {corr(A, R):.3f}')
print(f'with missed games:    predicted {st.mean(B):.1f} (bias {st.mean(R) - st.mean(B):+.1f}), correlation {corr(B, R):.3f}')
# Does the depth adjustment explain what the plain prediction misses?
D = [b - a for a, b in zip(A, B)]
res = [r - a * st.mean(R) / st.mean(A) for a, r in zip(A, R)]
print(f'depth adjustment vs what the plain prediction missed: correlation {corr(D, res):.3f}')
