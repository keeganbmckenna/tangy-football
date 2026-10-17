"""Where should the 25% "season scoring" part of team strength live?

The playoff model's expected score is 75% projected lineup + 25% the team's
season scoring (shrunk toward the league average). After a trade the season
scoring stays with the team, even though the traded players produced part of
it. Candidates, each a full model for a team's expected weekly score:

  manager  current: 0.75 projection + 0.25 team season scoring
  travel   the same, but points the traded players scored in starting
           lineups this season move with them
  proj     0.75 projection + 0.25 league average (no season scoring at all)
  blendNN  each player's value blends his projection with his own season
           points per game (NN% projection); team strength comes only from
           the current roster's best blended lineup
  blendNN+ the blend plus team season scoring (does it double count?)

Two tests, both on what actually happened afterwards:
  1. trades: the trading teams after every 2022-2025 trade
  2. all:    every team at every week 2-13 (no trades involved: this is the
             Playoffs tab's model)
Scored on rest-of-season wins (squared error) and playoff odds (Brier).
Run fetch_history.py first, then `python form_options.py trades` and
`python form_options.py all`, and score with form_options_score.py.
"""
import json, math, random, statistics as st, sys
import numpy as np
from common import D, J, best, leagues

N = 3000
# (name, projection share, games of projection the season PPG is shrunk toward)
BLENDS = [('blend75', 0.75, 3), ('blend50', 0.5, 3), ('blend25', 0.25, 3), ('blend50s1', 0.5, 1), ('blend50s6', 0.5, 6),
          # A player projected for 0 (injured, out) counts 0 rather than half his season average
          ('blend50out', 0.5, 3)]
VARIANTS = ['manager', 'travel', 'proj'] + [b[0] for b in BLENDS] + ['blend75+', 'blend50+']


def seeds(wins, pf, div, has_div):
    val = wins + pf / (pf.max(axis=1, keepdims=True) + 1)
    order = np.argsort(-val, axis=1)
    if not has_div:
        return np.argsort(order, axis=1) + 1
    n_sims, T = wins.shape
    seed = np.zeros((n_sims, T), int)
    divs = sorted(set(div))
    for n in range(n_sims):
        o = list(order[n]); leaders = [next(t for t in o if div[t] == d) for d in divs]
        rest = [t for t in o if t not in leaders]
        for i, t in enumerate(leaders + rest): seed[n, t] = i + 1
    return seed


