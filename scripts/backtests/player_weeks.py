"""Player-week table: every rostered player in every crawled league's team-weeks, 2018-2025.

The learned projection correction and the player-level simulator need, for each player a
manager rostered, what was expected before kickoff and what happened. One row per rostered
player per team-week of every crawled league-season that was played (leagues_fit.played,
our own league left out), all weeks Sleeper has matchups for (playoffs marked):

  league side   season, league_id, roster_id, owner_id, week, playoff, ppr (the league's
                points per reception), started, slot (the lineup slot, BN on the bench),
                points (players_points: the league's own scoring)
  archive side  position, nfl_team and opp (that week's projection row, else the nearest
                week's, else players.json; the schedule), bye, proj (Sleeper's pre-game projection in the league's PPR,
                NaN if Sleeper didn't project him), stats_pts (the same scoring from the
                week's stats; NaN for defenses, which Sleeper doesn't total), played (gp or
                any points in the week's stats)
  2022-2025     injury and practice: the final status on the NFL's injury report (nflverse,
                via injuries.py; 'none' if not listed, null before 2022). The archive's own
                injury_status fields are written after the season, so they aren't used.

Writes cache/player_weeks.parquet (git-ignored: these are other people's leagues) and prints
row counts, the share of starters with a projection, and the projection's correlation with
actual points per season. --check sums 500 random team-weeks' starters and compares with
the team's points in the crawled file. Run crawl_leagues.py first.
"""
import glob, gzip, json, os, sys
from collections import defaultdict
from multiprocessing import Pool
import numpy as np
import pandas as pd
import leagues_fit as LF
import injuries as INJ

HERE = os.path.dirname(os.path.abspath(__file__))
LEAGUES = os.path.join(HERE, 'cache', 'leagues')
OUT = os.path.join(HERE, 'cache', 'player_weeks.parquet')
SEASONS = [str(s) for s in range(2018, 2026)]
COLS = ('season', 'league_id', 'roster_id', 'owner_id', 'week', 'playoff', 'ppr', 'player_id', 'started', 'slot',
        'points', 'position', 'nfl_team', 'opp', 'bye', 'proj', 'stats_pts', 'played', 'injury', 'practice')


def injury_reports(season, players):
    """week -> Sleeper ID -> (final report status, practice status), matched as injuries.py does"""
    if season not in INJ.SEASONS: return None
    by_gsis = {p['gsis_id'].strip(): pid for pid, p in players.items() if p.get('gsis_id')}
    by_gsis.update(INJ.CROSSWALK)
    names = defaultdict(list)
    for pid, p in players.items():
        if p.get('full_name') and p.get('position') in INJ.POSITIONS: names[(INJ.norm(p['full_name']), p['position'])].append(pid)
    rep = defaultdict(dict)
    for r in INJ.reports(season):
        if r['game_type'] != 'REG': continue
        pid = by_gsis.get(r['gsis_id'].strip())
        if not pid:
            cands = names.get((INJ.norm(r['full_name']), r['position']), [])
            pid = cands[0] if len(cands) == 1 else None
        if pid: rep[int(r['week'])][pid] = (r['report_status'] or 'listed', r['practice_status'] or None)
    return rep


