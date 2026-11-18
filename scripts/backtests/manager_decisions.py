"""Which manager decisions are skill? Each decision measured per team-season, then tested for
whether it persists for the same manager and whether it predicts their next season.

Data: crawled leagues with Sleeper's pre-game projections (player_weeks.py, regular season,
weeks 1-14, 2018-2025, this league left out) and their transactions (cache/transactions).
Every measure is per week and centered within its league-season (z-scored), so leagues of
different scoring compare.

Measures, fixed before any were scored:
  allplay      share of the league outscored each week (the outcome: record on an average schedule)
  startsit     points minus the projection-best lineup's points (the start/sit calls a manager could make)
  hindsight    points / the hindsight-best lineup's (lineup efficiency, as the site shows)
  vs_proj      starters' points minus their projections (starting players who beat expectations)
  roster_proj  the projection-best lineup's projected points (how strong the roster looked, ex ante)
  draft_proj   that in week 1: the drafted roster, as projected
  draft_value  points per week the week-1 roster's players scored that season (for any team)
  pickups      starting-lineup points from waiver and free-agent adds
  trade_net    starting-lineup points from players traded for, minus what players traded away
               scored in their new team's lineup (a league's trades sum to zero)
  adds         waiver and free-agent adds per week (activity)

Tests:
  1. Persistence: the same owner's measure in consecutive seasons (any leagues), correlation
     with a 95% bootstrap over owners. A decision that's skill repeats; luck doesn't.
  2. What explains a season: all-play on the season's measures (standardized), R^2 and weights.
  3. Prediction: next season's all-play from last season's (a) all-play only, (b) all-play plus
     the decision measures, (c) the decision measures only; OLS fitted on the other target
     seasons, scored on each held-out target season by MSE. The decisions add something if (b)
     beats (a) in most seasons.

Robustness (--active): the same tests on leagues where every team stayed active (0.5+ adds a
week, active_leagues.py's rule; this league's least active team is at 0.62-0.92), since a
fading team makes activity look like skill.

    python manager_decisions.py [--rebuild] [--active]
"""
import argparse, glob, gzip, json, os
from collections import defaultdict
from multiprocessing import Pool
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from stats_audit import SLOTS, best


def pick(players, slots, key):
    """The greedy best lineup's indices (stats_audit.best's order: most restrictive slots first)"""
    order = sorted(range(len(players)), key=lambda i: -players[i][key])
    used = []
    for s in sorted(slots, key=lambda s: len(SLOTS.get(s, (s,)))):
        elig = SLOTS.get(s, (s,))
        for i in order:
            if i not in used and players[i]['pos'] in elig:
                used.append(i); break
    return used

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'cache', 'manager_decisions.parquet')
LAST_WEEK = 14
IDP_SLOTS = ['IDP_FLEX', 'DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S']
MEASURES = ['startsit', 'hindsight', 'vs_proj', 'roster_proj', 'draft_proj', 'draft_value', 'pickups', 'trade_net', 'adds']


def transactions(season):
    """league_id -> list of (week, type, adds {player: roster}, drops {player: roster})"""
    out = {}
    for f in glob.glob(os.path.join(HERE, 'cache', 'transactions', str(season), '*.json.gz')):
        try:
            d = json.load(gzip.open(f, 'rt'))
        except Exception:
            continue
        lid = int(os.path.basename(f).split('.')[0])
        out[lid] = [(int(t.get('leg') or w), t['type'], {p: r for p, r in (t.get('adds') or {}).items()}, {p: r for p, r in (t.get('drops') or {}).items()})
                    for w, ts in d.items() for t in ts if t.get('status') == 'complete' and t['type'] in ('waiver', 'free_agent', 'trade')]
    return out


