"""Leave-one-season-out check of the parameters tuned on this league's results.

Five of the model's numbers were picked by comparing variants on 2022-2025:

  PROJECTION_WEIGHT 0.75  a team's expected score is the league average plus this share of
                          how far its best lineup is from the league's
  SEASON_SHARE 0.5        a player's value: this share his season points per game, the rest
                          his projection
  PLAYER_SHRINK_GAMES 3   games of projection his season points per game is padded with
  win-odds spread 0.8/2   one game's spread: 0.8x the weekly spread next week, 2x later
  LIVE_SPREAD_SCALE 0.7   the Live tab's whole-game spread at kickoff

For each season, the values are picked on the other three and scored on that one, so every
score is out of sample. Each is tuned on the outcome it controls, using the most data:
weekly team scores (every team, every snapshot week 3+, every later week) for the first
three, single games for the spreads, kickoff matchups for the live scale. Playoff odds
(Brier) are then scored for the current values, the leave-one-season-out picks, and a
no-fitting baseline (Sleeper projections at face value). Stable picks across folds that
score like the current values mean the current values aren't overfit; picks that jump
around mean the data can't pin that parameter down.
"""
import contextlib, io, math, runpy, statistics as st
from collections import defaultdict
import numpy as np
from common import best
from form_options import Season

SEASONS = ['2022', '2023', '2024', '2025']
SHARES = [0.0, 0.25, 0.5, 0.75, 1.0]      # season share (0 = projection only)
SHRINKS = [1, 3, 6, 10]
WEIGHTS = [round(x, 2) for x in np.arange(0.4, 1.21, 0.05)]
S_NEXT = [round(x, 2) for x in np.arange(0.5, 1.61, 0.1)]
S_LATER = [round(x, 2) for x in np.arange(1.0, 3.01, 0.2)]
CURRENT = dict(share=0.5, shrink=3, weight=0.75, s1=0.8, sl=2.0)
NO_FIT = dict(share=0.0, shrink=3, weight=1.0, s1=1.0, sl=1.0)


def cdf(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def lineups(S, e):
    """Best-lineup points per (share, shrink) for every team and remaining week, from week e's projections"""
    Pn = {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0, r.get('team'))
          for r in S.raw[e] if r.get('player') and r['player'].get('position')}
    tot, gp = {}, {}
    for w in range(1, e):
        for p, s in S.stats[w].items():
            g = s.get('gp') or 0
            if p in Pn and Pn[p][0] == 'DEF':
                g = 1 if p in S.playing[w] else 0
            if g:
                tot[p] = tot.get(p, 0) + (s.get('pts_half_ppr') or 0); gp[p] = gp.get(p, 0) + g
    rosters = {r: S.M[e][r]['players'] or [] for r in S.ids}
    out = {}
    for a in SHARES:
        for k in (SHRINKS if a > 0 else [3]):
            byw = {}
            for w in range(e, S.end + 1):
                val = {}
                for p, (pos, pts, team) in Pn.items():
                    ppg = (tot.get(p, 0) + k * pts) / (gp.get(p, 0) + k)
                    v = 0 if pts <= 0 else (1 - a) * pts + a * ppg
                    val[p] = (pos, v if (team in S.playing[w] or p in S.playing[w]) else 0)
                byw[w] = np.array([best(rosters[r], val, S.slots) for r in S.ids])
            out[(a, k)] = byw
    return out


def collect():
    """Per season: snapshots with league average, spread, lineups and actual results"""
    data = {}
    for season in SEASONS:
        S = Season(season); snaps = []
        for e in range(3, S.end + 1):
            ids = S.ids
            lg = st.mean(S.M[w][r]['points'] for w in range(1, e) for r in ids)
            sq = sum((S.M[w][r]['points'] - st.mean(S.M[x][r]['points'] for x in range(1, e))) ** 2 for r in ids for w in range(1, e))
            sd = max(math.sqrt(sq / (len(ids) * (e - 2))), 15)
            actual = {w: np.array([S.M[w][r]['points'] for r in ids]) for w in range(e, S.end + 1)}
            games = [(w, S.ix[a], S.ix[b], float(pa > pb)) for w in range(e, S.end + 1) for a, b, pa, pb in S.games(w) if pa != pb]
            snaps.append(dict(e=e, lg=lg, sd=sd, L=lineups(S, e), actual=actual, games=games))
        data[season] = (S, snaps)
        print(season, 'collected', flush=True)
    return data


