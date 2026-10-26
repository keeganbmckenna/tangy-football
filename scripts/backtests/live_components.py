"""Every player's and team defense's raw stats, play by play, 2018-2025: what the live-odds
replay of the crawled leagues (live_replay.py) needs to score any league's settings at any
moment of a week.

build_play_timelines.py does this for our league: points in our scoring, for our starters
only. The crawled leagues each have their own scoring, so this keeps the stats themselves
(passing yards, receptions, field goals by distance, sacks...) as events [time, who, stat,
amount], for every player the play-by-play names, plus each NFL game's clock and score after
every play and the situation going forward (who has the ball, field position, the possession's
expected points). A league's points at time t are then its scoring settings times the stats so far.

Stats are Sleeper's scoring keys (COMPONENTS). Yardage bonuses (bonus_rec_yd_100, ...) switch
on when the running total crosses the line. Points allowed come from the game score in the
replay. Anything the play-by-play can't say (laterals, stat corrections, yards-allowed
brackets) is left to the replay, which ends each player at his official points.

    python live_components.py [2018 2019 ...] [--check]

Writes cache/live_components/{season}.pkl (git-ignored). --check compares each player's
half-PPR total from these stats with Sleeper's weekly stats.
"""
import gzip, json, os, pickle, re, sys
from collections import defaultdict
from datetime import datetime
from multiprocessing import Pool

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
import build_play_timelines as BPT  # noqa: E402

ARCHIVE = os.path.join(HERE, '..', '..', 'data', 'sleeper')
PBP = os.path.join(HERE, '..', 'cache', 'nflverse')
OUT = os.path.join(HERE, 'cache', 'live_components')
SEASONS = [str(s) for s in range(2018, 2026)]
TEAM = {'LA': 'LAR', 'OAK': 'LV', 'SD': 'LAC', 'STL': 'LAR'}

COMPONENTS = [
    # Passing
    'pass_yd', 'pass_td', 'pass_int', 'pass_int_td', 'pass_2pt', 'pass_att', 'pass_cmp', 'pass_inc', 'pass_fd',
    'pass_sack', 'pass_cmp_40p', 'pass_td_40p', 'pass_td_50p', 'bonus_pass_yd_300', 'bonus_pass_yd_400',
    # Receiving
    'rec', 'rec_tgt', 'rec_yd', 'rec_td', 'rec_2pt', 'rec_fd', 'rec_40p', 'rec_td_40p', 'rec_td_50p',
    'bonus_rec_te', 'bonus_rec_rb', 'bonus_rec_wr', 'bonus_rec_yd_100', 'bonus_rec_yd_200',
    # Rushing
    'rush_att', 'rush_yd', 'rush_td', 'rush_2pt', 'rush_fd', 'rush_40p', 'rush_td_40p', 'rush_td_50p',
    'bonus_rush_yd_100', 'bonus_rush_yd_200', 'bonus_rush_rec_yd_100', 'bonus_rush_rec_yd_200',
    'fum', 'fum_lost',
    # Kicking
    'xpm', 'xpmiss', 'fgm', 'fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50p', 'fgm_50_59', 'fgm_60p',
    'fgm_yds', 'fgm_yds_over_30', 'fgmiss', 'fgmiss_0_19', 'fgmiss_20_29', 'fgmiss_30_39', 'fgmiss_40_49',
    'fgmiss_50p', 'fgmiss_50_59',
    # Team defense and special teams (points allowed come from the score)
    'sack', 'int', 'fum_rec', 'ff', 'safe', 'blk_kick', 'def_td', 'tkl_loss', 'def_2pt', 'def_4_and_stop',
    'st_td', 'def_st_td', 'st_fum_rec', 'def_st_fum_rec', 'st_ff', 'def_st_ff', 'def_kr_yd', 'def_pr_yd',
]
K = {k: i for i, k in enumerate(COMPONENTS)}
BONUS = (('pass_yd', 'bonus_pass_yd_300', 300), ('pass_yd', 'bonus_pass_yd_400', 400),
         ('rec_yd', 'bonus_rec_yd_100', 100), ('rec_yd', 'bonus_rec_yd_200', 200),
         ('rush_yd', 'bonus_rush_yd_100', 100), ('rush_yd', 'bonus_rush_yd_200', 200),
         ('rush_rec_yd', 'bonus_rush_rec_yd_100', 100), ('rush_rec_yd', 'bonus_rush_rec_yd_200', 200))


def arch(season, name):
    return json.load(gzip.open(os.path.join(ARCHIVE, season, f'{name}.json.gz'), 'rt'))