def season_rows(season):
    t = pq.read_table(os.path.join(HERE, 'cache', 'player_weeks.parquet'),
                      columns=['league_id', 'roster_id', 'owner_id', 'week', 'player_id', 'started', 'slot', 'points', 'position', 'proj', 'playoff'],
                      filters=[('season', '=', season), ('playoff', '=', False)]).to_pandas()
    t = t[t.week <= LAST_WEEK]
    for c in ('slot', 'position', 'player_id', 'owner_id'): t[c] = t[c].astype(str)
    t['points'] = t.points.fillna(0.0); t['projected'] = t.proj.notna(); t['proj'] = t.proj.fillna(0.0)
    txs = transactions(season)
    rows = []
    for lid, lg in t.groupby('league_id', sort=False):
        weeks = sorted(lg.week.unique())
        if len(weeks) < LAST_WEEK or lg.roster_id.nunique() < 8: continue
        # Leagues with defensive players: Sleeper doesn't project them (left out, as in the live-odds research)
        if lg.slot.isin(IDP_SLOTS).any(): continue
        tx = txs.get(int(lid))
        if tx is None: continue
        # How each roster got each player: [(week, source)], latest at or before a week wins
        acq = defaultdict(list)
        adds = defaultdict(int)
        adds_week = defaultdict(list)
        for w, typ, a, d in tx:
            for p, r in a.items():
                acq[(r, p)].append((w, 'trade' if typ == 'trade' else 'pickup'))
                if typ != 'trade' and w <= LAST_WEEK: adds[r] += 1; adds_week[(r, w)].append(p)
        for k in acq: acq[k].sort()
        started = {(r.roster_id, r.player_id, r.week): r.points for r in lg[lg.started].itertuples()}
        # A player's points that season wherever he was rostered (for the draft class's value)
        season_pts = lg.drop_duplicates(['player_id', 'week']).groupby('player_id').points.sum()
        team = defaultdict(lambda: defaultdict(float))
        allpts = {}
        for (rid, w), g in lg.groupby(['roster_id', 'week'], sort=False):
            st = g[g.started]
            slots = list(st.slot)
            players = [{'pos': p, 'points': pt, 'proj': pj} for p, pt, pj in zip(g.position, g.points, g.proj)]
            opt, _ = best(players, slots, 'points')
            proj_best, proj_pick = best(players, slots, 'proj')
            pts = st.points.sum()
            allpts[(rid, w)] = pts
            T = team[rid]
            T['owner'] = g.owner_id.iloc[0]
            T['pts'] += pts; T['opt'] += opt; T['startsit'] += pts - proj_pick; T['vs_proj'] += (st.points - st.proj).sum()
            T['roster_proj'] += proj_best
            # Start/sit: did it start the projection-best lineup, and when it didn't, what did that do
            # (an override: a lineup projected 1+ point below the best; neglect: a starter projected at 0, on bye or out)
            # A starter without a projection: this week's start/sit can't be judged
            if not st.projected.all(): continue
            T['weeks'] += 1
            zero = int((st.proj <= 0).sum())
            T['zero_starts'] += zero
            if zero: T['neglect_weeks'] += 1
            elif proj_best - st.proj.sum() >= 1.0:
                T['judg_weeks'] += 1
                T['judg_gain'] += pts - proj_pick
                T['judg_proj_cost'] += proj_best - st.proj.sum()
            # Adds this week: forced if, without them, the roster couldn't fill its lineup with players projected to play
            new = set(adds_week.get((rid, w), []))
            if new:
                pre = [p for p, pid in zip(players, g.player_id) if pid not in new and p['proj'] > 0]
                filled = len(pick(pre, slots, 'proj')) == len(slots)
                T['chosen_adds' if filled else 'forced_adds'] += len(new)
            if w == weeks[0]:
                T['draft_proj'] = proj_best
                T['draft_value'] = float(season_pts.reindex(g.player_id).fillna(0).sum())
            for pid, pt in zip(st.player_id, st.points):
                src = 'draft'
                for aw, s in acq.get((rid, pid), []):
                    if aw <= w: src = s
                if src == 'pickup': T['pickups'] += pt
        # Trades: what each side's received players scored in its lineup afterwards, minus the same for what it sent
        for w0, typ, a, d in tx:
            if typ != 'trade': continue
            for p, receiver in a.items():
                giver = d.get(p)
                gained = sum(started.get((receiver, p, w), 0.0) for w in weeks if w >= w0)
                team[receiver]['trade_net'] += gained
                if giver is not None and giver in team: team[giver]['trade_net'] -= gained
        rids = sorted(team)
        for rid in rids:
            T = team[rid]
            beat = lambda x, y: 1.0 if x > y else 0.5 if x == y else 0.0
            ap = np.mean([np.mean([beat(allpts[(rid, w)], allpts[(o, w)]) for o in rids if o != rid and (o, w) in allpts]) for w in weeks if (rid, w) in allpts])
            n = len(weeks)
            rows.append(dict(season=season, league=int(lid), roster=int(rid), owner=T['owner'], allplay=float(ap), ppg=T['pts'] / n,
                             startsit=T['startsit'] / n, hindsight=T['pts'] / max(T['opt'], 1e-9), vs_proj=T['vs_proj'] / n,
                             roster_proj=T['roster_proj'] / n, draft_proj=T.get('draft_proj', 0.0), draft_value=T.get('draft_value', 0.0) / n,
                             pickups=T['pickups'] / n, trade_net=T['trade_net'] / n, adds=adds.get(rid, 0) / n,
                             forced_adds=T['forced_adds'] / n, chosen_adds=T['chosen_adds'] / n,
                             neglect_rate=T['neglect_weeks'] / max(T['weeks'], 1), judg_rate=T['judg_weeks'] / max(T['weeks'], 1),
                             judg_gain=T['judg_gain'] / T['judg_weeks'] if T['judg_weeks'] else np.nan,
                             judg_proj_cost=T['judg_proj_cost'] / T['judg_weeks'] if T['judg_weeks'] else np.nan))
    return rows


