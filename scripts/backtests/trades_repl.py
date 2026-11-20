"""Does a trade's projected change track results better measured over waiver replacement?

The site grades a trade (trade.ts meansAfterTrade, lib/tradeHistory.ts) by the change in each
team's best projected lineup from its own roster: free agents never come in. So losing a player
counts in full even when a free agent would replace most of him, and the open roster spot a 2-for-1
leaves is never filled. The replacement-adjusted change gives both rosters the best free agents
that week (the top FA_PER_POS per position by value over the remaining weeks, unrostered in every
team's week-e roster) as extra depth, so a player only counts for his edge over the waiver wire:

    Delta_repl = lineup(after + free agents) - lineup(before + free agents)

Same trades, data, split and scoring as trades.py (two-way swaps between weeks e-1 and e in the
crawled 12-team leagues; playoff odds by rank_odds.py with our rules, leaving each season out).
Candidates, each a weight times a Delta on top of the fitted model without the trade:
  adopted          fitted lineup weight x Delta_raw   (what the site does)
  repl, lineup w   fitted lineup weight x Delta_repl
  repl, fitted w   w fitted on trades (season left out) x Delta_repl
  raw, fitted w    w fitted on trades x Delta_raw     (the trades.py winner's twin, for scale)

Rule set before the run (2026-11-20): switch to a replacement-adjusted candidate only if its
playoff Brier beats the adopted one with the interval below 0 in rank_odds' comparison, and in
most seasons. Otherwise keep the site as it is.

    python trades_repl.py [--workers 8]
"""
import argparse, glob, gzip, json, os, sys
from multiprocessing import Pool
import numpy as np
import gpu_sim as G
import leagues_fit as LF
import rank_odds as R

HERE = os.path.dirname(os.path.abspath(__file__))
FA_PER_POS = 3