def season_rows(season):
    arch = lambda name: LF.arch(season, name)
    # players.json exists from 2022: earlier seasons take positions (not teams) from 2022's
    players = arch('players') if os.path.exists(os.path.join(LF.ARCHIVE, season, 'players.json.gz')) else None
    pos_of = {p: v.get('position') for p, v in (players or LF.arch('2022', 'players')).items()}
    opp = defaultdict(dict)
    for g in arch('schedule'): opp[g['week']][g['home']] = g['away']; opp[g['week']][g['away']] = g['home']
    # week -> pid -> (position, team, half PPR, full PPR); week -> pid -> (played, half, full)
    proj, stats = {}, {}
    for w in range(1, 19):
        proj[w] = {r['player_id']: ((r.get('player') or {}).get('position'), r.get('team'), (r.get('stats') or {}).get('pts_half_ppr') or 0.0,
                                    (r.get('stats') or {}).get('pts_ppr') or 0.0) for r in arch(f'projections/{w}')}
        stats[w] = {p: (bool(s.get('gp')) or bool(s.get('pts_half_ppr') or s.get('pts_ppr') or s.get('pts_std')), s.get('pts_half_ppr'), s.get('pts_ppr'))
                    for p, s in arch(f'stats/{w}').items()}
    # A player Sleeper didn't project in a week: his team from the nearest week it did (earlier first)
    seen = defaultdict(dict)
    for w in range(1, 19):
        for p, r in proj[w].items():
            if r[1]: seen[p][w] = r[1]
    team_near = {p: {w: t[max((x for x in t if x <= w), default=min(t))] for w in range(1, 19)} for p, t in seen.items()}
    rep = injury_reports(season, players)
    c = {k: [] for k in COLS}
    for path in sorted(glob.glob(os.path.join(LEAGUES, season, '*.json.gz'))):
        d = json.load(gzip.open(path, 'rt'))
        L, M = d['league'], {int(w): m for w, m in d['matchups'].items()}
        start = L['settings'].get('playoff_week_start') or 15; end = start - 1
        if any(w not in M for w in range(1, end + 1)) or L['league_id'] in LF.OURS: continue
        ids = sorted(m['roster_id'] for m in M[1])
        pts = {w: {m['roster_id']: (m.get('points') or 0) for m in M[w]} for w in range(1, end + 1)}
        if not LF.played(pts, ids, end): continue
        ppr = float(L['scoring_settings'].get('rec') or 0); full = ppr >= 0.75
        slots = L['roster_positions']; lid = int(L['league_id'])
        owner = {r['roster_id']: int(r['owner_id']) if r.get('owner_id') else -1 for r in d.get('rosters') or []}
        for w, ms in sorted(M.items()):
            if w > 18: continue
            for m in ms:
                starters = [p for p in (m.get('starters') or [])]
                slot_of = {p: slots[i] for i, p in enumerate(starters) if p not in ('0', '', None) and i < len(slots)}
                pp = m.get('players_points') or {}
                for p in dict.fromkeys(list(m.get('players') or []) + list(slot_of)):
                    if p in ('0', '', None): continue
                    pr, st_ = proj[w].get(p), stats[w].get(p)
                    pos = (pr and pr[0]) or pos_of.get(p) or ('DEF' if p.isalpha() else None)
                    team = (pr and pr[1]) or (team_near.get(p) or {}).get(w) or ((players or {}).get(p) or {}).get('team') or (p if p.isalpha() else None)
                    o = opp[w].get(team)
                    c['season'].append(int(season)); c['league_id'].append(lid); c['roster_id'].append(m['roster_id'])
                    c['owner_id'].append(owner.get(m['roster_id'], -1)); c['week'].append(w); c['playoff'].append(w >= start)
                    c['ppr'].append(ppr); c['player_id'].append(p); c['started'].append(p in slot_of); c['slot'].append(slot_of.get(p, 'BN'))
                    c['points'].append(pp.get(p, np.nan)); c['position'].append(pos); c['nfl_team'].append(team); c['opp'].append(o)
                    c['bye'].append(team is not None and o is None)
                    c['proj'].append(pr[3 if full else 2] if pr else np.nan)
                    v = st_ and st_[2 if full else 1]
                    c['stats_pts'].append(v if v is not None else np.nan); c['played'].append(bool(st_ and st_[0]))
                    ij = rep[w].get(p, ('none', None)) if rep is not None else (None, None)
                    c['injury'].append(ij[0]); c['practice'].append(ij[1])
    df = pd.DataFrame(c)
    for k, t in (('season', 'int16'), ('roster_id', 'int16'), ('week', 'int8'), ('ppr', 'float32'), ('points', 'float32'),
                 ('proj', 'float32'), ('stats_pts', 'float32')):
        df[k] = df[k].astype(t)
    for k in ('player_id', 'slot', 'position', 'nfl_team', 'opp', 'injury', 'practice'): df[k] = df[k].astype('category')
    print(f'{season}: {len(df):,} rows from {df.league_id.nunique()} leagues', flush=True)
    return df


def summary(df):
    print(f"\n{len(df):,} player-weeks, {df.league_id.nunique():,} league-seasons -> {OUT}")
    print('season      rows  leagues  starters  starters projected  corr(proj, points) starters  rostered(proj>0)')
    for s, g in df.groupby('season'):
        st_ = g[g.started & g.proj.notna() & g.points.notna()]; ro = g[(g.proj > 0) & g.points.notna()]
        print(f"{s}  {len(g):10,}  {g.league_id.nunique():6}  {g.started.sum():9,}  {g[g.started].proj.notna().mean():17.1%}"
              f"  {np.corrcoef(st_.proj, st_.points)[0, 1]:26.3f}  {np.corrcoef(ro.proj, ro.points)[0, 1]:16.3f}")
    inj = df[df.injury.notna()]
    if len(inj): print('injury report (2022-2025 rows):', inj.injury.value_counts().to_dict())


def check(df, n=500, seed=0):
    """Starters' points summed per team-week against the team's points in the crawled file"""
    tw = df[['season', 'league_id', 'roster_id', 'week']].drop_duplicates()
    pick = tw.sample(n, random_state=seed)
    sums = df[df.started].groupby(['season', 'league_id', 'roster_id', 'week'], observed=True).points.sum()
    diffs = []
    for (s, lid), g in pick.groupby(['season', 'league_id']):
        d = json.load(gzip.open(os.path.join(LEAGUES, str(s), f'{lid}.json.gz'), 'rt'))
        for r in g.itertuples():
            m = next(m for m in d['matchups'][str(r.week)] if m['roster_id'] == r.roster_id)
            diffs.append(sums.get((s, lid, r.roster_id, r.week), 0.0) - (m.get('points') or 0))
    diffs = np.abs(np.array(diffs))
    print(f'check: {n} random team-weeks, starters sum to the team points within 0.01 in {np.mean(diffs < 0.01):.1%}, '
          f'within 1 in {np.mean(diffs < 1):.1%}; largest gap {diffs.max():.2f}')


if __name__ == '__main__':
    if '--check' in sys.argv and os.path.exists(OUT):
        df = pd.read_parquet(OUT)
    else:
        with Pool(min(8, len(SEASONS))) as pool: df = pd.concat(pool.map(season_rows, SEASONS), ignore_index=True)
        for k in ('player_id', 'slot', 'position', 'nfl_team', 'opp', 'injury', 'practice'): df[k] = df[k].astype('category')
        df.to_parquet(OUT, index=False)
    summary(df)
    if '--check' in sys.argv: check(df)