def build():
    seasons = list(range(2018, 2026))
    with Pool(min(8, len(seasons))) as pool:
        parts = pool.map(season_rows, seasons)
    df = pd.DataFrame([r for p in parts for r in p])
    df.to_parquet(OUT)
    return df


def standardize(df):
    """Each measure z-scored within its league-season; all-play kept as is (already relative)"""
    z = df.copy()
    for c in MEASURES + ['ppg']:
        g = z.groupby(['season', 'league'])[c]
        z[c] = (z[c] - g.transform('mean')) / g.transform('std').replace(0, np.nan)
    z['allplay_z'] = z.allplay - 0.5
    return z.dropna(subset=MEASURES)


def owner_seasons(z):
    """An owner in several leagues in a season: the mean of their teams"""
    z = z[(z.owner != 'None') & (z.owner != 'nan')]
    return z.groupby(['owner', 'season'])[MEASURES + ['allplay_z', 'ppg']].mean().reset_index()


def boot_corr(x, y, groups, n=1000, seed=0):
    rng = np.random.default_rng(seed)
    ids, inv = np.unique(groups, return_inverse=True)
    idx = [np.flatnonzero(inv == i) for i in range(len(ids))]
    r = np.corrcoef(x, y)[0, 1]
    bs = []
    for _ in range(n):
        pick = np.concatenate([idx[i] for i in rng.integers(0, len(ids), len(ids))])
        bs.append(np.corrcoef(x[pick], y[pick])[0, 1])
    return r, *np.percentile(bs, [2.5, 97.5])


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--rebuild', action='store_true'); ap.add_argument('--active', action='store_true'); a = ap.parse_args()
    df = build() if a.rebuild or not os.path.exists(OUT) else pd.read_parquet(OUT)
    if a.active:
        keep = df.groupby(['season', 'league']).adds.transform('min') >= 0.5
        df = df[keep]
        print('Active leagues only (every team 0.5+ adds a week)')
    z = standardize(df)
    print(f"{len(df):,} team-seasons in {df.groupby(['season', 'league']).ngroups:,} league-seasons, {df.owner.nunique():,} owners, "
          f"{df.season.min()}-{df.season.max()}")

    os_ = owner_seasons(z)
    nxt = os_.merge(os_.assign(season=os_.season - 1), on=['owner', 'season'], suffixes=('', '_next'))
    print(f'\n1. Persistence: the same owner, consecutive seasons ({len(nxt):,} pairs, {nxt.owner.nunique():,} owners)')
    print(f"{'measure':12s}  {'r':>6}  95%                 r with this season's all-play")
    for c in ['allplay_z', 'ppg'] + MEASURES:
        r, lo, hi = boot_corr(nxt[c].to_numpy(), nxt[c + '_next'].to_numpy(), nxt.owner.to_numpy())
        same = np.corrcoef(os_[c], os_.allplay_z)[0, 1] if c != 'allplay_z' else 1.0
        print(f'{c:12s}  {r:+.3f}  ({lo:+.3f}, {hi:+.3f})   {same:+.3f}')

    print("\n2. What explains a season's all-play (standardized weights, all team-seasons)")
    X = z[MEASURES].to_numpy(); y = z.allplay_z.to_numpy()
    Xc = np.column_stack([np.ones(len(X)), X])
    b, *_ = np.linalg.lstsq(Xc, y, rcond=None)
    r2 = 1 - ((y - Xc @ b) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    print(f'R^2 {r2:.3f}; ' + ', '.join(f'{c} {w * 100:+.2f}' for c, w in zip(MEASURES, b[1:])) + '  (percentage points of all-play per sd)')

    print("\n3. Predicting next season's all-play from last season's (MSE x 1000, held-out target season)")
    sets = {'all-play only': ['allplay_z'], '+ decisions': ['allplay_z'] + MEASURES, 'decisions only': MEASURES}
    print(f"{'target':>6} {'n':>6} {'average':>8} " + ' '.join(f'{k:>15}' for k in sets) + '   (+decisions) - (all-play only) [95%]')
    rng = np.random.default_rng(1)
    better = 0; coefs = []; spreads = []
    for s in sorted(nxt.season.unique() + 1):
        tr = nxt[nxt.season + 1 != s]; te = nxt[nxt.season + 1 == s]
        if len(te) < 100: continue
        y_te = te.allplay_z_next.to_numpy()
        errs = {'average': y_te ** 2}
        for name, cols in sets.items():
            A = np.column_stack([np.ones(len(tr)), tr[cols].to_numpy()])
            w, *_ = np.linalg.lstsq(A, tr.allplay_z_next.to_numpy(), rcond=None)
            if name == '+ decisions': coefs.append(w[1:])
            spreads.append((name, float(np.std(np.column_stack([np.ones(len(te)), te[cols].to_numpy()]) @ w))))
            errs[name] = (y_te - np.column_stack([np.ones(len(te)), te[cols].to_numpy()]) @ w) ** 2
        d = errs['+ decisions'] - errs['all-play only']
        bs = [d[rng.integers(0, len(d), len(d))].mean() for _ in range(2000)]
        lo, hi = np.percentile(bs, [2.5, 97.5])
        better += d.mean() < 0
        print(f'{s:>6} {len(te):>6} {errs["average"].mean() * 1000:>8.3f} ' + ' '.join(f'{errs[k].mean() * 1000:>15.3f}' for k in sets)
              + f'   {d.mean() * 1000:+.3f} [{lo * 1000:+.3f}, {hi * 1000:+.3f}]')
    print(f'+ decisions beats all-play only in {better} seasons')
    for name in sets:
        sd = np.mean([v for k, v in spreads if k == name])
        print(f'{name}: predicted next-season all-play sd {sd:.4f} = {sd * 14:.2f} wins over 14 games')
    w = np.mean(coefs, axis=0)
    print('next-season weights: all-play ' + f'{w[0]:+.3f} per unit, ' + ', '.join(f'{c} {v * 100:+.2f}pp per sd' for c, v in zip(MEASURES, w[1:])))


if __name__ == '__main__':
    main()
