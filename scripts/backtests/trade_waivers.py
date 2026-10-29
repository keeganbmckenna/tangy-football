"""Trades measured against each team's best waiver moves: do they predict what happened better?

trades.py measures a trade's projected change (Delta) as the traded players swapped into
the roster, nothing else. The trade tools also make the moves a trade forces (drop the least
useful player when over the limit, pick up the best free agent for an opened spot). This
compares three measures, for every two-way trade in the crawled 12-team leagues:

  raw        trades.py's swap: best lineup after minus before, holes score 0
  forced     the trade tools today: the swap plus forced drops / free-agent fills (before
             is the roster as it was); holes score 0
  waivers    each roster at its best with waiver moves, with and without the trade: forced
             drops / fills, then up to 2 swaps of its least useful player for the free agent
             who adds the most (if he adds 0.2+ points a week), and each week a slot that
             would score 0 (bye, injury) takes the best free agent who can play it

Free agents: players with a value that week not on any roster in the league at week e.
Values: leagues_fit.table (the site's player value), averaged over weeks e..end.

Also the playoff weeks: the season model moves a team's playoff-week strength by the trade's
regular-season average change. 'po' measures the change over the playoff weeks instead.

Tests (rule fixed before the run, 2026-10-29):
  1. Regular season, traded teams: residual of realized rest-of-season strength (strength
     model's y minus the fitted model without the trade) predicted by w x Delta, w fitted
     leaving the season out. Squared error, league-resampled 95% interval, seasons better.
     ADOPT waivers over forced if its interval is below 0 and it is better in 5+ of 8
     seasons, and playoff Brier (rank_odds.py --weekly --rules ours, each with its own
     out-of-season w) is no worse (interval not above 0).
  2. Playoff weeks, traded teams: team's mean playoff-week points (league-centred)
     predicted from its pre-trade form and playoff-week lineup plus w x Delta (regular
     average) or w x Delta (playoff weeks). Same rule: ADOPT playoff-week deltas if the
     squared-error interval is below 0 and 5+ of 8 seasons.

    python trade_waivers.py [--workers 8] [--skip-brier]
"""
import argparse, glob, gzip, json, os, sys
from collections import defaultdict
from multiprocessing import Pool
import numpy as np
import leagues_fit as LF

HERE = os.path.dirname(os.path.abspath(__file__))
SWAPS = 2
MIN_SWAP_GAIN = 0.2
FA_PER_POS = 4


class Values:
    """Player values for weeks of one league-snapshot, with lineups that can fill holes from free agents"""

    def __init__(self, vals, slots, weeks, free):
        self.vals, self.weeks = vals, weeks
        self.slots = sorted((LF.SLOT.get(s, (s,)) for s in slots if s not in ('BN', 'IR', 'TAXI')), key=len)
        # free agents each week, best first: position -> [(value, id)]
        self.fa = {}
        for w in weeks:
            by = defaultdict(list)
            for p in free:
                v = vals[p][1].get(w, (0, 0))[0]
                if v > 0: by[vals[p][0]].append((v, p))
            for pos in by: by[pos].sort(reverse=True)
            self.fa[w] = by
        # free agents worth trying in a roster swap: the best few per position over these weeks
        avg = defaultdict(list)
        for p in free:
            avg[vals[p][0]].append((sum(vals[p][1].get(w, (0, 0))[0] for w in weeks), p))
        self.candidates = [p for pos in avg for _, p in sorted(avg[pos], reverse=True)[:FA_PER_POS]]

    def week(self, players, w, holes):
        pool = sorted(((self.vals[p][1].get(w, (0, 0))[0], p, self.vals[p][0]) for p in players if p in self.vals), reverse=True)
        used, tot, taken = set(), 0.0, set(players)
        for el in self.slots:
            pick = next(((v, p) for v, p, pos in pool if p not in used and pos in el and v > 0), None)
            if pick:
                used.add(pick[1]); tot += pick[0]
            elif holes:
                best = None
                for pos in el:
                    for v, p in self.fa[w].get(pos, ()):
                        if p not in taken:
                            if not best or v > best[0]: best = (v, p)
                            break
                if best: taken.add(best[1]); tot += best[0]
        return tot

    def avg(self, players, holes, weeks=None):
        ws = weeks or self.weeks
        return sum(self.week(players, w, holes) for w in ws) / len(ws)