def mean_of(snap, c, w):
    B = snap['L'][(c['share'], c['shrink'] if c['share'] > 0 else 3)][w]
    return snap['lg'] + c['weight'] * (B - B.mean())


def points_mse(data, seasons, c):
    err = n = 0.0
    for s in seasons:
        for snap in data[s][1]:
            for w, y in snap['actual'].items():
                d = y - mean_of(snap, c, w); err += float(d @ d); n += len(y)
    return err / n


def game_ll(data, seasons, c):
    ll = n = 0.0
    for s in seasons:
        for snap in data[s][1]:
            for w, ia, ib, won in snap['games']:
                m = mean_of(snap, c, w); sc = c['s1'] if w == snap['e'] else c['sl']
                p = min(max(cdf((m[ia] - m[ib]) / (sc * snap['sd'] * math.sqrt(2))), 1e-6), 1 - 1e-6)
                ll -= math.log(p if won else 1 - p); n += 1
    return ll / n


def tune(data, train):
    """Value picks on the training seasons: lineup parameters on weekly points, then spreads on games"""
    best_c = min(({**CURRENT, 'share': a, 'shrink': k, 'weight': wt} for a in SHARES for k in (SHRINKS if a > 0 else [3]) for wt in WEIGHTS),
                 key=lambda c: points_mse(data, train, c))
    s1 = min(S_NEXT, key=lambda x: game_ll(data, train, {**best_c, 's1': x, 'sl': best_c['sl']}))
    sl = min(S_LATER, key=lambda x: game_ll(data, train, {**best_c, 's1': s1, 'sl': x}))
    return {**best_c, 's1': s1, 'sl': sl}


def playoff_brier(data, season, c, rng):
    """Season simulation with these values (the site's model), scored on who made the playoffs"""
    S, snaps = data[season]
    Wf, made = S.final(); se = []
    for snap in snaps:
        e = snap['e']
        means = {'x': {w: mean_of(snap, c, w) for w in range(e, S.end + 1)}}
        res, _ = S.simulate(e, means, snap['sd'], rng)
        se += list((res['x'][1] - made) ** 2)
    return se


def live_scale():
    """LIVE_SPREAD_SCALE: per-season out-of-sample pick from live_pregame.py's matchups"""
    with contextlib.redirect_stdout(io.StringIO()):
        ns = runpy.run_path('live_pregame.py')
    games, week_avg, cdf_ = ns['games'], ns['week_avg'], ns['cdf']

    def ll(k, seasons):
        tot = n = 0.0
        for season, w, ma, mb, va, vb, spread, res, ra, rb in games:
            if season not in seasons: continue
            sd = math.sqrt((k * spread) ** 2 * (va + vb) / week_avg[(season, w)])
            p = min(max(cdf_((ra - rb) / sd), 1e-6), 1 - 1e-6)
            tot -= res * math.log(p) + (1 - res) * math.log(1 - p); n += 1
        return tot / n, n
    grid = [k / 100 for k in range(40, 151, 5)]
    print('\nLIVE_SPREAD_SCALE (kickoff matchups, log loss):')
    tot = {'current 0.7': 0.0, 'held-out pick': 0.0, 'no fitting (1.0)': 0.0}; N_ = 0
    for s in SEASONS:
        train = [x for x in SEASONS if x != s]
        k = min(grid, key=lambda g: ll(g, train)[0])
        (a, n), (b, _), (c, _) = ll(0.7, [s]), ll(k, [s]), ll(1.0, [s])
        tot['current 0.7'] += a * n; tot['held-out pick'] += b * n; tot['no fitting (1.0)'] += c * n; N_ += n
        print(f'  held out {s}: picked {k:.2f} on the others | {s}: current {a:.4f}  pick {b:.4f}  no fitting {c:.4f}  ({n} games)')
    print('  overall: ' + '  '.join(f'{name} {v / N_:.4f}' for name, v in tot.items()))


