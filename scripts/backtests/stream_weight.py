"""Waiver pickups for empty slots, with the projection weight re-fitted (follow-up to streaming.py).

streaming.py swapped in lineups where a slot that would score 0 takes the best free agent,
but kept the projection weight (0.75) that was tuned on lineups with those holes. The two
are coupled, so this compares the rules each with its own weight, picked out of sample:
for each held-out season the weight is chosen on the other three by playoff Brier, then
the held-out season is scored. Same random draws for every variant.

Lineup rules: none (holes score 0), empty (holes take the best free agent who can play
them; no K/DEF streaming) and byes (only holes left by a rostered player on bye take a free
agent: the backtest freezes each player's projection at the snapshot week, so an injured
player leaves a hole for the rest of the season that the site wouldn't have). Weights: 0.6-1.0.
"""
import math, statistics as st
from collections import defaultdict
import numpy as np
from form_options import Season
from streaming import best_stream

SEASONS = ['2022', '2023', '2024', '2025']
WEIGHTS = [0.6, 0.7, 0.75, 0.8, 0.9, 1.0]
RULES = {'none': (None, None), 'empty': (None, 1), 'byes': (None, 1)}


def means_for(S, e, rosters):
    ids = S.ids
    lg = st.mean(S.M[w][r]['points'] for w in range(1, e) for r in ids)
    Pn = {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0, r.get('team'))
          for r in S.raw[e] if r.get('player') and r['player'].get('position')}
    tot, gp = {}, {}
    for w in range(1, e):
        for p, s in S.stats[w].items():
            g = s.get('gp') or 0
            if p in Pn and Pn[p][0] == 'DEF':
                g = 1 if (p in S.playing[w]) else 0
            if g:
                tot[p] = tot.get(p, 0) + (s.get('pts_half_ppr') or 0); gp[p] = gp.get(p, 0) + g
    rostered = {p for r in ids for p in rosters[r]}
    B = {name: {} for name in RULES}
    for w in range(e, S.end + 1):
        def on(p, v):
            pos, pts, team = Pn[p]
            return v if (team in S.playing[w] or p in S.playing[w]) else 0
        val = {p: (pos, on(p, 0.5 * pts + 0.5 * (tot.get(p, 0) + 3 * pts) / (gp.get(p, 0) + 3))) for p, (pos, pts, team) in Pn.items()}
        fa = {}
        for p, (pos, v) in val.items():
            if p not in rostered and v > 0: fa.setdefault(pos, []).append(v)
        for pos in fa: fa[pos].sort(reverse=True)
        # Rostered players projected to play but on bye this week (the holes 'byes' fills)
        bye = {r: [p for p in rosters[r] if p in Pn and Pn[p][1] > 0 and val[p][1] == 0] for r in ids}
        for name, (kr, er) in RULES.items():
            B[name][w] = np.array([best_stream(rosters[r], val, S.slots, fa, kr, er, bye[r] if name == 'byes' else None) for r in ids])
    out = {f'{name}@{wt}': {w: lg + wt * (b - b.mean()) for w, b in B[name].items()} for name in RULES for wt in WEIGHTS}
    sq = sum((S.M[w][r]['points'] - st.mean(S.M[x][r]['points'] for x in range(1, e))) ** 2 for r in ids for w in range(1, e))
    sd = max(math.sqrt(sq / (len(ids) * (e - 2))), 15)
    return out, sd


def main():
    rng = np.random.default_rng(41)
    se = defaultdict(lambda: defaultdict(list))  # variant -> season -> squared errors, in team order per snapshot
    for season in SEASONS:
        S = Season(season); _, made = S.final()
        for e in range(3, S.end + 1):
            rosters = {r: S.M[e][r]['players'] or [] for r in S.ids}
            means, sd = means_for(S, e, rosters)
            res, _ = S.simulate(e, means, sd, rng)
            for v in means:
                se[v][season] += list((res[v][1] - made) ** 2)
        print(season, 'done', flush=True)
    print('\nplayoff Brier by weight (all four seasons, in sample):')
    for name in RULES:
        print('  ' + name + ': ' + '  '.join(f"{wt}: {np.mean(sum((se[f'{name}@{wt}'][s] for s in SEASONS), [])):.4f}" for wt in WEIGHTS))
    print('\nout of sample (weight picked on the other three seasons):')
    held = defaultdict(list)
    for s in SEASONS:
        train = [x for x in SEASONS if x != s]
        line = []
        for name in RULES:
            wt = min(WEIGHTS, key=lambda w: np.mean(sum((se[f'{name}@{w}'][x] for x in train), [])))
            held[name] += se[f'{name}@{wt}'][s]
            line.append(f'{name} picks {wt} -> {np.mean(se[f"{name}@{wt}"][s]):.4f}')
        print(f'  held out {s}: ' + ';  '.join(line))
    for other in ('empty', 'byes'):
        compare(held, se, 'none', other)


def compare(held, se, base, other):
    a, b = np.array(held[base]), np.array(held[other])
    # Clustered by team-season: each season's block is snapshots x 12 teams
    cl, i = [], 0
    for s in SEASONS:
        n = len(se['none@0.75'][s]); blk = (b[i:i + n] - a[i:i + n]).reshape(-1, 12); cl += list(blk.mean(0)); i += n
    cl = np.array(cl); boot = np.random.default_rng(3).integers(0, len(cl), (4000, len(cl)))
    print(f'\n  {base} {a.mean():.4f}  {other} {b.mean():.4f}  difference {b.mean() - a.mean():+.4f} '
          f'(95% {np.percentile(cl[boot].mean(1), 2.5):+.4f} to {np.percentile(cl[boot].mean(1), 97.5):+.4f}, by team-season)')


if __name__ == '__main__':
    main()
