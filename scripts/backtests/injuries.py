"""Injury statuses against what happened, 2022-2025, from the NFL's official injury reports.

Sleeper's archive overwrites injury statuses, so the model's injury rules couldn't be tested.
nflverse publishes every team's weekly injury report (final game status, practice
participation). Matched to Sleeper players by GSIS ID and to Sleeper's weekly stats and
pre-game projections (data/sleeper archive), for QB/RB/WR/TE/K, regular season. IDs are
matched through DynastyProcess's GSIS-to-Sleeper table, then Sleeper's own GSIS IDs, then a
unique name and position:

  1. how often players with each final status played, and what share of their pre-game
     projection they scored (the Live tab counts Out as 0, Doubtful as 30% of the projection
     before kickoff, Questionable in full)
  2. players who played last week and are on this week's report, the closest stand-in for
     "hurt in his last game" (the model now gives them 76% for the next game)
  3. players out (didn't play) N games in a row: how often they played the next one, against
     the model's return rates (76%, 40%, 38%, 48%)

Downloads nflverse's injuries_{season}.csv into cache/nflverse/.
"""
import csv, gzip, json, os, re, statistics as st, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE = os.path.join(HERE, '..', '..', 'data', 'sleeper')
CACHE = os.path.join(HERE, 'cache', 'nflverse')
SEASONS = ['2022', '2023', '2024', '2025']
POSITIONS = {'QB', 'RB', 'WR', 'TE', 'K'}
LIVE_SHARE = {'Out': 0.0, 'Doubtful': 0.3, 'Questionable': 1.0}
RETURN_RATE = [0.76, 0.4, 0.38, 0.48]


def arch(season, name):
    return json.load(gzip.open(os.path.join(ARCHIVE, season, f'{name}.json.gz'), 'rt'))


def reports(season):
    path = os.path.join(CACHE, f'injuries_{season}.csv')
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        url = f'https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv'
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'curl/8'}), timeout=120) as r:
            open(path, 'wb').write(r.read())
    return list(csv.DictReader(open(path)))


def norm(name):
    return re.sub(r'[^a-z]', '', re.sub(r'\b(jr|sr|ii|iii|iv)\b\.?', '', name.lower()))


def crosswalk():
    """GSIS ID -> Sleeper ID from DynastyProcess's player ID table (what nflreadr's ff_playerids uses)"""
    path = os.path.join(CACHE, 'db_playerids.csv')
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        url = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'curl/8'}), timeout=120) as r:
            open(path, 'wb').write(r.read())
    return {r['gsis_id']: r['sleeper_id'] for r in csv.DictReader(open(path)) if r.get('gsis_id') not in (None, '', 'NA') and r.get('sleeper_id') not in (None, '', 'NA')}


CROSSWALK = crosswalk()
matched, unmatched = defaultdict(int), defaultdict(int)


def ci(xs):
    """Mean and 95% interval (normal approximation) of a 0/1 or numeric list"""
    m = st.mean(xs); se = st.pstdev(xs) / max(len(xs), 1) ** 0.5
    return m, m - 1.96 * se, m + 1.96 * se