def settle(V, roster, cap, holes, swaps, keep_out=()):
    """Roster after forced moves (and, with swaps, its best waiver moves)"""
    roster = list(roster)
    gone = set(keep_out)
    while len(roster) > cap:
        roster.remove(max(roster, key=lambda p: (V.avg([x for x in roster if x != p], holes), -V.avg([p], False))))
    while len(roster) < cap:
        adds = [p for p in V.candidates if p not in roster and p not in gone]
        if not adds: break
        roster.append(max(adds, key=lambda p: V.avg(roster + [p], holes)))
    for _ in range(swaps):
        now = V.avg(roster, holes)
        drop = max(roster, key=lambda p: (V.avg([x for x in roster if x != p], holes), -V.avg([p], False)))
        rest = [x for x in roster if x != drop]
        adds = [p for p in V.candidates if p not in roster and p not in gone]
        if not adds: break
        add = max(adds, key=lambda p: V.avg(rest + [p], holes))
        if V.avg(rest + [add], holes) - now < MIN_SWAP_GAIN: break
        roster = rest + [add]; gone.add(drop)
    return roster


def league_trades(path):
    """(league_id, e) -> {roster_id: {measure: Delta}} for every team in a trade between weeks e-1 and e"""
    d = json.load(gzip.open(path, 'rt')); L = d['league']; M = {int(w): m for w, m in d['matchups'].items()}
    if len(d['rosters']) != 12 or L['league_id'] in LF.OURS: return {}
    po = L['settings'].get('playoff_week_start') or 15; end = po - 1
    if any(w not in M for w in range(1, end + 1)): return {}
    slots = L['roster_positions']; ppr = L['scoring_settings'].get('rec'); out = {}
    po_weeks = [w for w in range(po, min(po + 3, 18))]
    for e in range(3, end + 1):
        prev = {m['roster_id']: set(m.get('players') or []) for m in M[e - 1]}
        now = {m['roster_id']: set(m.get('players') or []) for m in M[e]}
        owner_prev = {p: r for r, ps in prev.items() for p in ps}
        flows = {}
        for r, ps in now.items():
            for p in ps - prev.get(r, set()):
                if owner_prev.get(p) not in (None, r): flows.setdefault((owner_prev[p], r), set()).add(p)
        moves = {}
        for (a_, b_), ps in flows.items():
            if (b_, a_) in flows:
                moves.setdefault(b_, [set(), set()])[0].update(ps); moves.setdefault(a_, [set(), set()])[1].update(ps)
        if not moves: continue
        vals = LF.table(L['season'], e, ppr)
        rostered = set().union(*prev.values(), *now.values())
        free = [p for p in vals if p not in rostered]
        reg = list(range(e, end + 1))
        V = Values(vals, slots, reg + po_weeks, free)
        res = {}
        for r, (got, gave) in moves.items():
            if r not in prev: continue
            before = [p for p in prev[r] if p in vals]; cap = len(before)
            swapped = [p for p in before if p not in gave] + [p for p in got if p in vals and p not in before]
            row = {}
            for tag, ws in (('', reg), ('po_', po_weeks)):
                if not ws: continue
                row[tag + 'raw'] = V.avg(swapped, False, ws) - V.avg(before, False, ws)
            forced = settle(V, swapped, cap, False, 0)
            b_w = settle(V, before, cap, True, SWAPS)
            a_w = settle(V, swapped, cap, True, SWAPS, keep_out=gave)
            row['forced'] = V.avg(forced, False, reg) - V.avg(before, False, reg)
            row['waivers'] = V.avg(a_w, True, reg) - V.avg(b_w, True, reg)
            if po_weeks:
                row['po_forced'] = V.avg(forced, False, po_weeks) - V.avg(before, False, po_weeks)
                row['po_waivers'] = V.avg(a_w, True, po_weeks) - V.avg(b_w, True, po_weeks)
                # what the playoff check needs: pre-trade playoff-week lineup and actual playoff-week points
                pts = [next((m['points'] for m in M.get(w, []) if m['roster_id'] == r), None) for w in po_weeks]
                lg = [np.mean([m['points'] for m in M[w]]) for w in po_weeks if w in M and M[w]]
                if all(x is not None for x in pts) and len(lg) == len(pts):
                    row['po_actual'] = float(np.mean(pts) - np.mean(lg))
                    row['po_lineup'] = V.avg(before, False, po_weeks)
                    lgf = [np.mean([m['points'] for m in M[w]]) for w in range(1, e)]
                    row['form'] = float(np.mean([next(m['points'] for m in M[w] if m['roster_id'] == r) for w in range(1, e)]) - np.mean(lgf))
            res[r] = row
        if res:
            # league-centred playoff lineups need every team's: centre on the league's pre-trade rosters
            if po_weeks:
                lg_po = np.mean([V.avg([p for p in prev[x] if p in vals], False, po_weeks) for x in prev])
                for row in res.values():
                    if 'po_lineup' in row: row['po_lineup'] -= lg_po
            out[(L['league_id'], e)] = {'season': L['season'], 'teams': res}
    return out