def positions(season):
    """Sleeper ID -> position: the season's projection rows, then players.json (2022's before 2022)"""
    pos = {}
    pl = os.path.join(ARCHIVE, season, 'players.json.gz')
    for p, v in arch(season if os.path.exists(pl) else '2022', 'players').items():
        if v.get('position'): pos[p] = v['position']
    for w in range(1, 19):
        for r in arch(season, f'projections/{w}'):
            if (r.get('player') or {}).get('position'): pos[r['player_id']] = r['player']['position']
    return pos


def ids_for(season):
    """GSIS -> Sleeper: DynastyProcess's table, then unique name + position matches for the rest"""
    ids = BPT.crosswalk()
    known = set(ids.values())
    sleeper_ids = {r['player_id'] for w in range(1, 19) for r in arch(season, f'projections/{w}')
                   if (r.get('player') or {}).get('position') in ('QB', 'RB', 'WR', 'TE', 'K')}
    for gsis, sid in BPT.name_matches(sleeper_ids - known).items():
        ids.setdefault(gsis, sid)
    return ids


def epoch(t):
    if not isinstance(t, str) or not t: return None
    return int(datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp())


def num(x):
    return 0.0 if x is None or pd.isna(x) else float(x)


def team(x):
    return TEAM.get(x, x) if isinstance(x, str) else None


def fg_band(dist):
    return '0_19' if dist < 20 else '20_29' if dist < 30 else '30_39' if dist < 40 else '40_49' if dist < 50 else '50p'