def main():
    status_play = defaultdict(list); status_share = defaultdict(list)
    hurt_play = defaultdict(list)
    streak_play = defaultdict(list)
    for season in SEASONS:
        players = arch(season, 'players')
        by_gsis = {p['gsis_id'].strip(): pid for pid, p in players.items() if p.get('gsis_id')}
        by_gsis.update(CROSSWALK)
        # Last resort: name and position, when it's unique
        names = defaultdict(list)
        for pid, p in players.items():
            if p.get('full_name') and p.get('position') in POSITIONS: names[(norm(p['full_name']), p['position'])].append(pid)
        end = 18
        stats = {w: arch(season, f'stats/{w}') for w in range(1, end + 1)}
        proj = {w: {r['player_id']: (r.get('stats') or {}).get('pts_half_ppr') or 0 for r in arch(season, f'projections/{w}')} for w in range(1, end + 1)}
        team_of = {w: {r['player_id']: r.get('team') for r in arch(season, f'projections/{w}')} for w in range(1, end + 1)}
        sched = arch(season, 'schedule')
        playing = defaultdict(set)
        for g in sched:
            playing[g['week']].update((g['home'], g['away']))
        played = lambda pid, w: bool((stats[w].get(pid) or {}).get('gp'))
        rep = defaultdict(dict)  # week -> sleeper id -> final report status ('' if listed without one)
        for r in reports(season):
            if r['game_type'] != 'REG' or r['position'] not in POSITIONS: continue
            pid = by_gsis.get(r['gsis_id'].strip())
            if not pid:
                cands = names.get((norm(r['full_name']), r['position']), [])
                pid = cands[0] if len(cands) == 1 else None
            if not pid:
                unmatched[season] += 1; continue
            matched[season] += 1
            rep[int(r['week'])][pid] = r['report_status'] or ''
        for w in range(1, end + 1):
            for pid, status in rep[w].items():
                team = team_of[w].get(pid) or (players.get(pid) or {}).get('team')
                if team not in playing[w]: continue
                p, y = proj[w].get(pid, 0), played(pid, w)
                status_play[status or 'listed, no status'].append(float(y))
                # Share of the projection scored, among players Sleeper projected for something
                if p >= 3:
                    pts = (stats[w].get(pid) or {}).get('pts_half_ppr') or 0
                    status_share[status or 'listed, no status'].append(pts / p)
                # 2. played last week and listed this week
                if w > 1 and played(pid, w - 1) and status in ('Out', 'Doubtful', 'Questionable', ''):
                    hurt_play[status or 'listed, no status'].append(float(y))
            # Baseline: projected players not on the report
            for pid, p in proj[w].items():
                if pid in rep[w] or p < 3 or (team_of[w].get(pid) not in playing[w]): continue
                pos = (players.get(pid) or {}).get('position')
                if pos not in POSITIONS: continue
                status_play['not on the report'].append(float(played(pid, w)))
                status_share['not on the report'].append(((stats[w].get(pid) or {}).get('pts_half_ppr') or 0) / p)
        # 3. games missed in a row, among players who'd been playing (projected 5+ when they last played)
        for pid in {p for w in range(1, end + 1) for p, v in proj[w].items() if v >= 5}:
            team = (players.get(pid) or {}).get('team')
            streak, active = 0, False
            for w in range(1, end + 1):
                t = team_of[w].get(pid) or team
                if t not in playing[w]: continue
                y = played(pid, w)
                if active and streak > 0:
                    streak_play[min(streak, 4)].append(float(y))
                if y: streak, active = 0, True
                elif active: streak += 1
        print(season, f'done: matched {matched[season]} report rows, unmatched {unmatched[season]}', flush=True)

    print('\n1. Final report status: played, and share of pre-game projection scored')
    print(f"   {'status':20} {'n':>6}  {'played':>18}  {'scored/projected':>22}  model share")
    for s in ('Out', 'Doubtful', 'Questionable', 'listed, no status', 'not on the report'):
        a = status_play.get(s) or [0]; b = status_share.get(s) or [0]
        m, lo, hi = ci(a); m2, lo2, hi2 = ci(b)
        print(f"   {s:20} {len(status_play.get(s, [])):6d}  {m:5.1%} ({lo:4.0%}-{hi:4.0%})  {m2:5.2f} ({lo2:.2f}-{hi2:.2f}) n={len(b):5d}  {LIVE_SHARE.get(s, 1.0):.2f}")
    print('\n2. Played last week, on this week\'s report: did he play?')
    allh = [x for v in hurt_play.values() for x in v]
    for s, v in sorted(hurt_play.items()):
        m, lo, hi = ci(v); print(f"   {s:20} n={len(v):5d}  played {m:.1%} ({lo:.0%}-{hi:.0%})")
    m, lo, hi = ci(allh); print(f"   any status           n={len(allh):5d}  played {m:.1%} ({lo:.0%}-{hi:.0%})   (model, for one ruled out after playing: 76%)")
    print('\n3. Missed N games in a row (after playing): played the next one?')
    for k in sorted(streak_play):
        m, lo, hi = ci(streak_play[k]); print(f"   {k}{'+' if k == 4 else ' '} n={len(streak_play[k]):5d}  played {m:.1%} ({lo:.0%}-{hi:.0%})   model {RETURN_RATE[k - 1]:.0%}")


if __name__ == '__main__':
    main()