def spreads_only(data):
    """The win-odds spreads alone, with the lineup values at their current settings (the
    joint pick confounds them: a smaller projection weight already narrows the odds)"""
    print('\nwin-odds spreads alone (lineup values as now), single-game log loss:')
    tot = defaultdict(float); n = 0; diffs = []
    for s in SEASONS:
        train = [x for x in SEASONS if x != s]
        s1 = min(S_NEXT, key=lambda x: game_ll(data, train, {**CURRENT, 's1': x}))
        sl = min(S_LATER, key=lambda x: game_ll(data, train, {**CURRENT, 's1': s1, 'sl': x}))
        k = sum(len(snap['games']) for snap in data[s][1])
        line = []
        for name, c in (('current 0.8/2.0', CURRENT), ('held-out pick', {**CURRENT, 's1': s1, 'sl': sl}), ('no scaling 1.0/1.0', {**CURRENT, 's1': 1.0, 'sl': 1.0})):
            v = game_ll(data, [s], c); tot[name] += v * k; line.append(v)
        # Per snapshot differences (pick - current), for an interval clustered by snapshot
        for snap in data[s][1]:
            one = lambda c: game_ll({s: (None, [snap])}, [s], c) * len(snap['games'])
            diffs.append((one({**CURRENT, 's1': s1, 'sl': sl}) - one(CURRENT), len(snap['games'])))
        n += k
        print(f'  held out {s}: picked {s1} next week / {sl} later | {s}: current {line[0]:.4f}  pick {line[1]:.4f}  no scaling {line[2]:.4f}')
    print('  overall: ' + '  '.join(f'{name} {v / n:.4f}' for name, v in tot.items()))
    d = np.array(diffs); b = np.random.default_rng(8).integers(0, len(d), (4000, len(d)))
    boot = d[b, 0].sum(1) / d[b, 1].sum(1)
    print(f'  pick - current: {d[:, 0].sum() / d[:, 1].sum():+.4f}  95% [{np.percentile(boot, 2.5):+.4f}, {np.percentile(boot, 97.5):+.4f}] (clustered by snapshot)')


def cached_collect():
    import os, pickle
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'loso.pkl')
    if os.path.exists(path):
        data = pickle.load(open(path, 'rb'))
        return {s: (Season(s), snaps) for s, snaps in data.items()}
    data = collect()
    pickle.dump({s: snaps for s, (_, snaps) in data.items()}, open(path, 'wb'))
    return data


def main():
    data = cached_collect()
    spreads_only(data)
    print('\nleave-one-season-out picks (share, shrink, weight, s_next, s_later):')
    rows = defaultdict(lambda: defaultdict(float))
    brier = defaultdict(list)
    for s in SEASONS:
        train = [x for x in SEASONS if x != s]
        pick = tune(data, train)
        print(f"  held out {s}: share {pick['share']}, shrink {pick['shrink']}, weight {pick['weight']}, "
              f"spread {pick['s1']} next / {pick['sl']} later", flush=True)
        for name, c in (('current', CURRENT), ('held-out pick', pick), ('no fitting', NO_FIT)):
            rows[name]['points'] += points_mse(data, [s], c)
            rows[name]['games'] += game_ll(data, [s], c)
            brier[name] += playoff_brier(data, s, c, np.random.default_rng(100 + SEASONS.index(s)))
            rows[name][f'points {s}'] = points_mse(data, [s], c); rows[name][f'brier {s}'] = st.mean(brier[name][-12 * len(data[s][1]):])
    print('\nout of sample (each season scored with values picked without it):')
    print(f"{'':15} {'weekly points MSE':>18} {'game log loss':>14} {'playoff Brier':>14}   Brier by season")
    for name in rows:
        print(f"{name:15} {rows[name]['points'] / 4:18.2f} {rows[name]['games'] / 4:14.4f} {st.mean(brier[name]):14.4f}   "
              + '  '.join(f"{rows[name][f'brier {s}']:.4f}" for s in SEASONS))
    # Paired differences in playoff Brier vs current, clustered by team-season
    cur = np.array(brier['current'])
    for name in ('held-out pick', 'no fitting'):
        d = np.array(brier[name]) - cur
        # team-season clusters: each season's snapshots list the 12 teams in order
        cl = []; i = 0
        for s in SEASONS:
            n_snap = len(data[s][1])
            blk = d[i:i + 12 * n_snap].reshape(n_snap, 12); cl += list(blk.mean(0)); i += 12 * n_snap
        cl = np.array(cl); b = np.random.default_rng(9).integers(0, len(cl), (4000, len(cl)))
        print(f'  {name} - current: {d.mean():+.4f}  95% [{np.percentile(cl[b].mean(1), 2.5):+.4f}, {np.percentile(cl[b].mean(1), 97.5):+.4f}]')
    live_scale()


if __name__ == '__main__':
    main()
