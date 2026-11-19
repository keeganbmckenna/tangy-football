"""FAAB auctions from the crawled leagues: every valid bid, with the bids it was up against.

Sleeper keeps losing FAAB claims ("This player was claimed by another owner.") with their bids,
so grouping a league's waiver claims by processing time and player gives each auction in full.
Claims that failed for other reasons (roster too full, over budget, drop already played) aren't
bids that were in the running and are left out.

One row per bidder: the bidder is "me", and the target is the highest bid by any other team on
that player in that processing (-1 if nobody else bid). That is what a recommendation needs,
the chance a bid beats everyone else's, given the player, the week, the league's money and who
in the league would want him.

Features (as of the processing, from data available then):
  player   position; rest-of-season value (leagues_fit.table: half projection, half points per
           game; mean over the next 4 regular-season weeks, byes 0); this week's value; rank by
           rest-of-season value among the free agents at his position; last week's points
  league   budget, week, teams; the share of all budgets spent so far; the median winning bid
           (share of budget) in its earlier auctions this season, and how many there were
  others   each other team's remaining budget and its lineup gain from adding the player (mean
           over the next 4 weeks): the most remaining money, the most money among teams that
           gain 1+ point a week, how many teams gain 1+ / 3+ points, the largest gain
  me       my gain, my remaining budget, my bid, whether I won (kept for the value analysis)

12-team leagues with FAAB (waiver_type 2), regular-season legs 2..last regular week, our league
left out. Writes cache/faab_auctions.parquet.

    ../../.venv/bin/python faab_auctions.py [--workers 8]
"""
import argparse, glob, gzip, json, os
from collections import defaultdict
from multiprocessing import Pool
import numpy as np
import leagues_fit as LF

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
LOST = 'This player was claimed by another owner.'
AHEAD = 4
NEED, BIG_NEED = 1.0, 3.0


_signals = {}


def signals(season, leg, ppr):
    """Role news as of the week: last week's snap share and opportunities (targets + carries)
    against the player's earlier average, his projection now against last week's, and the
    biggest projection drop of a teammate at his position (a starter ruled out)"""
    key = (season, leg, ppr)
    if key in _signals: return _signals[key]
    now, prev = LF.table(season, leg, ppr), LF.table(season, leg - 1, ppr)
    proj = lambda t, p, w: t[p][1].get(w, (0, 0))[1] if p in t else 0.0
    last = LF.arch(season, f'stats/{leg - 1}')
    opp = lambda s_: (s_.get('rec_tgt') or 0) + (s_.get('rush_att') or 0)
    tot, n = defaultdict(float), defaultdict(int)
    for w in range(1, leg - 1):
        for p, s_ in LF.arch(season, f'stats/{w}').items():
            if s_.get('gp'): tot[p] += opp(s_); n[p] += 1
    teams = {}
    for r in LF.arch(season, f'projections/{leg}'):
        t = (r.get('player') or {}).get('team')
        if t: teams[r['player_id']] = (t, (r.get('player') or {}).get('position'))
    drop = defaultdict(float)  # (team, position) -> biggest projection drop of a player there
    for p, (t, pos) in teams.items():
        before = proj(prev, p, leg - 1)
        if before >= 5 and proj(now, p, leg) <= 0.3 * before: drop[(t, pos)] = max(drop[(t, pos)], before)
    out = {}
    for p in now:
        s_ = last.get(p) or {}
        snaps = (s_.get('off_snp') or 0) / s_['tm_off_snp'] if s_.get('tm_off_snp') else 0.0
        t = teams.get(p)
        out[p] = dict(snap=float(snaps), opps=float(opp(s_)), opps_avg=tot[p] / n[p] if n[p] else 0.0,
                      proj=proj(now, p, leg), proj_prev=proj(prev, p, leg - 1), mate_out=drop.get(t, 0.0) if t else 0.0)
    _signals[key] = out
    return out


def pts_col(ppr):
    return 'pts_ppr' if ppr == 1.0 else ('pts_half_ppr' if ppr == 0.5 else 'pts_std')


