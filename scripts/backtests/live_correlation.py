"""Do correlated players (a QB and his receivers, both QBs in a shootout) sharpen kickoff win odds?

The Live tab adds starters' variances as if every player were independent, scaled to the
league's spread. Measured on the player-week table (player_weeks.py), how far a player beats
his projection is correlated with his QB's (+0.32 for a QB and his WR, +0.29 for his TE)
and with the other QB in the same game (+0.24). Stacks widen a team's swings; players in the
same NFL game on opposite fantasy teams tie the two teams together.

Every regular-season matchup in the crawled 12-team leagues, at kickoff: each team's
expected score is its starters' projections (league scoring); each starter's variance
a + b x projection by position. Two models, each with one overall variance scale:

  independent   the margin's variance is the sum of the starters' variances (the Live tab)
  correlated    plus 2 rho sd_i sd_j for teammates on the same NFL team, minus 2 rho sd_i sd_j
                for players on opposite fantasy teams in the same NFL game (same NFL team or
                opponents), rho by position pair

The variance curves, correlations and scales are fitted leaving the season out. Rule set before
the run: adopt if kickoff log loss improves by at least 0.001, 95% interval resampling leagues
excluding zero, in at least 5 of 8 seasons.

    python live_correlation.py

Result (2026-10-22): no. Log loss 0.6385 -> 0.6385 (-0.00003, 95% -0.00005 to -0.00000, 5 of 8
seasons): a stack moves a team's spread by a few percent, links across the two teams partly
cancel, and the variance scale already absorbs the average. Late-game situations (a few
correlated players left) can't be tested on this data.
"""
import math, os
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import gpu_sim as G

HERE = os.path.dirname(os.path.abspath(__file__))
POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']


def load():
    t = pq.read_table(os.path.join(HERE, 'cache', 'player_weeks.parquet'),
                      columns=['season', 'league_id', 'roster_id', 'week', 'player_id', 'started', 'position', 'nfl_team', 'opp', 'proj', 'points', 'playoff'],
                      filters=[('started', '=', True), ('playoff', '=', False)]).to_pandas()
    for c in ('position', 'nfl_team', 'opp', 'player_id'): t[c] = t[c].astype(str)
    t = t[t['position'].isin(POS)].copy()
    t['proj'] = t['proj'].fillna(0.0); t['points'] = t['points'].fillna(0.0)  # a starter who didn't play scored 0
    t['res'] = t['points'] - t['proj']
    return t


def fit_params(tr):
    """Variance curve per position (E[res^2] = a + b proj) and correlations by position pair, on training rows"""
    var = {}
    for p, g in tr.groupby('position'):
        A = np.c_[np.ones(len(g)), g['proj'].values]; ab = np.linalg.lstsq(A, g['res'].values ** 2, rcond=None)[0]
        var[p] = (max(ab[0], 1.0), max(ab[1], 0.0))
    # one row per real player-week (the same player appears in many leagues)
    u = tr[tr['proj'] >= 3].drop_duplicates(['season', 'week', 'player_id'])[['season', 'week', 'player_id', 'position', 'nfl_team', 'opp', 'res']]
    rho = {}
    for kind, right in (('same', 'nfl_team'), ('opp', 'opp')):
        m = u.merge(u, left_on=['season', 'week', 'nfl_team'], right_on=['season', 'week', right], suffixes=('_a', '_b'))
        m = m[m['player_id_a'] != m['player_id_b']]
        for (pa, pb), g in m.groupby(['position_a', 'position_b']):
            if len(g) >= 200: rho[(kind, pa, pb)] = float(np.corrcoef(g['res_a'], g['res_b'])[0, 1])
    return var, rho


def matchup_variances(df, var, rho):
    """Per (league, week, roster): mean, independent variance, within-team covariance; and cross-team
    covariance per matchup pair"""
    sd2 = np.array([var[p][0] + var[p][1] * x for p, x in zip(df['position'], df['proj'])])
    df = df.assign(sd=np.sqrt(sd2), v=sd2)
    team = df.groupby(['league_id', 'week', 'roster_id']).agg(mu=('proj', 'sum'), v=('v', 'sum'), pts=('points', 'sum')).reset_index()
    # within a fantasy team: teammates on the same NFL team (pairs counted once)
    k = ['league_id', 'week', 'roster_id', 'nfl_team']
    m = df[k + ['player_id', 'position', 'sd']].merge(df[k + ['player_id', 'position', 'sd']], on=k, suffixes=('_a', '_b'))
    m = m[m['player_id_a'] < m['player_id_b']]
    r = np.array([rho.get(('same', a, b), rho.get(('same', b, a), 0.0)) for a, b in zip(m['position_a'], m['position_b'])])
    m = m.assign(c=2 * r * m['sd_a'] * m['sd_b'])
    within = m.groupby(['league_id', 'week', 'roster_id'])['c'].sum()
    team['cov_in'] = team.set_index(['league_id', 'week', 'roster_id']).index.map(within).fillna(0.0).values
    return df, team