def play_stats(p, sid, pos):
    """[(who, stat, amount)] from one play: who is a Sleeper player ID or a team code"""
    out = []
    add = lambda who, k, v=1.0: who and v and out.append((who, k, float(v)))
    passer, rusher, receiver, kicker = sid(p.passer_player_id), sid(p.rusher_player_id), sid(p.receiver_player_id), sid(p.kicker_player_id)
    td_player = sid(p.td_player_id)
    two = p.two_point_attempt == 1
    two_ok = two and p.two_point_conv_result == 'success'
    off, de = team(p.posteam), team(p.defteam)
    td_team = team(p.td_team)
    kind = p.play_type

    if kind in ('pass', 'run', 'qb_kneel', 'qb_spike') or two:
        if passer:
            if two:
                if two_ok and receiver: add(passer, 'pass_2pt')
            else:
                yds = num(p.passing_yards)
                add(passer, 'pass_yd', yds)
                if p.sack == 1: add(passer, 'pass_sack')
                elif p.pass_attempt == 1: add(passer, 'pass_att')
                if p.complete_pass == 1:
                    add(passer, 'pass_cmp')
                    if p.first_down_pass == 1: add(passer, 'pass_fd')
                    if yds >= 40: add(passer, 'pass_cmp_40p')
                if p.incomplete_pass == 1: add(passer, 'pass_inc')
                if p.pass_touchdown == 1:
                    add(passer, 'pass_td')
                    if yds >= 40: add(passer, 'pass_td_40p')
                    if yds >= 50: add(passer, 'pass_td_50p')
                if p.interception == 1:
                    add(passer, 'pass_int')
                    if td_team and td_team == de: add(passer, 'pass_int_td')
        if receiver:
            if two:
                if two_ok: add(receiver, 'rec_2pt')
            else:
                yds = num(p.receiving_yards)
                add(receiver, 'rec_tgt')
                if p.complete_pass == 1:
                    add(receiver, 'rec')
                    bonus = {'TE': 'bonus_rec_te', 'RB': 'bonus_rec_rb', 'WR': 'bonus_rec_wr'}.get(pos.get(receiver))
                    if bonus: add(receiver, bonus)
                    if p.first_down_pass == 1: add(receiver, 'rec_fd')
                    if yds >= 40: add(receiver, 'rec_40p')
                add(receiver, 'rec_yd', yds)
                if p.pass_touchdown == 1 and td_player == receiver:
                    add(receiver, 'rec_td')
                    if yds >= 40: add(receiver, 'rec_td_40p')
                    if yds >= 50: add(receiver, 'rec_td_50p')
        if rusher:
            if two:
                if two_ok and not receiver: add(rusher, 'rush_2pt')
            else:
                yds = num(p.rushing_yards)
                add(rusher, 'rush_att')
                add(rusher, 'rush_yd', yds)
                if p.first_down_rush == 1: add(rusher, 'rush_fd')
                if yds >= 40: add(rusher, 'rush_40p')
                if p.rush_touchdown == 1 and td_player == rusher:
                    add(rusher, 'rush_td')
                    if yds >= 40: add(rusher, 'rush_td_40p')
                    if yds >= 50: add(rusher, 'rush_td_50p')
    # Fumbles by offensive players (on any play)
    for f, ft in ((p.fumbled_1_player_id, p.fumbled_1_team), (p.fumbled_2_player_id, p.fumbled_2_team)):
        who = sid(f)
        if who:
            add(who, 'fum')
            rec_team = team(p.fumble_recovery_1_team)
            if p.fumble_lost == 1 and rec_team and rec_team != team(ft): add(who, 'fum_lost')
    if kicker:
        if p.field_goal_attempt == 1 and isinstance(p.field_goal_result, str):
            dist = num(p.kick_distance)
            if p.field_goal_result == 'made':
                add(kicker, 'fgm'); add(kicker, f'fgm_{fg_band(dist)}')
                if dist >= 50: add(kicker, 'fgm_60p' if dist >= 60 else 'fgm_50_59')
                add(kicker, 'fgm_yds', dist); add(kicker, 'fgm_yds_over_30', max(0.0, dist - 30))
            else:
                add(kicker, 'fgmiss'); add(kicker, f'fgmiss_{fg_band(dist)}')
                if 50 <= dist < 60: add(kicker, 'fgmiss_50_59')
        if isinstance(p.extra_point_result, str):
            add(kicker, 'xpm' if p.extra_point_result == 'good' else 'xpmiss')

    # Team defenses and special teams
    rec_team = team(p.fumble_recovery_1_team)
    if kind == 'kickoff':
        kicking, receiving = de, off
        add(receiving, 'def_kr_yd', num(p.return_yards))
        if p.fumble_lost == 1 and rec_team == kicking:
            add(kicking, 'st_fum_rec'); add(kicking, 'def_st_fum_rec')
            if p.fumble_forced == 1: add(kicking, 'st_ff'); add(kicking, 'def_st_ff')
        if td_team: add(td_team, 'st_td'); add(td_team, 'def_st_td')
    elif kind == 'punt':
        kicking, receiving = off, de
        add(receiving, 'def_pr_yd', num(p.return_yards))
        if p.punt_blocked == 1: add(receiving, 'blk_kick')
        if p.fumble_lost == 1 and rec_team == kicking:
            add(kicking, 'st_fum_rec'); add(kicking, 'def_st_fum_rec')
            if p.fumble_forced == 1: add(kicking, 'st_ff'); add(kicking, 'def_st_ff')
        if td_team: add(td_team, 'st_td'); add(td_team, 'def_st_td')
    elif de:
        if p.sack == 1: add(de, 'sack')
        if p.interception == 1: add(de, 'int')
        if p.fumble_lost == 1 and rec_team == de: add(de, 'fum_rec')
        if p.fumble_forced == 1 and team(p.forced_fumble_player_1_team) == de: add(de, 'ff')
        if p.safety == 1: add(de, 'safe')
        if p.tackled_for_loss == 1: add(de, 'tkl_loss')
        if p.fourth_down_failed == 1: add(de, 'def_4_and_stop')
        if p.defensive_two_point_conv == 1: add(de, 'def_2pt')
        blocked = (isinstance(p.field_goal_result, str) and p.field_goal_result == 'blocked') or p.extra_point_result == 'blocked'
        if blocked: add(de, 'blk_kick')
        if td_team == de:
            add(de, 'def_st_td' if kind in ('field_goal', 'extra_point') else 'def_td')
            if kind in ('field_goal', 'extra_point'): add(de, 'st_td')
    return out


INJURED = re.compile(r'([A-Z]{2,3})-\d{1,2}-([A-Z][A-Za-z.\' -]+?) was injured during the play')
NAME_COLS = (('passer_player_name', 'passer_player_id'), ('rusher_player_name', 'rusher_player_id'),
             ('receiver_player_name', 'receiver_player_id'), ('kicker_player_name', 'kicker_player_id'))


def injuries_by_week(pbp, sid):
    """week -> [(time, Sleeper ID)]: fantasy players the play text says were injured (penalized
    plays too), matched by team and short name to the players the season's plays name"""
    known = {}
    for name_col, id_col in NAME_COLS:
        sub = pbp[[name_col, id_col, 'posteam']].dropna().drop_duplicates()
        for n, g, tm in sub.itertuples(index=False):
            known[(team(tm), n)] = g
    out = defaultdict(list)
    hits = pbp[pbp.desc.str.contains('was injured during the play', na=False)]
    for p in hits.itertuples():
        t = epoch(p.time_of_day)
        if t is None: continue
        for tm, name in INJURED.findall(p.desc):
            who = sid(known.get((team(tm), name.strip())))
            if who: out[int(p.week)].append((t, who))
    return out