def league_rows(path):
    season = path.split(os.sep)[-2]
    tx_path = os.path.join(CACHE, 'transactions', season, os.path.basename(path))
    if not os.path.exists(tx_path): return []
    d = json.load(gzip.open(path, 'rt')); L = d['league']; s = L['settings']
    if s.get('waiver_type') != 2 or not s.get('waiver_budget') or len(d['rosters']) != 12 or L['league_id'] in LF.OURS: return []
    B = s['waiver_budget']; M = {int(w): m for w, m in d['matchups'].items()}
    end = (s.get('playoff_week_start') or 15) - 1
    ppr = L['scoring_settings'].get('rec'); slots = L['roster_positions']
    tx = json.load(gzip.open(tx_path, 'rt'))
    claims = sorted((t for leg, ts in tx.items() for t in ts if t['type'] == 'waiver'), key=lambda t: t.get('status_updated') or 0)
    spent = defaultdict(float)  # roster -> budget used so far
    prices = []  # winning bid share of budget, in processing order
    rows = []
    # processings in time order; each player's claims in one processing form an auction
    by_time = defaultdict(list)
    for t in claims: by_time[t.get('status_updated') or 0].append(t)
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
            rosters = {m['roster_id']: [p for p in (m.get('players') or []) if p in vals] for m in M[leg - 1]}
            rostered = {p for ps in rosters.values() for p in ps}
            weeks = list(range(leg, min(leg + AHEAD, end + 1)))
            ros = lambda p: sum(vals[p][1].get(w, (0, 0))[0] for w in weeks) / len(weeks)
            fa_by_pos = defaultdict(list)
            for p in vals:
                if p not in rostered: fa_by_pos[vals[p][0]].append(ros(p))
            for pos in fa_by_pos: fa_by_pos[pos].sort(reverse=True)
            stats = LF.arch(season, f'stats/{leg - 1}')
            sig = signals(season, leg, ppr)
            col = pts_col(ppr)
            base = {}
            n_prev = len(prices); med_price = float(np.median(prices)) if prices else np.nan
            spent_share = sum(spent.values()) / (B * 12)
            for pid, bids in auctions.items():
                if pid not in vals: continue
                pos = vals[pid][0]; v = ros(pid)
                g = {}
                for r, ps in rosters.items():
                    key = (leg, r, pid)
                    if key not in gains:
                        if (leg, r) not in base:
                            base[(leg, r)] = sum(LF.lineup(ps, vals, slots, w, 0) for w in weeks) / len(weeks)
                        with_p = ps if pid in ps else ps + [pid]
                        gains[key] = sum(LF.lineup(with_p, vals, slots, w, 0) for w in weeks) / len(weeks) - base[(leg, r)]
                    g[r] = gains[key]
                rank = 1 + sum(x > v + 1e-9 for x in fa_by_pos[pos])
                bidders = {}
                for r, b, won in bids:  # a team's best claim on the player
                    if r not in bidders or b > bidders[r][0]: bidders[r] = (b, won)
                for r, (b, won) in bidders.items():
                    others = [x for x in bidders if x != r]
                    H = max((bidders[x][0] for x in others), default=-1.0)
                    rem = {x: B - spent[x] for x in rosters if x != r}
                    needers = [x for x in rem if g.get(x, 0) >= NEED]
                    rows.append(dict(
                        season=int(season), league=L['league_id'], when=when, leg=leg, end=end, budget=B, player=pid, pos=pos,
                        val=v, val_now=vals[pid][1].get(leg, (0, 0))[0], fa_rank=rank,
                        last_pts=float((stats.get(pid) or {}).get(col) or 0.0), **sig.get(pid, {}),
                        spent_share=spent_share, med_price=med_price, n_prev=n_prev,
                        max_rem=max(rem.values()) / B if rem else 0.0,
                        max_rem_need=max((rem[x] for x in needers), default=0.0) / B,
                        n_need=len(needers), n_big=sum(g.get(x, 0) >= BIG_NEED for x in rem),
                        max_gain=max((g.get(x, 0) for x in rem), default=0.0),
                        my_gain=g.get(r, 0.0), my_rem=(B - spent[r]) / B,
                        bid=b / B, H=H / B if H >= 0 else -1.0, n_bidders=len(bidders), won=bool(won)))
        # update money after the processing
        for pid, bids in auctions.items():
            for r, b, won in bids:
                if won:
                    spent[r] += b; prices.append(b / B)
    return rows


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--workers', type=int, default=8); a = ap.parse_args()
    import pandas as pd
    files = sorted(glob.glob(os.path.join(CACHE, 'leagues', '*', '*.json.gz')))
    out = []
    with Pool(a.workers) as pool:
        for i, part in enumerate(pool.imap_unordered(league_rows, files, chunksize=4)):
            out.extend(part)
            if i % 500 == 0: print(f'{i}/{len(files)} leagues, {len(out):,} bids', flush=True)
    df = pd.DataFrame(out)
    df.to_parquet(os.path.join(CACHE, 'faab_auctions.parquet'))
    print(f'{len(df):,} bids, {df.groupby(["league", "when", "player"]).ngroups:,} auctions, {df.league.nunique():,} league-seasons')
    print(df.groupby('season').size().to_string())


if __name__ == '__main__':
    main()