def main():
    t = load()
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12 and r['e'] == 3]  # one row per league-season: its schedule
    games = pd.DataFrame([(int(r['league']), w, r['ids'][a], r['ids'][b], float(r['pts'][w][r['ids'][a]] > r['pts'][w][r['ids'][b]]),
                           float(r['pts'][w][r['ids'][a]] == r['pts'][w][r['ids'][b]]), int(r['season']))
                          for r in data for w in range(1, r['end'] + 1) for a, b in r['games'][w]],
                         columns=['league_id', 'week', 'a', 'b', 'a_won', 'tie', 'season'])
    games = games[games['tie'] == 0]
    t = t[t['league_id'].isin(set(games['league_id']))]
    print(f'{len(games):,} matchups in {games["league_id"].nunique():,} 12-team league-seasons; {len(t):,} starter-weeks', flush=True)
    seasons = sorted(games['season'].unique()); out = []
    for s in seasons:
        var, rho = fit_params(t[t['season'] != s])
        if s == seasons[-1]:
            print('correlations (held out ' + str(s) + '): ' + ', '.join(f'{k[0]} {k[1]}-{k[2]} {v:+.2f}' for k, v in sorted(rho.items(), key=lambda kv: -abs(kv[1]))[:8]))
        res = {}
        for label, part in (('test', t[t['season'] == s]), ('train', t[t['season'] != s])):
            df, team = matchup_variances(part, var, rho)
            g = games[games['season'] == s] if label == 'test' else games[games['season'] != s]
            ti = team.set_index(['league_id', 'week', 'roster_id'])
            A = ti.reindex(pd.MultiIndex.from_arrays([g['league_id'], g['week'], g['a']])); Bt = ti.reindex(pd.MultiIndex.from_arrays([g['league_id'], g['week'], g['b']]))
            ok = A['mu'].notna().values & Bt['mu'].notna().values & (A['v'].values > 0) & (Bt['v'].values > 0)
            # across the two teams: players in the same NFL game
            k = ['league_id', 'week']
            ga = g[ok][k + ['a', 'b']]
            pa = df.merge(ga, left_on=k + ['roster_id'], right_on=k + ['a'])[k + ['a', 'player_id', 'position', 'nfl_team', 'opp', 'sd']]
            pb = df.merge(ga, left_on=k + ['roster_id'], right_on=k + ['b'])[k + ['a', 'player_id', 'position', 'nfl_team', 'sd']]
            parts = []
            for kind, lk in (('same', 'nfl_team'), ('opp', 'opp')):
                m = pa.merge(pb, left_on=k + ['a', lk], right_on=k + ['a', 'nfl_team'], suffixes=('_a', '_b'))
                r = np.array([rho.get((kind, x, y), rho.get((kind, y, x), 0.0)) for x, y in zip(m['position_a'], m['position_b'])])
                parts.append(m.assign(c=r * m['sd_a'] * m['sd_b']).groupby(k + ['a'])['c'].sum())
            cov_x = parts[0].add(parts[1], fill_value=0.0)
            idx = pd.MultiIndex.from_arrays([g['league_id'][ok], g['week'][ok], g['a'][ok]])
            cx = cov_x.reindex(idx).fillna(0.0).values
            d = (A['mu'].values - Bt['mu'].values)[ok]
            v_ind = (A['v'].values + Bt['v'].values)[ok]
            v_cor = v_ind + (A['cov_in'].values + Bt['cov_in'].values)[ok] - 2 * cx
            res[label] = dict(d=d, v_ind=v_ind, v_cor=np.maximum(v_cor, 1.0), y=g['a_won'].values[ok], league=g['league_id'].values[ok],
                              stacked=((A['cov_in'].values + Bt['cov_in'].values)[ok] != 0) | (cx != 0))
        def ll(d, v, y, k_):
            p = np.clip(0.5 * (1 + np.vectorize(math.erf)(d / np.sqrt(k_ * v) / math.sqrt(2))), 1e-6, 1 - 1e-6)
            return -(y * np.log(p) + (1 - y) * np.log(1 - p)), p
        tr, te = res['train'], res['test']; grid = np.arange(0.5, 2.01, 0.05); scales = {}
        for name in ('v_ind', 'v_cor'):
            sub = np.random.default_rng(0).choice(len(tr['d']), min(200000, len(tr['d'])), replace=False)
            scales[name] = grid[int(np.argmin([ll(tr['d'][sub], tr[name][sub], tr['y'][sub], k_)[0].mean() for k_ in grid]))]
        l_ind, p_ind = ll(te['d'], te['v_ind'], te['y'], scales['v_ind']); l_cor, p_cor = ll(te['d'], te['v_cor'], te['y'], scales['v_cor'])
        out.append(pd.DataFrame(dict(season=s, league=te['league'], y=te['y'], l_ind=l_ind, l_cor=l_cor, b_ind=(p_ind - te['y']) ** 2,
                                     b_cor=(p_cor - te['y']) ** 2, stacked=te['stacked'])))
        print(f'  {s}: {len(te["d"]):,} matchups, scales independent {scales["v_ind"]:.2f} correlated {scales["v_cor"]:.2f}, '
              f'log loss {l_ind.mean():.4f} -> {l_cor.mean():.4f}', flush=True)
    R = pd.concat(out); P = {'league': R['league'].values.astype(str)}
    d = (R['l_cor'] - R['l_ind']).values
    for lab, sel in (('all matchups', np.ones(len(R), bool)), ('with stacks or shared NFL games', R['stacked'].values), ('without', ~R['stacked'].values)):
        m, lo, hi = G.interval(P, d, sel); won = sum(d[sel & (R['season'] == s).values].mean() < 0 for s in seasons)
        bd = (R['b_cor'] - R['b_ind']).values; mb, lob, hib = G.interval(P, bd, sel)
        print(f'{lab:<34} {sel.sum():8,}  log loss {R["l_ind"][sel].mean():.4f} -> {R["l_cor"][sel].mean():.4f}: {m:+.5f} [{lo:+.5f}, {hi:+.5f}] ({won} of {len(seasons)})'
              f'   Brier {mb:+.5f} [{lob:+.5f}, {hib:+.5f}]')


if __name__ == '__main__':
    main()