class Season:
    def __init__(self, season):
        L = leagues[season]
        self.slots = L['roster_positions']; self.end = L['settings']['playoff_week_start'] - 1
        self.has_div = bool(L['settings'].get('divisions'))
        R = json.load(open(f'{D}/rosters_{season}.json'))
        self.ids = sorted(r['roster_id'] for r in R); self.ix = {r: i for i, r in enumerate(self.ids)}
        self.div = [next(x['settings'].get('division') or 0 for x in R if x['roster_id'] == r) for r in self.ids]
        self.M = {w: {m['roster_id']: m for m in J(f'm_{season}_{w}')} for w in range(1, self.end + 1)}
        self.raw = {w: J(f'proj_{season}_{w}') for w in range(1, self.end + 1)}
        self.stats = {w: J(f'stats_{season}_{w}') for w in range(1, self.end + 1)}
        self.playing = {w: {r['team'] for r in self.raw[w] if r.get('game_id') and r.get('team')} for w in self.raw}
        self.season = season

    def games(self, w):
        seen, g = set(), []
        for r in self.ids:
            m = self.M[w][r]; o = next(x for x in self.M[w].values() if x['matchup_id'] == m['matchup_id'] and x['roster_id'] != r)
            if (o['roster_id'], r) not in seen:
                seen.add((r, o['roster_id'])); g.append((r, o['roster_id'], m['points'], o['points']))
        return g

    def record(self, through):
        W = np.zeros(len(self.ids)); PF = np.zeros(len(self.ids))
        for w in range(1, through + 1):
            for a, b, pa, pb in self.games(w):
                W[self.ix[a]] += 1 if pa > pb else 0.5 if pa == pb else 0
                W[self.ix[b]] += 1 if pb > pa else 0.5 if pa == pb else 0
                PF[self.ix[a]] += pa; PF[self.ix[b]] += pb
        return W, PF

    def final(self):
        W, PF = self.record(self.end)
        return W, (seeds(W[None], PF[None], self.div, self.has_div)[0] <= 6).astype(float)

    def starter_points(self, players, through):
        """Points each player scored in any team's starting lineup through a week"""
        out = {p: 0.0 for p in players}
        for w in range(1, through + 1):
            for m in self.M[w].values():
                for p in m.get('starters') or []:
                    if p in out: out[p] += (m.get('players_points') or {}).get(p, 0)
        return out

    def means(self, e, rosters, moved=None):
        """Every variant's expected score per remaining week for every team.
        rosters: rosterId -> players from week e on. moved: rosterId -> (received, sent)."""
        ids, ix = self.ids, self.ix
        lg = st.mean(self.M[w][r]['points'] for w in range(1, e) for r in ids)
        n = e - 1
        scores = {r: sum(self.M[w][r]['points'] for w in range(1, e)) for r in ids}
        form = np.array([(scores[r] + 2 * lg) / (n + 2) for r in ids])
        travel = form.copy()
        if moved:
            pts = self.starter_points({p for rec, sent in moved.values() for p in rec + sent}, n)
            for r, (rec, sent) in moved.items():
                adj = sum(pts[p] for p in rec) - sum(pts[p] for p in sent)
                travel[ix[r]] = (scores[r] + adj + 2 * lg) / (n + 2)
        Pn = {r['player_id']: (r['player']['position'], r['stats'].get('pts_half_ppr', 0) or 0, r.get('team'))
              for r in self.raw[e] if r.get('player') and r['player'].get('position')}
        # Each player's season production through week e-1
        tot, gp = {}, {}
        for w in range(1, e):
            for p, s in self.stats[w].items():
                g = s.get('gp') or 0
                if p in Pn and Pn[p][0] == 'DEF':
                    g = 1 if (p in self.playing[w]) else 0
                if g:
                    tot[p] = tot.get(p, 0) + (s.get('pts_half_ppr') or 0); gp[p] = gp.get(p, 0) + g
        out = {v: {} for v in VARIANTS}
        for w in range(e, self.end + 1):
            def on(p, v):  # bye weeks count as zero
                pos, pts, team = Pn[p]
                return v if (team in self.playing[w] or p in self.playing[w]) else 0
            proj = {p: (v[0], on(p, v[1])) for p, v in Pn.items()}
            blend = {}
            for name, a, k in BLENDS:
                bl = {}
                for p, (pos, pts, team) in Pn.items():
                    ppg = (tot.get(p, 0) + k * pts) / (gp.get(p, 0) + k)
                    value = 0 if (name.endswith('out') and pts <= 0) else a * pts + (1 - a) * ppg
                    bl[p] = (pos, on(p, value))
                blend[name] = bl
            P = np.array([best(rosters[r], proj, self.slots) for r in ids])
            Pc = lg + P - P.mean()
            out['manager'][w] = 0.75 * Pc + 0.25 * form
            out['travel'][w] = 0.75 * Pc + 0.25 * travel
            out['proj'][w] = 0.75 * Pc + 0.25 * lg
            for name, a, k in BLENDS:
                B = np.array([best(rosters[r], blend[name], self.slots) for r in ids])
                Bc = lg + B - B.mean()
                out[name][w] = 0.75 * Bc + 0.25 * lg
                if name in ('blend75', 'blend50'):
                    out[name + '+'][w] = 0.75 * Bc + 0.25 * form
        sd = 25.0
        if e > 2:
            sq = sum((self.M[w][r]['points'] - st.mean(self.M[x][r]['points'] for x in range(1, e))) ** 2 for r in ids for w in range(1, e))
            sd = max(math.sqrt(sq / (len(ids) * (e - 2))), 15)
        return out, sd

    def simulate(self, e, means, sd, rng):
        """Expected remaining wins and playoff odds per variant, same draws for all"""
        W0, PF0 = self.record(e - 1)
        noise = {w: rng.standard_normal((N, len(self.ids))) for w in range(e, self.end + 1)}
        res = {}
        for v, mw in means.items():
            Wv = np.repeat(W0[None], N, 0); PFv = np.repeat(PF0[None], N, 0)
            for w in range(e, self.end + 1):
                sc = mw[w][None] + sd * noise[w]
                for a, b, _, _ in self.games(w):
                    ia, ib = self.ix[a], self.ix[b]
                    Wv[:, ia] += sc[:, ia] > sc[:, ib]; Wv[:, ib] += sc[:, ib] > sc[:, ia]
                PFv += sc
            res[v] = ((Wv - W0[None]).mean(0), (seeds(Wv, PFv, self.div, self.has_div) <= 6).mean(0))
        return res, W0


def trades_test(rows):
    rng = np.random.default_rng(21)
    for season in ['2022', '2023', '2024', '2025']:
        S = Season(season); Wf, made = S.final()
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
                    for v in VARIANTS:
                        rows.append(('trades', season, t['transaction_id'], r, v, res[v][0][i], Wf[i] - W0[i], res[v][1][i], made[i]))
        print('trades', season, flush=True)


GAMES = []  # single games: season, snapshot week, weeks ahead, variant, mean difference, spread, won


def all_test(rows):
    rng = np.random.default_rng(22)
    for season in ['2022', '2023', '2024', '2025']:
        S = Season(season); Wf, made = S.final()
        for e in range(3, S.end + 1):
            rosters = {r: S.M[e][r]['players'] or [] for r in S.ids}
            means, sd = S.means(e, rosters)
            res, W0 = S.simulate(e, means, sd, rng)
            for r in S.ids:
                i = S.ix[r]
                for v in VARIANTS:
                    rows.append(('all', season, f'{season}-{e}', r, v, res[v][0][i], Wf[i] - W0[i], res[v][1][i], made[i]))
            for w in range(e, S.end + 1):
                for a, b, pa, pb in S.games(w):
                    if pa == pb: continue
                    for v in ('manager', 'blend50', 'blend50out'):
                        GAMES.append((season, e, w - e + 1, v, float(means[v][w][S.ix[a]] - means[v][w][S.ix[b]]), sd, float(pa > pb)))
        print('all', season, flush=True)


if __name__ == '__main__':
    # python form_options.py trades|all  ->  fo_trades.json / fo_all.json
    test = sys.argv[1]
    rows = []
    (trades_test if test == 'trades' else all_test)(rows)
    json.dump(rows, open(f'fo_{test}.json', 'w'))
    if GAMES:
        json.dump(GAMES, open('fo_games.json', 'w'))
