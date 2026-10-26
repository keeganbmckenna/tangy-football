"""Do the site's descriptive team stats measure something, or mostly noise?

Split-half reliability on the crawled 12-team leagues (player_weeks.py, regular season,
2022-2025): each stat computed on weeks 1-7 and again on weeks 8-14 of the same team-season,
and the correlation between the halves (the same team, its stat measured twice). A stat that
reflects something about the team (skill, roster, style) repeats; luck doesn't. Spearman-Brown
gives the full-season reliability from the half-season one. Intervals resample leagues.

  luck          wins minus all-play expected wins (the Advanced Stats luck)
  close         close-game win rate, games decided by under 10 (Luck breakdown)
  sd            weekly score spread (Score Distributions); also its correlation with the mean
  booms         weeks above the league's 75th percentile (Score Distributions)
  efficiency    points / hindsight-best lineup (Rosters: lineup efficiency)
  decisions     points minus the projection-best lineup's points (a start/sit measure the site
                doesn't show: the lineup a manager could have known to start)
  vs_proj       starters' points minus their projections (Rosters: vs projections)
  mean          points per game, for reference

    python stats_audit.py
"""
import os
from collections import defaultdict

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))
SLOTS = {'FLEX': ('RB', 'WR', 'TE'), 'WRRB_FLEX': ('RB', 'WR'), 'REC_FLEX': ('WR', 'TE'), 'SUPER_FLEX': ('QB', 'RB', 'WR', 'TE')}
HALVES = ((1, 7), (8, 14))


def best(players, slots, key):
    """Greedy best lineup (most restrictive slots first): the sum of `key` over it, and the sum of actual points"""
    pool = sorted(players, key=lambda p: -p[key])
    used, tot_key, tot_pts = set(), 0.0, 0.0
    for s in sorted(slots, key=lambda s: len(SLOTS.get(s, (s,)))):
        elig = SLOTS.get(s, (s,))
        for i, p in enumerate(pool):
            if i not in used and p['pos'] in elig:
                used.add(i); tot_key += p[key]; tot_pts += p['points']; break
    return tot_key, tot_pts


def team_weeks():
    t = pq.read_table(os.path.join(HERE, 'cache', 'player_weeks.parquet'),
                      columns=['season', 'league_id', 'roster_id', 'week', 'started', 'slot', 'points', 'position', 'proj', 'playoff'],
                      filters=[('playoff', '=', False), ('season', '>=', 2022)]).to_pandas()
    t = t[t.week <= 14]
    for c in ('slot', 'position'): t[c] = t[c].astype(str)
    t['points'] = t.points.fillna(0.0); t['proj'] = t.proj.fillna(0.0)
    rows = []
    for (s, lid, rid, w), g in t.groupby(['season', 'league_id', 'roster_id', 'week'], sort=False):
        st = g[g.started]
        slots = list(st.slot)
        players = [{'pos': p, 'points': pt, 'proj': pj} for p, pt, pj in zip(g.position, g.points, g.proj)]
        opt, _ = best(players, slots, 'points')
        _, proj_pick = best(players, slots, 'proj')
        rows.append((s, lid, rid, w, st.points.sum(), opt, proj_pick, (st.points - st.proj).sum()))
    return pd.DataFrame(rows, columns=['season', 'league', 'roster', 'week', 'pts', 'opt', 'proj_pick', 'vs_proj'])