def league_trades(path):
    """(league_id, e) -> {roster_id: (Delta_raw, Delta_repl)} for every team in a trade between weeks e-1 and e"""
    d = json.load(gzip.open(path, 'rt')); L = d['league']; M = {int(w): m for w, m in d['matchups'].items()}
    if len(d['rosters']) != 12 or L['league_id'] in LF.OURS: return {}
    end = (L['settings'].get('playoff_week_start') or 15) - 1
    if any(w not in M for w in range(1, end + 1)): return {}
    slots = L['roster_positions']; ppr = L['scoring_settings'].get('rec'); out = {}
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
        weeks = range(e, end + 1)
        rostered = set().union(*prev.values(), *now.values())
        ros = lambda p: np.mean([vals[p][1].get(w, (0, 0))[0] for w in weeks])
        by_pos = {}
        for p in vals:
            if p not in rostered: by_pos.setdefault(vals[p][0], []).append((ros(p), p))
        fa = {p for lst in by_pos.values() for _, p in sorted(lst, reverse=True)[:FA_PER_POS]}
        lu = lambda players: np.mean([LF.lineup(list(players), vals, slots, w, 0) for w in weeks])
        res = {}
        for r, (got, gave) in moves.items():
            if r not in prev: continue
            before, after = prev[r], prev[r] - gave | got
            res[r] = (lu(after) - lu(before), lu(after | fa) - lu(before | fa))
        out[(L['league_id'], e)] = res
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--workers', type=int, default=8); a = ap.parse_args()
    cache = os.path.join(HERE, 'cache', 'trades_repl.json')
    if os.path.exists(cache):
        trades = {(k.split('|')[0], int(k.split('|')[1])): {int(r): tuple(v) for r, v in d.items()} for k, d in json.load(open(cache)).items()}
    else:
        files = sorted(glob.glob(os.path.join(HERE, 'cache', 'leagues', '*', '*.json.gz'))); trades = {}
        with Pool(a.workers) as pool:
            for i, part in enumerate(pool.imap_unordered(league_trades, files, chunksize=8)):
                trades.update(part)
                if i % 2000 == 0: print(f'{i}/{len(files)} leagues', flush=True)
        json.dump({f'{k[0]}|{k[1]}': {str(r): v for r, v in d.items()} for k, d in trades.items()}, open(cache, 'w'))
    raw = np.array([v[0] for d in trades.values() for v in d.values()]); rep = np.array([v[1] for d in trades.values() for v in d.values()])
    print(f'{len(trades):,} league-weeks with a trade, {len(raw):,} trading teams')
    print(f'|Delta| median raw {np.median(np.abs(raw)):.2f}, over replacement {np.median(np.abs(rep)):.2f}; '
          f'corr {np.corrcoef(raw, rep)[0, 1]:.3f}; share where replacement shrinks |Delta| {np.mean(np.abs(rep) < np.abs(raw) - 1e-9):.0%}')
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12 and (r['league'], r['e']) in trades]
    P = G.pack(data); B, T = P['y'].shape; m = P['teams']
    D = np.zeros((B, T)); Dr = np.zeros((B, T))
    for b, r in enumerate(data):
        for j, rid in enumerate(r['ids']):
            v = trades[(r['league'], r['e'])].get(rid, (0.0, 0.0)); D[b, j], Dr[b, j] = v
    D = (D - D.mean(1, keepdims=True)) * m; Dr = (Dr - Dr.mean(1, keepdims=True)) * m
    traded = np.abs(D) + np.abs(Dr) > 1e-9
    allP = G.pack([r for r in G.S.collect(weekly=True) if len(r['ids']) == 12])
    off = np.zeros((B, T)); tau = np.zeros(B); bL = np.zeros(B)
    for s in np.unique(P['season']):
        for e in np.unique(P['e']):
            te = (P['season'] == s) & (P['e'] == e); tr = (allP['season'] != s) & (allP['e'] == e)
            if not te.any(): continue
            b = G.fit(allP, tr, [0, 1]); off[te] = P['X'][te][:, :, [0, 1]] @ b; tau[te] = G.tau_for(allP, tr, [0, 1], b); bL[te] = b[0]
    base = off - bL[:, None] * D
    def fitted_w(X):
        w = np.zeros(B)
        for s in np.unique(P['season']):
            tr = (P['season'] != s)[:, None] & traded
            w[P['season'] == s] = np.sum(X[tr] * (P['y'][tr] - base[tr])) / np.sum(X[tr] ** 2)
        return w
    w_raw, w_rep = fitted_w(D), fitted_w(Dr)
    print('weight fitted on trades, by left-out season: raw ' + ', '.join(f'{w_raw[P["season"] == s][0]:.2f}' for s in np.unique(P['season'])))
    print('                                     over replacement ' + ', '.join(f'{w_rep[P["season"] == s][0]:.2f}' for s in np.unique(P['season'])))
    # direct check on traded teams: residual sum of squares of the realized offset
    y = P['y']
    for name, pred in (('no trade', base), ('adopted', off), ('repl, lineup w', base + bL[:, None] * Dr),
                       ('repl, fitted w', base + w_rep[:, None] * Dr), ('raw, fitted w', base + w_raw[:, None] * D)):
        print(f'  traded teams mean squared error {name:15} {np.mean((y[traded] - pred[traded]) ** 2):.3f}')
    names = ['adopted', 'repl, lineup w', 'repl, fitted w', 'raw, fitted w']
    offs = np.stack([off, base + bL[:, None] * Dr, base + w_rep[:, None] * Dr, base + w_raw[:, None] * D]) * m
    G.S.collect = lambda *a_, **k: data
    sys.argv = [sys.argv[0], '--weekly', '--rules', 'ours', '--sims', '4000', '--target-sims', '2000', '--save', os.path.join(HERE, 'cache', 'trades_repl.npz')]
    R.main(lambda P_: (names, offs, np.repeat(tau[None], 4, 0), np.repeat(P['sd'][None], 4, 0)),
           [(n, 'adopted') for n in names if n != 'adopted'])


if __name__ == '__main__':
    main()
