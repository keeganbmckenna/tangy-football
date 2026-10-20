"""Does assuming managers stream from waivers make the playoff odds better? 2022-2025.

The odds model (blend50 in form_options.py: each player half his projection, half his
season points per game; a team's expected score is the league average plus 75% of how far
its best lineup is from the league's) is run with each streaming rule, on the same random
draws, for every team at every week 3-13:

  none       lineups from the roster only: a bye or injury with no backup scores 0
  built      what the site does: a K or DEF slot takes the 3rd-best free agent when he beats
             the rostered one; any slot that would score 0 takes the best free agent who can
             play it (two empty slots: the best two)
  all3       the 3rd-best free agent everywhere (empty slots too)
  kdef       K and DEF streamed (3rd best); empty slots stay at 0
  best       the best free agent everywhere
  empty      only a slot that would score 0 takes the best free agent who can play it (no
             K/DEF streaming): a manager covering a bye or injury with no backup

Free agents are the players with a projection that week who aren't on any roster that week.
Scored on playoff odds (Brier, log loss), rest-of-season wins (squared error) and single
games (log loss), with paired bootstrap intervals over snapshots (season and week) for the
differences from 'none'. Run fetch_history.py first.
"""
import math, statistics as st, sys
import numpy as np
from common import J
from form_options import Season, N

SLOT = {'FLEX': ['RB', 'WR', 'TE']}
STREAMED = {'K', 'DEF'}
# name -> (rank streamed at K/DEF or None, rank used for empty slots or None)
RULES = {'none': (None, None), 'built': (3, 1), 'all3': (3, 3), 'kdef': (3, None), 'best': (1, 1), 'empty': (None, 1)}


def best_stream(players, proj, slots, fa, kdef_rank, empty_rank, on_bye=None):
    """Best lineup with streaming. fa: position -> free agents' points that week, best first.
    on_bye: if given, only a hole a rostered player on bye would have filled takes a free agent"""
    pool = sorted([(proj[p][1], p, proj[p][0]) for p in players if p in proj], reverse=True)
    sl = sorted([SLOT.get(s, [s]) for s in slots if s not in ('BN', 'IR')], key=len)
    used, taken, tot = set(), {}, 0.0
    for el in sl:
        pick = next(((pts, p) for pts, p, pos in pool if p not in used and pos in el), None)
        held = pick[0] if pick else 0.0
        stream = None
        if len(el) == 1 and el[0] in STREAMED and kdef_rank:
            lst = fa.get(el[0], [])
            v = lst[min(kdef_rank, len(lst)) - 1] if lst else 0.0
            if v > held: stream = (el[0], v)
        elif held <= 0 and empty_rank and (on_bye is None or any(proj.get(p, ('', 0))[0] in el for p in on_bye)):
            for pos in el:
                lst = fa.get(pos, []); i = taken.get(pos, 0) + empty_rank - 1
                v = lst[min(i, len(lst) - 1)] if lst else 0.0
                if v > (stream[1] if stream else 0): stream = (pos, v)
        if stream:
            if stream[0] not in STREAMED: taken[stream[0]] = taken.get(stream[0], 0) + 1
            tot += stream[1]
        elif pick:
            used.add(pick[1]); tot += held
    return tot


class StreamSeason(Season):
    def means(self, e, rosters, moved=None):
        ids = self.ids
        lg = st.mean(self.M[w][r]['points'] for w in range(1, e) for r in ids)
        Pn = {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0, r.get('team'))
              for r in self.raw[e] if r.get('player') and r['player'].get('position')}
        tot, gp = {}, {}
        for w in range(1, e):
            for p, s in self.stats[w].items():
                g = s.get('gp') or 0
                if p in Pn and Pn[p][0] == 'DEF':
                    g = 1 if (p in self.playing[w]) else 0
                if g:
                    tot[p] = tot.get(p, 0) + (s.get('pts_half_ppr') or 0); gp[p] = gp.get(p, 0) + g
        rostered = {p for r in ids for p in rosters[r]}
        out = {v: {} for v in RULES}
        for w in range(e, self.end + 1):
            def on(p, v):
                pos, pts, team = Pn[p]
                return v if (team in self.playing[w] or p in self.playing[w]) else 0
            # The site's player value: half projection, half season points per game padded with 3 games of projection
            val = {p: (pos, on(p, 0.5 * pts + 0.5 * (tot.get(p, 0) + 3 * pts) / (gp.get(p, 0) + 3))) for p, (pos, pts, team) in Pn.items()}
            fa = {}
            for p, (pos, v) in val.items():
                if p not in rostered and v > 0: fa.setdefault(pos, []).append(v)
            for pos in fa: fa[pos].sort(reverse=True)
            for name, (kr, er) in RULES.items():
                B = np.array([best_stream(rosters[r], val, self.slots, fa, kr, er) for r in ids])
                out[name][w] = lg + 0.75 * (B - B.mean())
        sd = 25.0
        if e > 2:
            sq = sum((self.M[w][r]['points'] - st.mean(self.M[x][r]['points'] for x in range(1, e))) ** 2 for r in ids for w in range(1, e))
            sd = max(math.sqrt(sq / (len(ids) * (e - 2))), 15)
        return out, sd


