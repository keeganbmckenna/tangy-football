"""How game state moves a player's remaining fantasy points, and how players in the same NFL game
move together: the exploration before rung 4 (game state) and rung 5 (correlated players) of
the live addendum.

Every projected player (Sleeper's pre-game projection, half PPR) at every 3-minute sample of
his NFL game, 2018-2025 (live_components.py): the share of his game left (gameRemaining), his
team's score margin, who has the ball and that possession's expected points (nflverse's ep,
from his team's side), his half-PPR points so far, and what he actually scored from then on.

    python live_state.py            # builds cache/live_state.parquet, then reports
    python live_state.py --report   # report only
    python live_state.py --fit      # each fold's tables for the replay (cache/live_state_fit/)

Reports (all half PPR, regular season):
  1. Remaining points against the projection's share (proj x share left), by position, score
     margin and time left: the game-script effect.
  2. The possession effect: having the ball, by expected points of the drive.
  3. How much of the variance of remaining points game state explains beyond proj x share left,
     fitted on the other seasons (out of sample).
  4. Correlations of remaining-point misses between players in the same game (teammates by
     position pair, opponents, a defense against the offense it faces).
"""
import os, sys
from collections import defaultdict

import numpy as np
import pandas as pd
import torch

import leagues_fit as LF
import live_components as LC
import live_model as LM

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'cache', 'live_state.parquet')
STEP = 180
CANON = {'LA': 'LAR', 'OAK': 'LV', 'SD': 'LAC', 'STL': 'LAR', 'WSH': 'WAS', 'JAC': 'JAX'}
HALF = {'pass_yd': 0.04, 'pass_td': 4, 'pass_int': -1, 'pass_2pt': 2, 'rec': 0.5, 'rec_yd': 0.1, 'rec_td': 6, 'rec_2pt': 2,
        'rush_yd': 0.1, 'rush_td': 6, 'rush_2pt': 2, 'fum_lost': -2, 'xpm': 1, 'xpmiss': -1, 'fgm_0_19': 3, 'fgm_20_29': 3,
        'fgm_30_39': 3, 'fgm_40_49': 4, 'fgm_50p': 5, 'fgmiss': -1,
        # Team defense, apart from points allowed (from the score)
        'sack': 1, 'int': 2, 'fum_rec': 2, 'safe': 2, 'blk_kick': 2, 'def_td': 6, 'def_st_td': 6}
# Our league's points-allowed brackets, for defenses' remaining points
PA = {'pts_allow_0': 10, 'pts_allow_1_6': 7, 'pts_allow_7_13': 4, 'pts_allow_14_20': 1, 'pts_allow_21_27': 0,
      'pts_allow_28_34': -1, 'pts_allow_35p': -4}


def canon(t):
    return CANON.get(t, t) if t else t


def pa_points(allowed):
    for k, v in PA.items():
        lo, _, hi = k[10:].partition('_')
        lo = int(lo.rstrip('p'))
        if allowed >= lo and (k.endswith('p') or allowed <= int(hi or lo)): return v
    return 0


