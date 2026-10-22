"""How much of a trade's projected lineup change shows up? The trade tools' 0.75, on thousands of trades.

The trade tools (trade.ts meansAfterTrade) move a team's expected score by 0.75 x the trade's
change in its projected lineup, chosen on our league's 84 trades. Trades are found in the
crawled weekly rosters: two teams in the same league that each gained a player the other had
the week before (a one-way move is a waiver claim of a dropped player; trades of players for
picks alone are missed). For each team
in such a trade, the trade's projected change (Delta) is its best lineup averaged over the
remaining weeks with the traded players swapped, minus without, at week e's player values.

The snapshot at week e already has the post-trade roster in its lineup feature. With weight w
on the trade, a team's expected offset is the fitted model's minus its lineup weight x Delta,
plus w x Delta (Delta centred within the league). Candidates: w = 0 (ignore the trade), the
fitted model's lineup weight (about 0.3-0.4, consistent with the playoff odds), 0.75 (the
trade tools), and w fitted by least squares on traded teams leaving the season out.
Scored on the playoff odds of leagues with a trade that week (rank_odds.py, our rules).
Rule set before the run: replace 0.75 if a candidate beats it by the addendum's rule.

    python trades.py [--workers 8]
"""
import argparse, glob, gzip, json, os, sys
from multiprocessing import Pool
import numpy as np
import gpu_sim as G
import leagues_fit as LF
import rank_odds as R

HERE = os.path.dirname(os.path.abspath(__file__))


def league_trades(path):
    """(league_id, e) -> {roster_id: Delta} for every team in a trade between weeks e-1 and e"""
    d = json.load(gzip.open(path, 'rt')); L = d['league']; M = {int(w): m for w, m in d['matchups'].items()}
    if len(d['rosters']) != 12 or L['league_id'] in LF.OURS: return {}
    end = (L['settings'].get('playoff_week_start') or 15) - 1
    if any(w not in M for w in range(1, end + 1)): return {}
    slots = L['roster_positions']; ppr = L['scoring_settings'].get('rec'); out = {}
    for e in range(3, end + 1):
        prev = {m['roster_id']: set(m.get('players') or []) for m in M[e - 1]}
        now = {m['roster_id']: set(m.get('players') or []) for m in M[e]}
        owner_prev = {p: r for r, ps in prev.items() for p in ps}
        flows = {}  # (from, to) -> players
        for r, ps in now.items():
            for p in ps - prev.get(r, set()):
                if owner_prev.get(p) not in (None, r): flows.setdefault((owner_prev[p], r), set()).add(p)
        # a trade goes both ways in the same week; one-way moves are waiver claims of dropped players
        moves = {}
        for (a_, b_), ps in flows.items():
            if (b_, a_) in flows:
                moves.setdefault(b_, [set(), set()])[0].update(ps); moves.setdefault(a_, [set(), set()])[1].update(ps)
        if not moves: continue
        vals = LF.table(L['season'], e, ppr)
        lu = lambda players: np.mean([LF.lineup(list(players), vals, slots, w, 0) for w in range(e, end + 1)])
        out[(L['league_id'], e)] = {r: lu(prev[r] - gave | got) - lu(prev[r]) for r, (got, gave) in moves.items() if r in prev}
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--workers', type=int, default=8); a = ap.parse_args()
    cache = os.path.join(HERE, 'cache', 'trades.json')
    if os.path.exists(cache):
        trades = {(k.split('|')[0], int(k.split('|')[1])): {int(r): v for r, v in d.items()} for k, d in json.load(open(cache)).items()}
    else:
        files = sorted(glob.glob(os.path.join(HERE, 'cache', 'leagues', '*', '*.json.gz'))); trades = {}
        with Pool(a.workers) as pool:
            for part in pool.imap_unordered(league_trades, files, chunksize=8): trades.update(part)
        json.dump({f'{k[0]}|{k[1]}': {str(r): v for r, v in d.items()} for k, d in trades.items()}, open(cache, 'w'))
    n_teams = sum(len(v) for v in trades.values())
    deltas = np.array([v for d in trades.values() for v in d.values()])
    print(f'{len(trades):,} league-weeks with a trade, {n_teams:,} trading teams; |Delta| median {np.median(np.abs(deltas)):.1f}, '
          f'90th percentile {np.percentile(np.abs(deltas), 90):.1f} points a week')
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12 and (r['league'], r['e']) in trades]
    P = G.pack(data); B, T = P['y'].shape; m = P['teams']
    D = np.zeros((B, T))
    for b, r in enumerate(data):
        for j, rid in enumerate(r['ids']): D[b, j] = trades[(r['league'], r['e'])].get(rid, 0.0)
    D = (D - D.mean(1, keepdims=True)) * m
    traded = np.abs(D) > 1e-9
    # fitted model and its lineup weight, leaving the season out (on all 12-team snapshots)
    allP = G.pack([r for r in G.S.collect(weekly=True) if len(r['ids']) == 12])
    off = np.zeros((B, T)); tau = np.zeros(B); bL = np.zeros(B)
    for s in np.unique(P['season']):
        for e in np.unique(P['e']):
            te = (P['season'] == s) & (P['e'] == e); tr = (allP['season'] != s) & (allP['e'] == e)
            if not te.any(): continue
            b = G.fit(allP, tr, [0, 1]); off[te] = P['X'][te][:, :, [0, 1]] @ b; tau[te] = G.tau_for(allP, tr, [0, 1], b); bL[te] = b[0]
    base = off - bL[:, None] * D  # the fitted model without the trade
    # w fitted on traded teams, leaving the season out
    w_hat = np.zeros(B)
    for s in np.unique(P['season']):
        tr = (P['season'] != s)[:, None] & traded
        w_hat[P['season'] == s] = np.sum(D[tr] * (P['y'][tr] - base[tr])) / np.sum(D[tr] ** 2)
    print(f'fitted lineup weight (snapshot weeks) {np.percentile(bL, 10):.2f}-{np.percentile(bL, 90):.2f}; '
          f'weight on a trade fitted from trades: ' + ', '.join(f'{s} {w_hat[P["season"] == s][0]:.2f}' for s in np.unique(P['season'])))
    names = ['ignore the trade (w 0)', 'fitted lineup weight', 'trade tools (w 0.75)', 'w fitted on trades']
    offs = np.stack([base, off, base + 0.75 * D, base + w_hat[:, None] * D]) * m
    G.S.collect = lambda *a_, **k: data
    sys.argv = [sys.argv[0], '--weekly', '--rules', 'ours', '--sims', '4000', '--target-sims', '2000', '--save', os.path.join(HERE, 'cache', 'trades.npz')]
    R.main(lambda P_: (names, offs, np.repeat(tau[None], 4, 0), np.repeat(P['sd'][None], 4, 0)),
           [(n, 'trade tools (w 0.75)') for n in names if n != 'trade tools (w 0.75)'])


if __name__ == '__main__':
    main()
