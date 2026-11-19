"""FAAB auctions team by team: for every auction (faab_auctions.py's), one row for each of the
league's 12 teams, bidders and non-bidders, so each rival can be modeled on its own (does it
bid, and how much) with what's known about it then:

  money    remaining budget (share of the budget; a hard cap on its bid)
  need     its lineup gain from the player (mean over the next 4 weeks), its rank among the
           league's teams, open roster spots
  habits   its earlier valid claims this season in this league: how many (per processing so
           far), their mean and largest bid share, the share at $0, the share of its claims won
  record   its win share so far

Plus the auction's own key (league, processing time, player) to join the player features of
faab_auctions.parquet. Bid is the team's best claim on the player (share of budget), NaN if it
didn't bid. Writes cache/faab_teams.parquet.

    ../../.venv/bin/python faab_teams.py [--workers 8]
"""
import argparse, glob, gzip, json, os
from collections import defaultdict
from multiprocessing import Pool
import numpy as np
import leagues_fit as LF
from faab_auctions import CACHE, LOST, AHEAD

COLS = ['league', 'when', 'player', 'season', 'roster', 'rem', 'gain', 'gain_rank', 'open', 'claims', 'claim_rate',
        'mean_bid', 'max_bid', 'zero_share', 'won_share', 'win_pct', 'bid', 'won']


def league_rows(path):
    season = path.split(os.sep)[-2]
    tx_path = os.path.join(CACHE, 'transactions', season, os.path.basename(path))
    if not os.path.exists(tx_path): return None
    d = json.load(gzip.open(path, 'rt')); L = d['league']; s = L['settings']
    if s.get('waiver_type') != 2 or not s.get('waiver_budget') or len(d['rosters']) != 12 or L['league_id'] in LF.OURS: return None
    B = s['waiver_budget']; M = {int(w): m for w, m in d['matchups'].items()}
    end = (s.get('playoff_week_start') or 15) - 1
    ppr = L['scoring_settings'].get('rec'); slots = L['roster_positions']
    n_slots = sum(1 for x in slots if x not in ('IR', 'TAXI'))
    tx = json.load(gzip.open(tx_path, 'rt'))
    claims = sorted((t for leg, ts in tx.items() for t in ts if t['type'] == 'waiver'), key=lambda t: t.get('status_updated') or 0)
    by_time = defaultdict(list)
    for t in claims: by_time[t.get('status_updated') or 0].append(t)
    spent = defaultdict(float)
    hist = defaultdict(lambda: [0, 0.0, 0.0, 0, 0])  # roster -> claims, sum bid share, max share, at $0, won
    processings = 0
    out = {c: [] for c in COLS}
    gains = {}
    for when in sorted(by_time):
        ts = by_time[when]; leg = ts[0].get('leg') or 0
        auctions = defaultdict(list)
        for t in ts:
            bid = (t.get('settings') or {}).get('waiver_bid')
            if bid is None or not t.get('adds') or not t.get('roster_ids'): continue
            ok = t['status'] == 'complete' or (t['status'] == 'failed' and (t.get('metadata') or {}).get('notes') == LOST)
            if not ok: continue
            for pid in t['adds']: auctions[pid].append((t['roster_ids'][0], float(bid), t['status'] == 'complete'))
        if 2 <= leg <= end and (leg - 1) in M and auctions:
            vals = LF.table(season, leg, ppr)
            players = {m['roster_id']: (m.get('players') or []) for m in M[leg - 1]}
            rosters = {r: [p for p in ps if p in vals] for r, ps in players.items()}
            weeks = list(range(leg, min(leg + AHEAD, end + 1)))
            # record so far
            wins = defaultdict(float); games = defaultdict(int)
            for w in range(1, leg):
                by_m = defaultdict(list)
                for m in M.get(w, []): by_m[m.get('matchup_id')].append(m)
                for mid, pair in by_m.items():
                    if mid is None or len(pair) != 2: continue
                    a_, b_ = pair
                    for x, y in ((a_, b_), (b_, a_)):
                        games[x['roster_id']] += 1
                        wins[x['roster_id']] += 1.0 if x['points'] > y['points'] else 0.5 if x['points'] == y['points'] else 0.0
            base = {}
            for pid, bids in auctions.items():
                if pid not in vals: continue
                g = {}
                for r, ps in rosters.items():
                    key = (leg, r, pid)
                    if key not in gains:
                        if (leg, r) not in base:
                            base[(leg, r)] = sum(LF.lineup(ps, vals, slots, w, 0) for w in weeks) / len(weeks)
                        with_p = ps if pid in ps else ps + [pid]
                        gains[key] = sum(LF.lineup(with_p, vals, slots, w, 0) for w in weeks) / len(weeks) - base[(leg, r)]
                    g[r] = gains[key]
                order = sorted(g, key=lambda r: -g[r]); grank = {r: i + 1 for i, r in enumerate(order)}
                best = {}
                for r, b, won in bids:
                    if r not in best or b > best[r][0]: best[r] = (b, won)
                for r in rosters:
                    h = hist[r]
                    out['league'].append(L['league_id']); out['when'].append(when); out['player'].append(pid)
                    out['season'].append(int(season)); out['roster'].append(r)
                    out['rem'].append((B - spent[r]) / B); out['gain'].append(g[r]); out['gain_rank'].append(grank[r])
                    out['open'].append(max(0, n_slots - len(players.get(r, []))))
                    out['claims'].append(h[0]); out['claim_rate'].append(h[0] / processings if processings else 0.0)
                    out['mean_bid'].append(h[1] / h[0] if h[0] else np.nan); out['max_bid'].append(h[2] if h[0] else np.nan)
                    out['zero_share'].append(h[3] / h[0] if h[0] else np.nan); out['won_share'].append(h[4] / h[0] if h[0] else np.nan)
                    out['win_pct'].append(wins[r] / games[r] if games[r] else 0.5)
                    out['bid'].append(best[r][0] / B if r in best else np.nan); out['won'].append(bool(best.get(r, (0, False))[1]))
        # update money and habits after the processing
        if auctions: processings += 1
        for pid, bids in auctions.items():
            for r, b, won in bids:
                h = hist[r]; sh = b / B
                h[0] += 1; h[1] += sh; h[2] = max(h[2], sh); h[3] += b == 0; h[4] += won
                if won: spent[r] += b
    return {c: np.array(v) for c, v in out.items()} if out['league'] else None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--workers', type=int, default=8); a = ap.parse_args()
    import pandas as pd
    files = sorted(glob.glob(os.path.join(CACHE, 'leagues', '*', '*.json.gz')))
    parts = []
    with Pool(a.workers) as pool:
        for i, part in enumerate(pool.imap_unordered(league_rows, files, chunksize=4)):
            if part is not None: parts.append(pd.DataFrame(part))
            if i % 1000 == 0: print(f'{i}/{len(files)} leagues', flush=True)
    df = pd.concat(parts, ignore_index=True)
    for c in ('league', 'player'): df[c] = df[c].astype('category')
    df.to_parquet(os.path.join(CACHE, 'faab_teams.parquet'))
    print(f'{len(df):,} team rows, {df.bid.notna().sum():,} bids')


if __name__ == '__main__':
    main()