def season_components(season):
    pbp = pd.read_parquet(os.path.join(PBP, f'play_by_play_{season}.parquet'))
    pbp = pbp[pbp.season_type == 'REG']
    ids, pos = ids_for(season), positions(season)
    sid = lambda g: ids.get(g) if isinstance(g, str) else None
    injured = injuries_by_week(pbp, sid)
    pbp = pbp[pbp.play_type != 'no_play']
    weeks = {}
    for week, wk in pbp.groupby('week'):
        games, who_ix, ev = [], {}, []
        for game_id, g in wk.groupby('game_id', sort=False):
            g = g.sort_values('play_id', kind='stable')
            home, away = team(g.home_team.iloc[0]), team(g.away_team.iloc[0])
            snaps, situ, t_last = [], [], None
            yards = defaultdict(lambda: defaultdict(float))  # running yards per player, for bonuses
            for p in g.itertuples():
                t = epoch(p.time_of_day) or t_last
                if t is None: continue
                t_last = t
                snaps.append((t, int(num(p.qtr) or 1), int(num(p.quarter_seconds_remaining)), int(num(p.total_home_score)), int(num(p.total_away_score))))
                pt = team(p.posteam)
                situ.append((1.0 if pt == home else -1.0 if pt == away else 0.0, num(p.yardline_100), num(p.ep)))
                for who, k, v in play_stats(p, sid, pos):
                    i = who_ix.setdefault(who, len(who_ix))
                    ev.append((t, i, K[k], v))
                    if k in ('pass_yd', 'rec_yd', 'rush_yd'):
                        y = yards[who]
                        before = dict(y)
                        y[k] += v
                        if k != 'pass_yd': y['rush_rec_yd'] += v
                        for base, bk, line in BONUS:
                            was, now = before.get(base, 0.0) >= line, y[base] >= line
                            if was != now: ev.append((t, i, K[bk], 1.0 if now else -1.0))
            if snaps:
                # The situation going forward after each play: who has the ball, how far from the
                # goal line, and that possession's expected points (nflverse's ep), from the next play
                nxt = np.array(situ[1:] + [(0.0, 0.0, 0.0)], dtype=np.float32)
                games.append((home, away, np.array(snaps, dtype=np.int64), nxt))
        ev = np.array(ev, dtype=[('t', 'i8'), ('who', 'i4'), ('k', 'i2'), ('v', 'f4')])
        weeks[int(week)] = {'games': games, 'ids': list(who_ix), 'ev': ev, 'injured': injured.get(int(week), [])}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f'{season}.pkl'), 'wb') as f: pickle.dump(weeks, f)
    n = sum(len(w['ev']) for w in weeks.values())
    print(f'{season}: {len(weeks)} weeks, {n:,} stat events', flush=True)
    return season


def load(season):
    with open(os.path.join(OUT, f'{season}.pkl'), 'rb') as f: return pickle.load(f)


def check(season):
    """Each player's half-PPR points from these stats against Sleeper's weekly stats"""
    w8 = np.zeros(len(COMPONENTS))
    for k, v in {'pass_yd': 0.04, 'pass_td': 4, 'pass_int': -1, 'pass_2pt': 2, 'rec': 0.5, 'rec_yd': 0.1, 'rec_td': 6, 'rec_2pt': 2,
                 'rush_yd': 0.1, 'rush_td': 6, 'rush_2pt': 2, 'fum_lost': -2}.items(): w8[K[k]] = v
    weeks = load(season); diffs = []
    for w, d in weeks.items():
        tot = np.zeros(len(d['ids'])); np.add.at(tot, d['ev']['who'], d['ev']['v'] * w8[d['ev']['k']])
        stats = arch(season, f'stats/{w}')
        for i, who in enumerate(d['ids']):
            s = stats.get(who)
            if who.isalpha() or not s or not s.get('pts_half_ppr'): continue
            if pos_cache.get(who) not in ('QB', 'RB', 'WR', 'TE'): continue
            diffs.append(tot[i] - s['pts_half_ppr'])
    diffs = np.abs(np.array(diffs))
    print(f'{season}: {len(diffs):,} player-weeks, half-PPR within 0.1 in {np.mean(diffs < 0.1):.1%}, within 1 in {np.mean(diffs < 1):.1%}, '
          f'within 3 in {np.mean(diffs < 3):.1%}')


if __name__ == '__main__':
    seasons = [a for a in sys.argv[1:] if a.isdigit()] or SEASONS
    if '--check' not in sys.argv:
        BPT.player_lists()  # Download once before the workers start
        with Pool(min(8, len(seasons))) as pool: pool.map(season_components, seasons)
    for s in seasons:
        pos_cache = positions(s)
        check(s)