def cdf(z): return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def run():
    rng = np.random.default_rng(23)
    rows, games = [], []
    for season in ['2022', '2023', '2024', '2025']:
        S = StreamSeason(season); Wf, made = S.final()
        for e in range(3, S.end + 1):
            rosters = {r: S.M[e][r]['players'] or [] for r in S.ids}
            means, sd = S.means(e, rosters)
            res, W0 = S.simulate(e, means, sd, rng)
            snap = f'{season}-{e}'
            for r in S.ids:
                i = S.ix[r]
                for v in RULES:
                    rows.append((snap, v, float(res[v][0][i]), float(Wf[i] - W0[i]), float(res[v][1][i]), float(made[i])))
            # Single games: win odds from the two teams' expected scores, at the spread the
            # site uses (0.8x the weekly spread next week, 2x after)
            for w in range(e, S.end + 1):
                scale = 0.8 if w == e else 2.0
                for a, b, pa, pb in S.games(w):
                    if pa == pb: continue
                    for v in RULES:
                        d = float(means[v][w][S.ix[a]] - means[v][w][S.ix[b]])
                        games.append((snap, v, cdf(d / (scale * sd * math.sqrt(2))), float(pa > pb)))
        print(season, 'done', flush=True)
    return rows, games


def report(rows, games):
    snaps = sorted({r[0] for r in rows})
    def metric(v, f, data):
        by = {}
        for r in data:
            if r[1] == v: by.setdefault(r[0], []).append(f(r))
        return by
    brier = lambda r: (r[4] - r[5]) ** 2
    ll = lambda r: -math.log(min(max(r[4] if r[5] else 1 - r[4], 1e-4), 1))
    wins = lambda r: (r[2] - r[3]) ** 2
    gll = lambda g: -math.log(max(g[2] if g[3] else 1 - g[2], 1e-6))
    rng = np.random.default_rng(5)
    boot = rng.integers(0, len(snaps), (2000, len(snaps)))
    print(f'{len(snaps)} snapshots, {len(rows) // len(RULES)} team-weeks, {len(games) // len(RULES)} games\n')
    print(f"{'rule':8} {'playoff Brier':>14} {'log loss':>9} {'wins sq err':>12} {'game log loss':>14}")
    base = {}
    for v in RULES:
        vals = []
        for f, data in ((brier, rows), (ll, rows), (wins, rows), (gll, games)):
            by = metric(v, f, data)
            vals.append((by, sum(sum(x) for x in by.values()) / sum(len(x) for x in by.values())))
        if v == 'none': base = vals
        print(f"{v:8} {vals[0][1]:14.4f} {vals[1][1]:9.4f} {vals[2][1]:12.3f} {vals[3][1]:14.4f}")
        if v != 'none':
            cis = []
            for (by, m), (bb, mb) in zip(vals, base):
                # paired: per snapshot sums and counts, resampled
                s = np.array([sum(by[k]) - sum(bb[k]) for k in snaps]); n = np.array([len(by[k]) for k in snaps])
                d = (s[boot].sum(1) / n[boot].sum(1))
                cis.append(f"{m - mb:+.4f} [{np.percentile(d, 2.5):+.4f}, {np.percentile(d, 97.5):+.4f}]")
            print(f"{'':8}  vs none: " + '  '.join(cis))
    # By season, playoff Brier
    print('\nplayoff Brier by season: ' + '  '.join(v for v in RULES))
    for season in ['2022', '2023', '2024', '2025']:
        line = []
        for v in RULES:
            x = [brier(r) for r in rows if r[1] == v and r[0].startswith(season)]
            line.append(f'{st.mean(x):.4f}')
        print(f'  {season}  ' + '  '.join(line))
    # Calibration of the built rule
    print('\ncalibration (built): odds bucket   n   avg odds   made it')
    for lo, hi in ((0, .1), (.1, .3), (.3, .5), (.5, .7), (.7, .9), (.9, 1.01)):
        b = [r for r in rows if r[1] == 'built' and lo <= r[4] < hi]
        if b: print(f'  {lo:.1f}-{min(hi, 1):.1f}        {len(b):4d}   {st.mean(r[4] for r in b):.3f}      {st.mean(r[5] for r in b):.3f}')


if __name__ == '__main__':
    import json, os
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'streaming.json')
    if len(sys.argv) > 1 and sys.argv[1] == 'report':
        d = json.load(open(path)); report(d['rows'], d['games'])
    else:
        rows, games = run()
        json.dump({'rows': rows, 'games': games}, open(path, 'w'))
        report(rows, games)


def run_trades():
    """The trading teams after every 2022-2025 trade (form_options.py's trades test)"""
    rng = np.random.default_rng(24)
    rows = []
    for season in ['2022', '2023', '2024', '2025']:
        S = StreamSeason(season); Wf, made = S.final()
        for leg in range(1, 12):
            for t in J(f'tx_{season}_{leg}'):
                if t['type'] != 'trade' or t['status'] != 'complete' or not t.get('adds'): continue
                sides = {r: ([p for p, x in t['adds'].items() if x == r], [p for p, x in (t['drops'] or {}).items() if x == r]) for r in t['roster_ids']}
                landed = any(p in (S.M[leg][r]['players'] or []) for r, (rec, _) in sides.items() for p in rec)
                e = leg if landed else leg + 1
                if e > S.end or e < 3: continue
                rosters = {r: S.M[e][r]['players'] or [] for r in S.ids}
                means, sd = S.means(e, rosters, sides)
                res, W0 = S.simulate(e, means, sd, rng)
                for r in sides:
                    i = S.ix[r]
                    for v in RULES:
                        rows.append((f"{season}-{r}", v, float(res[v][0][i]), float(Wf[i] - W0[i]), float(res[v][1][i]), float(made[i]), t['transaction_id']))
        print('trades', season, flush=True)
    return rows