def boot(err_a, err_b, league, season, n=2000, seed=0):
    """Mean difference in squared error (a - b), league-resampled interval, seasons where a is better"""
    rng = np.random.default_rng(seed); diff = err_a - err_b
    ls = np.unique(league); idx = {l: np.where(league == l)[0] for l in ls}
    sums = np.array([diff[idx[l]].sum() for l in ls]); cnt = np.array([len(idx[l]) for l in ls])
    bs = []
    for _ in range(n):
        k = rng.integers(0, len(ls), len(ls)); bs.append(sums[k].sum() / cnt[k].sum())
    lo, hi = np.percentile(bs, [2.5, 97.5])
    seasons = np.unique(season); better = sum(diff[season == s].mean() < 0 for s in seasons)
    return diff.mean(), lo, hi, better, len(seasons)


def oos_fit(x, y, season, cols):
    """Least-squares prediction of y from x[:, cols] (with intercept), leaving each season out"""
    pred = np.zeros_like(y)
    for s in np.unique(season):
        tr = season != s
        X = np.column_stack([np.ones(tr.sum())] + [x[c][tr] for c in cols])
        b, *_ = np.linalg.lstsq(X, y[tr], rcond=None)
        te = ~tr
        pred[te] = np.column_stack([np.ones(te.sum())] + [x[c][te] for c in cols]) @ b
    return pred


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--skip-brier', action='store_true'); a = ap.parse_args()
    cache = os.path.join(HERE, 'cache', 'trade_waivers.json')
    if os.path.exists(cache):
        trades = {(k.split('|')[0], int(k.split('|')[1])): {'season': v['season'], 'teams': {int(r): x for r, x in v['teams'].items()}}
                  for k, v in json.load(open(cache)).items()}
    else:
        files = sorted(glob.glob(os.path.join(HERE, 'cache', 'leagues', '*', '*.json.gz'))); trades = {}
        with Pool(a.workers) as pool:
            for i, part in enumerate(pool.imap_unordered(league_trades, files, chunksize=4)):
                trades.update(part)
                if i % 500 == 0: print(f'{i}/{len(files)} leagues', flush=True)
        json.dump({f'{k[0]}|{k[1]}': {'season': v['season'], 'teams': {str(r): x for r, x in v['teams'].items()}} for k, v in trades.items()}, open(cache, 'w'))
    rows = [(k, r, v['season'], x) for k, v in trades.items() for r, x in v['teams'].items()]
    print(f'{len(trades):,} league-weeks with a trade, {len(rows):,} trading teams')
    for m in ('raw', 'forced', 'waivers'):
        d = np.array([x[m] for *_, x in rows])
        print(f'  {m:8} Delta: mean {d.mean():+.2f}, |Delta| median {np.median(np.abs(d)):.2f}, 90th pct {np.percentile(np.abs(d), 90):.2f}')
    raw = np.array([x['raw'] for *_, x in rows]); wv = np.array([x['waivers'] for *_, x in rows])
    print(f'  waivers vs raw: correlation {np.corrcoef(raw, wv)[0, 1]:.3f}; sign flips {np.mean(np.sign(raw) != np.sign(wv)):.1%}')

    # ---- 1. regular season: realized strength residual on traded teams
    import gpu_sim as G
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12 and (r['league'], r['e']) in trades]
    P = G.pack(data); B, T = P['y'].shape; mask = P['teams']
    names = ['raw', 'forced', 'waivers']
    D = {n: np.zeros((B, T)) for n in names}
    for b, r in enumerate(data):
        tm = trades[(r['league'], r['e'])]['teams']
        for j, rid in enumerate(r['ids']):
            for n in names: D[n][b, j] = tm.get(rid, {}).get(n, 0.0)
    for n in names: D[n] = (D[n] - D[n].mean(1, keepdims=True)) * mask
    traded = np.abs(D['raw']) + np.abs(D['waivers']) > 1e-9
    allP = G.pack([r for r in G.S.collect(weekly=True) if len(r['ids']) == 12])
    off = np.zeros((B, T)); tau = np.zeros(B); bL = np.zeros(B)
    for s in np.unique(P['season']):
        for e in np.unique(P['e']):
            te = (P['season'] == s) & (P['e'] == e); tr = (allP['season'] != s) & (allP['e'] == e)
            if not te.any(): continue
            b = G.fit(allP, tr, [0, 1]); off[te] = P['X'][te][:, :, [0, 1]] @ b; tau[te] = G.tau_for(allP, tr, [0, 1], b); bL[te] = b[0]
    # the snapshot's lineup feature already has the real post-trade roster: back the measured trade out of it
    base = off - bL[:, None] * D['raw']
    w_hat = {}; offs = {}
    for n in names:
        w = np.zeros(B)
        for s in np.unique(P['season']):
            tr = (P['season'] != s)[:, None] & traded
            w[P['season'] == s] = np.sum(D[n][tr] * (P['y'][tr] - base[tr])) / np.sum(D[n][tr] ** 2)
        w_hat[n] = w; offs[n] = (base + w[:, None] * D[n]) * mask
        print(f'  w fitted on trades, {n}: ' + ', '.join(f'{s} {w[P["season"] == s][0]:.2f}' for s in np.unique(P['season'])))
    league = np.array([r['league'] for r in data])[:, None].repeat(T, 1)[traded]
    season = P['season'][:, None].repeat(T, 1)[traded]
    err = {n: ((P['y'] - offs[n]) ** 2)[traded] for n in names}
    err['ignore'] = ((P['y'] - base) ** 2)[traded]
    print(f'\n1. regular season, {traded.sum():,} traded team-snapshots: squared error of realized strength (pts/wk)^2')
    for n in ['ignore'] + names: print(f'  {n:8} {err[n].mean():.3f}')
    for x, y in (('waivers', 'forced'), ('waivers', 'raw'), ('forced', 'raw')):
        m, lo, hi, k, ns = boot(err[x], err[y], league, season)
        print(f'  {x} - {y}: {m:+.3f} [{lo:+.3f}, {hi:+.3f}] ({k} of {ns} seasons better)')

    # ---- 2. playoff weeks
    pr = [(k, r, s, x) for k, r, s, x in rows if 'po_actual' in x]
    y = np.array([x['po_actual'] for *_, x in pr]); se = np.array([s for _, _, s, _ in pr]); lg = np.array([k[0] for k, *_ in pr])
    X = {c: np.array([x[c] for *_, x in pr]) for c in ('form', 'po_lineup', 'waivers', 'po_waivers', 'forced', 'po_forced', 'raw', 'po_raw')}
    print(f'\n2. playoff weeks, {len(pr):,} traded teams: squared error of mean playoff-week points (league-centred)')
    perr = {}
    for label, cols in (('no trade', []), ('regular-season Delta (forced)', ['forced']), ('playoff-week Delta (forced)', ['po_forced']),
                        ('regular-season Delta (waivers)', ['waivers']), ('playoff-week Delta (waivers)', ['po_waivers'])):
        pred = oos_fit(X, y, se, ['form', 'po_lineup'] + cols)
        perr[label] = (y - pred) ** 2
        print(f'  {label:32} {perr[label].mean():.2f}')
    for x_, y_ in (('playoff-week Delta (forced)', 'regular-season Delta (forced)'), ('playoff-week Delta (waivers)', 'regular-season Delta (waivers)'),
                   ('playoff-week Delta (waivers)', 'regular-season Delta (forced)')):
        m, lo, hi, k, ns = boot(perr[x_], perr[y_], lg, se)
        print(f'  {x_} - {y_}: {m:+.2f} [{lo:+.2f}, {hi:+.2f}] ({k} of {ns} seasons better)')

    if a.skip_brier: return
    # ---- playoff Brier, each measure with its own out-of-season weight
    import rank_odds as R
    G.S.collect = lambda *a_, **k: data
    labels = ['ignore the trade', 'raw (trades.py)', 'forced (trade tools)', 'waivers']
    stack = np.stack([base * mask, offs['raw'], offs['forced'], offs['waivers']])
    sys.argv = [sys.argv[0], '--weekly', '--rules', 'ours', '--sims', '4000', '--target-sims', '2000', '--save', os.path.join(HERE, 'cache', 'trade_waivers.npz')]
    R.main(lambda P_: (labels, stack, np.repeat(tau[None], 4, 0), np.repeat(P['sd'][None], 4, 0)),
           [('waivers', 'forced (trade tools)'), ('waivers', 'raw (trades.py)'), ('forced (trade tools)', 'raw (trades.py)')])


if __name__ == '__main__':
    main()
