"""Live tab win odds at kickoff (before any points): calibration on 2022-2025.

Each matchup's odds come from the starters' Sleeper projections (made just before the
games, so players already ruled out are projected near zero) and a spread: either one spread for every team (the
playoff odds model's pooled week-to-week spread times a scale) or per-player spreads
from each starter's boom-or-bust history, scaled so the average lineup matches it.
Compares log loss and Brier score, and how the scale should be set.
"""
import math, statistics as st
from collections import defaultdict
from common import J, leagues

RULED_OUT = {'Out', 'IR', 'PUP', 'Sus', 'NA', 'DNR', 'COV'}
POS_RATIO = {'QB': 0.45, 'RB': 0.6, 'WR': 0.6, 'TE': 0.65, 'K': 0.55, 'DEF': 0.6}
PRIOR = 4

def ratio(pos, scores):
    prior = POS_RATIO.get(pos, 0.75)
    n = len(scores)
    if n < 2: return prior
    m = st.mean(scores)
    if m <= 1: return prior
    return (n * min(st.stdev(scores) / m, 2) + PRIOR * prior) / (n + PRIOR)

def cdf(z): return 0.5 * (1 + math.erf(z / math.sqrt(2)))

games = []  # (season, week, mean_a, mean_b, var_a_raw, var_b_raw, spread, result_a, mean_a_noinj, mean_b_noinj)
for season, lg in sorted(leagues.items()):
    if season == '2026': continue
    end = lg['settings']['playoff_week_start'] - 1
    history = defaultdict(list)   # player -> weekly half-PPR points so far
    team_scores = defaultdict(list)
    for w in range(1, end + 1):
        try:
            ms, proj, stats = J(f'm_{season}_{w}'), J(f'proj_{season}_{w}'), J(f'stats_{season}_{w}')
        except FileNotFoundError:
            continue
        pm = {r['player_id']: r for r in proj}
        if w >= 3:
            sq = n = 0
            for s in team_scores.values():
                if len(s) < 2: continue
                m = st.mean(s); sq += sum((v - m) ** 2 for v in s); n += len(s) - 1
            spread = max(math.sqrt(sq / n), 15) if n else 25
            by = defaultdict(list)
            for m in ms: by[m['matchup_id']].append(m)
            for pair in by.values():
                if len(pair) != 2 or not pair[0]['points'] or not pair[1]['points']: continue
                sides = []
                for m in pair:
                    mean = mean_raw = var = 0.0
                    for pid in m['starters']:
                        r = pm.get(pid)
                        if not r or pid == '0': continue
                        pts = (r.get('stats') or {}).get('pts_half_ppr') or 0
                        inj = (r.get('player') or {}).get('injury_status')
                        pos = (r.get('player') or {}).get('position')
                        adj = 0 if inj in RULED_OUT else pts * 0.3 if inj == 'Doubtful' else pts
                        mean += adj; mean_raw += pts
                        var += (ratio(pos, history[pid]) * pts) ** 2
                    sides.append((mean, var, mean_raw))
                a, b = pair
                res = 1 if a['points'] > b['points'] else 0 if a['points'] < b['points'] else 0.5
                games.append((season, w, sides[0][0], sides[1][0], sides[0][1], sides[1][1], spread, res, sides[0][2], sides[1][2]))
        for pid, s in stats.items():
            if s.get('gp'): history[pid].append(s.get('pts_half_ppr') or 0)
        for m in ms:
            if m['points']: team_scores[m['roster_id']].append(m['points'])

# Per-week scale for player spreads: the week's average lineup variance -> (k * spread)^2
week_avg = defaultdict(list)
for g in games: week_avg[(g[0], g[1])] += [g[4], g[5]]
week_avg = {k: st.mean(v) for k, v in week_avg.items()}

def score(k, per_player=True, injuries=False):
    ll = br = 0.0
    for season, w, ma, mb, va, vb, spread, res, ra, rb in games:
        diff = (ma - mb) if injuries else (ra - rb)
        full = (k * spread) ** 2
        sd = math.sqrt(full * (va + vb) / week_avg[(season, w)]) if per_player else math.sqrt(2 * full)
        p = min(max(cdf(diff / sd), 1e-6), 1 - 1e-6)
        ll -= res * math.log(p) + (1 - res) * math.log(1 - p)
        br += (p - res) ** 2
    return ll / len(games), br / len(games)

print(f'{len(games)} matchups, 2022-2025 weeks 3+')
print('coin flip                    log loss 0.6931  Brier 0.2500')
for k in (0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2):
    a, b = score(k), score(k, per_player=False)
    print(f'scale {k:.1f}: player spreads  log loss {a[0]:.4f} Brier {a[1]:.4f} | one spread  {b[0]:.4f} {b[1]:.4f}')
best = min((score(k / 100)[0], k / 100) for k in range(50, 151))
print(f'best scale, player spreads: {best[1]:.2f} (log loss {best[0]:.4f})')
best1 = min((score(k / 100, per_player=False)[0], k / 100) for k in range(50, 151))
print(f'best scale, one spread:     {best1[1]:.2f} (log loss {best1[0]:.4f})')
# The archive's injury statuses are as of when it was fetched (after the season), not the game,
# so they can't be tested here: a player hurt later shows as out for games he played
print('with archived (later) injury statuses applied: log loss %.4f' % score(best[1], injuries=True)[0])

# Calibration at the best scale
bins = defaultdict(lambda: [0, 0.0, 0.0])
for season, w, ma, mb, va, vb, spread, res, ra, rb in games:
    full = (best[1] * spread) ** 2
    p = cdf((ra - rb) / math.sqrt(full * (va + vb) / week_avg[(season, w)]))
    for q, r in ((p, res), (1 - p, 1 - res)):
        if q < 0.5: continue
        bn = min(int(q * 10), 9)
        bins[bn][0] += 1; bins[bn][1] += q; bins[bn][2] += r
print('calibration (favorite odds -> how often the favorite won):')
for bn in sorted(bins):
    n, q, r = bins[bn]
    print(f'  {bn * 10}-{bn * 10 + 10}%: {n:4d} games, predicted {q / n:.1%}, won {r / n:.1%}')