def half_stats(tw, matchups):
    """Per team-season and half: every stat"""
    out = []
    for (s, lid), lg in tw.groupby(['season', 'league'], sort=False):
        pts = {(r.roster, r.week): r.pts for r in lg.itertuples()}
        teams = sorted(lg.roster.unique())
        weeks = sorted(lg.week.unique())
        allp = np.array([pts[(r, w)] for r in teams for w in weeks if (r, w) in pts])
        q3 = np.percentile(allp, 75)
        opp = matchups.get((s, lid), {})
        for h, (a, b) in enumerate(HALVES):
            for r in teams:
                ws = [w for w in weeks if a <= w <= b and (r, w) in pts]
                if len(ws) < 6: continue
                sc = np.array([pts[(r, w)] for w in ws])
                # All-play: share of the league it outscored each week
                xw = sum(np.mean([pts[(r, w)] > pts[(o, w)] for o in teams if o != r and (o, w) in pts]) for w in ws)
                wins, close_w, close_n = 0.0, 0, 0
                for w in ws:
                    o = opp.get((r, w))
                    if o is None or (o, w) not in pts: continue
                    m = pts[(r, w)] - pts[(o, w)]
                    wins += 1 if m > 0 else 0.5 if m == 0 else 0
                    if abs(m) < 10: close_n += 1; close_w += m > 0
                sub = lg[(lg.roster == r) & lg.week.between(a, b)]
                out.append(dict(season=s, league=lid, roster=r, half=h, mean=sc.mean(), sd=sc.std(ddof=1), booms=(sc > q3).mean(),
                                luck=wins - xw, close=(close_w / close_n) if close_n >= 2 else np.nan,
                                efficiency=sub.pts.sum() / max(sub.opt.sum(), 1e-9), decisions=(sub.pts - sub.proj_pick).mean(),
                                vs_proj=sub.vs_proj.mean()))
    return pd.DataFrame(out)


def matchup_pairs():
    """(season, league) -> (roster, week) -> opponent, from the crawled league files"""
    import glob, gzip, json
    out = defaultdict(dict)
    for s in range(2022, 2026):
        for path in glob.glob(os.path.join(HERE, 'cache', 'leagues', str(s), '*.json.gz')):
            d = json.load(gzip.open(path, 'rt'))
            lid = int(d['league']['league_id'])
            for w, ms in d['matchups'].items():
                w = int(w)
                if w > 14: continue
                by = defaultdict(list)
                for m in ms:
                    if m.get('matchup_id') is not None: by[m['matchup_id']].append(m['roster_id'])
                for pair in by.values():
                    if len(pair) == 2:
                        out[(s, lid)][(pair[0], w)] = pair[1]; out[(s, lid)][(pair[1], w)] = pair[0]
    return out


def reliability(df, col, n=1000, seed=0):
    """Split-half correlation (teams with both halves), its 95% interval resampling leagues, and Spearman-Brown"""
    wide = df.pivot_table(index=['season', 'league', 'roster'], columns='half', values=col).dropna()
    x, y = wide[0].to_numpy(), wide[1].to_numpy()
    r = np.corrcoef(x, y)[0, 1]
    leagues = wide.index.get_level_values(1).to_numpy()
    ids, inv = np.unique(leagues, return_inverse=True)
    rng = np.random.default_rng(seed)
    groups = [np.flatnonzero(inv == i) for i in range(len(ids))]
    boots = []
    for _ in range(n):
        pick = np.concatenate([groups[i] for i in rng.integers(0, len(ids), len(ids))])
        boots.append(np.corrcoef(x[pick], y[pick])[0, 1])
    lo, hi = np.percentile(boots, [2.5, 97.5])
    sb = 2 * r / (1 + r) if r > 0 else np.nan
    return r, lo, hi, sb, len(x)


if __name__ == '__main__':
    tw = team_weeks()
    df = half_stats(tw, matchup_pairs())
    print(f'{df.groupby(["season", "league"]).ngroups:,} league-seasons, {len(df) // 2:,} team-seasons (2022-2025, weeks 1-7 vs 8-14)\n')
    print('stat          split-half r   95% (leagues)      full-season reliability')
    for col in ('mean', 'luck', 'close', 'sd', 'booms', 'efficiency', 'decisions', 'vs_proj'):
        r, lo, hi, sb, n = reliability(df, col)
        print(f'{col:12s}  {r:+.3f}        ({lo:+.3f}, {hi:+.3f})   {sb:.2f}' if sb == sb else f'{col:12s}  {r:+.3f}        ({lo:+.3f}, {hi:+.3f})   n/a')
    full = df.groupby(['season', 'league', 'roster']).agg(mean=('mean', 'mean'), sd=('sd', 'mean'), booms=('booms', 'mean'), luck=('luck', 'sum'))
    print(f'\ncorr(sd, mean) {np.corrcoef(full["sd"], full["mean"])[0, 1]:+.2f}; corr(booms, mean) {np.corrcoef(full["booms"], full["mean"])[0, 1]:+.2f}')
    print(f'season luck (14 weeks): sd {full.luck.std():.2f} wins; 90% of teams within +/-{np.percentile(np.abs(full.luck), 90):.2f}')