def season_rows(season):
    comps = LC.load(season)
    w8 = np.zeros(len(LC.COMPONENTS))
    for k, v in HALF.items(): w8[LC.K[k]] = v
    rows = defaultdict(list)
    for week, wk in sorted(comps.items()):
        try: proj_rows = LF.arch(season, f'projections/{week}')
        except FileNotFoundError: continue
        proj = {}
        for r in proj_rows:
            pos = (r.get('player') or {}).get('position')
            st = r.get('stats') or {}
            if pos in ('QB', 'RB', 'WR', 'TE', 'K'):
                p = st.get('pts_half_ppr') or 0
                if p >= 1: proj[r['player_id']] = (pos, canon(r.get('team')), p)
            elif pos == 'DEF' and isinstance(st.get('pts_allow'), (int, float)):
                proj[canon(r['player_id'])] = ('DEF', canon(r['player_id']), st.get('pts_allow'))
        ev = wk['ev']
        ix = {(canon(w) if w.isalpha() else w): i for i, w in enumerate(wk['ids'])}
        pts = ev['v'] * w8[ev['k']]
        for gi, (home, away, s, situ) in enumerate(wk['games']):
            home, away = canon(home), canon(away)
            first, last = int(s[0, 0]), int(s[-1, 0])
            times = np.arange((first // STEP + 1) * STEP, last, STEP)
            if not len(times): continue
            i = np.searchsorted(s[:, 0], times, side='right') - 1
            snap, sit = s[i], situ[i]
            for team, opp, sign, mine, theirs in ((home, away, 1.0, 3, 4), (away, home, -1.0, 4, 3)):
                own_s, opp_s = snap[:, mine].astype(float), snap[:, theirs].astype(float)
                margin = own_s - opp_s
                rem = LM.game_remaining(torch.ones(len(times), dtype=torch.long), torch.tensor(snap[:, 1], dtype=torch.float64),
                                        torch.tensor(snap[:, 2], dtype=torch.float64), torch.tensor(margin)).numpy()
                ball = sit[:, 0] * sign  # 1 this team has it, -1 the opponent
                ep = np.where(ball > 0, sit[:, 2], np.where(ball < 0, -sit[:, 2], 0.0))
                yard = np.where(ball != 0, sit[:, 1], np.nan)
                final_opp = float(s[-1, theirs])
                for pid, (pos, pteam, p) in proj.items():
                    if pteam != team: continue
                    e = ix.get(pid)
                    if pos == 'DEF':
                        # Defense: its other points plus points-allowed bracket; remaining = final - now
                        sel = (ev['who'] == e) if e is not None else np.zeros(len(ev), bool)
                        et, ep_ = ev['t'][sel], pts[sel]
                        cum = np.array([ep_[et <= t].sum() for t in times])
                        now = cum + np.array([pa_points(a) for a in opp_s])
                        final = ep_.sum() + pa_points(final_opp)
                    else:
                        sel = (ev['who'] == e) if e is not None else np.zeros(len(ev), bool)
                        et, ep_ = ev['t'][sel], pts[sel]
                        now = np.array([ep_[et <= t].sum() for t in times])
                        final = ep_.sum()
                    n = len(times)
                    for k, v in (('season', [int(season)] * n), ('week', [week] * n), ('game', [gi] * n), ('ti', np.arange(n)),
                                 ('team', [team] * n), ('player', [pid] * n), ('pos', [pos] * n), ('proj', [p] * n), ('rem', rem),
                                 ('margin', margin), ('ball', ball), ('ep', ep), ('yard', yard), ('opp_score', opp_s),
                                 ('so_far', now), ('left', final - now)):
                        rows[k].extend(v)
    df = pd.DataFrame(rows)
    print(f'{season}: {len(df):,} player-samples', flush=True)
    return df


def build():
    from multiprocessing import Pool
    with Pool(8) as pool: df = pd.concat(pool.map(season_rows, LC.SEASONS), ignore_index=True)
    for c in ('team', 'player', 'pos'): df[c] = df[c].astype('category')
    df.to_parquet(OUT, index=False)
    return df




MARGINS = [-99, -17, -9, -4, 3, 8, 16, 99]
MARGIN_LABELS = ['down 17+', 'down 9-16', 'down 4-8', 'within 3', 'up 4-8', 'up 9-16', 'up 17+']
REMS = [0, 0.25, 0.5, 0.75, 1.01]
REM_LABELS = ['last qtr', '3rd qtr', '2nd qtr', '1st qtr']


def features(df):
    df = df.copy()
    df['mb'] = pd.cut(df.margin, MARGINS, labels=False, right=True)
    df['rb'] = pd.cut(df.rem, REMS, labels=False, right=True)
    df['base'] = df.proj * df.rem
    return df


def report_script(df):
    print('\n1. Points actually scored from here / projection x share of game left (1.00 = as the site assumes), half PPR')
    sk = df[df.pos != 'DEF']
    for pos in ('QB', 'RB', 'WR', 'TE', 'K'):
        g = sk[sk.pos == pos]
        t = g.groupby(['rb', 'mb']).apply(lambda x: x.left.sum() / x.base.sum(), include_groups=False).unstack()
        n = g.groupby(['rb', 'mb']).size().unstack()
        print(f'  {pos:3s} ' + ''.join(f'{m:>11s}' for m in MARGIN_LABELS))
        for rb in (3, 2, 1, 0):
            print(f'  {REM_LABELS[rb]:9s}' + ''.join(f'{t.loc[rb, mb]:11.2f}' if n.loc[rb, mb] >= 2000 else f'{"":11s}' for mb in range(7)))
    d = df[df.pos == 'DEF']
    print('  DEF (its points still to come, incl. points-allowed brackets, by margin): ' + ', '.join(
        f'{MARGIN_LABELS[m]} {g.left.mean():+.2f}' for m, g in d.groupby('mb')))


def report_possession(df):
    print('\n2. Possession: a player\'s points from here minus projection x share left, by his team\'s drive expected points')
    sk = df[(df.pos.isin(['QB', 'RB', 'WR', 'TE', 'K']))].copy()
    sk['eb'] = pd.cut(sk.ep, [-9, -3, -1, -0.01, 0.01, 1, 3, 9], labels=['opp ball, EP 3+', 'opp 1-3', 'opp <1', 'no ball', 'own <1', 'own 1-3', 'own 3+'])
    t = sk.groupby(['pos', 'eb'], observed=True).apply(lambda x: (x.left - x.base).mean(), include_groups=False).unstack()
    print(t.round(2).to_string())


def fit_tables(tr):
    """Game-state model, fitted on training seasons: factor F[pos, rem bucket, margin bucket] on proj x share
    left, plus beta[pos] x drive EP x the player's share of his team's projection"""
    sk = tr[tr.pos != 'DEF']
    F = sk.groupby(['pos', 'rb', 'mb'], observed=True).apply(lambda x: x.left.sum() / max(x.base.sum(), 1e-9), include_groups=False)
    share = sk.proj / sk.groupby(['season', 'week', 'game', 'ti', 'team'], observed=True).proj.transform('sum')
    resid = sk.left - sk.base * F.reindex(pd.MultiIndex.from_arrays([sk.pos, sk.rb, sk.mb])).to_numpy()
    x = share * sk.ep
    beta = pd.Series({p: (x[sk.pos == p] * resid[sk.pos == p]).sum() / (x[sk.pos == p] ** 2).sum() for p in sk.pos.unique()})
    return F, beta


def predict(df, F, beta):
    share = df.proj / df.groupby(['season', 'week', 'game', 'ti', 'team'], observed=True).proj.transform('sum')
    f = F.reindex(pd.MultiIndex.from_arrays([df.pos, df.rb, df.mb])).fillna(1.0).to_numpy()
    return df.base * f + beta.reindex(df.pos).fillna(0).to_numpy() * share * df.ep


def report_variance(df):
    print('\n3. Out of sample (each season from a fit on the others): variance of points still to come explained beyond proj x share left')
    sk = df[df.pos != 'DEF']
    out = []
    for s in sorted(sk.season.unique()):
        tr, te = sk[sk.season != s], sk[sk.season == s]
        F, beta = fit_tables(tr)
        hat = predict(te, F, beta)
        base = ((te.left - te.base) ** 2).mean()
        out.append((s, 1 - ((te.left - hat) ** 2).mean() / base, ((te.left - te.base) ** 2).mean(), te.left.var()))
    for s, gain, mse, var in out:
        print(f'  {s}: miss variance {mse:6.1f} (points still to come vary {var:5.1f}), game state removes {gain:.2%} of the miss')
    F, beta = fit_tables(sk)
    print('  drive EP weight on a player\'s share of the team projection, by position:', beta.round(2).to_dict())
    return F, beta


def correlations(df, F, beta):
    """(position pair, teammates?) -> correlation of misses at halftime, weighted over pair types"""
    df = df.copy()
    sk = df[df.pos != 'DEF']
    df.loc[sk.index, 'miss'] = sk.left - predict(sk, F, beta)
    d = df[df.pos == 'DEF']
    df.loc[d.index, 'miss'] = d.left - d.groupby(['mb', 'rb'], observed=True).left.transform('mean')
    half = df[(df.rem > 0.45) & (df.rem <= 0.55)].sort_values('ti').groupby(['season', 'week', 'game', 'player'], observed=True).head(1)
    half = half[['season', 'week', 'game', 'team', 'player', 'pos', 'proj', 'miss']]
    # Each team's top projected player at each position (QB1, RB1, WR1, TE1, K, DEF)
    top = half.sort_values('proj', ascending=False).groupby(['season', 'week', 'game', 'team', 'pos'], observed=True).head(1)
    pairs = top.merge(top, on=['season', 'week', 'game'], suffixes=('_a', '_b'))
    pairs = pairs[pairs.player_a.astype(str) < pairs.player_b.astype(str)]
    pairs['same'] = pairs.team_a == pairs.team_b
    rows = []
    for (pa, pb, same), g in pairs.groupby(['pos_a', 'pos_b', 'same'], observed=True):
        if len(g) < 500: continue
        key = tuple(sorted((str(pa), str(pb))))
        rows.append((key, same, len(g), np.corrcoef(g.miss_a, g.miss_b)[0, 1]))
    agg = defaultdict(lambda: [0, 0.0])
    for key, same, n, r in rows:
        a = agg[(key, same)]; a[1] = (a[1] * a[0] + r * n) / (a[0] + n); a[0] += n
    return agg


def report_correlation(df, F, beta):
    print('\n4. Correlation of misses (points from here minus the game-state prediction) between players in the same game, at halftime')
    agg = correlations(df, F, beta)
    for (key, same), (n, r) in sorted(agg.items(), key=lambda x: -abs(x[1][1])):
        print(f'  {"teammates" if same else "opponents":9s} {key[0]:3s}-{key[1]:3s}  n={n:6,}  r={r:+.2f}')


FIT = os.path.join(HERE, 'cache', 'live_state_fit')


def fold_fits(df):
    """For each held-out season: the game-state tables and correlations fitted on the other seasons"""
    import json
    df = features(df[(df.rem > 0) & (df.rem <= 1.0)])
    os.makedirs(FIT, exist_ok=True)
    for s in sorted(df.season.unique()):
        tr = df[df.season != s]
        F, beta = fit_tables(tr[tr.pos != 'DEF'])
        rho = correlations(tr, F, beta)
        json.dump({'F': {f'{p}|{rb}|{mb}': float(v) for (p, rb, mb), v in F.items()}, 'beta': {k: float(v) for k, v in beta.items()},
                   'rho': {f'{a}|{b}|{int(same)}': float(r) for ((a, b), same), (n, r) in rho.items()},
                   'margins': MARGINS, 'rems': REMS}, open(os.path.join(FIT, f'{s}.json'), 'w'))
        print(f'fold {s}: {len(F)} factors, {len(rho)} correlations', flush=True)


def report(df):
    df = features(df[(df.rem > 0) & (df.rem <= 1.0)])
    report_script(df)
    report_possession(df)
    F, beta = report_variance(df)
    report_correlation(df, F, beta)


if __name__ == '__main__':
    df = pd.read_parquet(OUT) if ('--report' in sys.argv or '--fit' in sys.argv) and os.path.exists(OUT) else build()
    fold_fits(df) if '--fit' in sys.argv else report(df)
