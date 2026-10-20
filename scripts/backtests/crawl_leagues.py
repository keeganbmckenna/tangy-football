"""Collect other Sleeper leagues like ours, for fitting the model on far more than 48 team-seasons.

Snowball sample: start from this league's managers, list each manager's leagues for a season
(GET /user/{id}/leagues/nfl/{season}), keep the ones like ours, and add their managers to the
queue. Kept: finished redraft (not keeper, dynasty or best ball) leagues of 10-14 teams with
one QB slot and no superflex, half or full PPR, 4-point passing touchdowns, no divisions.
For each: the league object, rosters and every week's matchups (lineups and points). Managers
are followed through every league seen, kept or not, so the sample keeps growing.

Sleeper's API is public and read-only; its docs ask for under 1,000 calls a minute, and this
stays near 700. Saved to cache/leagues/{season}/{league_id}.json.gz (not committed: other
people's leagues; analyses use aggregates only).

    python crawl_leagues.py [--per-season 300] [--seasons 2022 2023 2024 2025] [--seed USER_ID ...]

Seeded first from dezdroppedit27 (869000996184055808), whose leagues are full of serious
players, then our other managers. For seasons before ours (Sleeper's projections start in
2018), --seed-from-cache starts from every manager already collected, and each season first
walks back the league histories (previous_league_id) of the leagues collected a season later.
"""
import argparse, glob, gzip, json, os, queue, threading, time, urllib.request
from collections import deque

API = 'https://api.sleeper.app/v1'
OURS = '1323741311471194112'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache', 'leagues')
CALLS_PER_MIN = 700


class Limiter:
    def __init__(self, per_min):
        self.gap = 60.0 / per_min; self.lock = threading.Lock(); self.next = time.time()

    def wait(self):
        with self.lock:
            now = time.time(); t = max(now, self.next); self.next = t + self.gap
        time.sleep(max(0, t - now))


LIMIT = Limiter(CALLS_PER_MIN)


def get(url):
    for attempt in range(6):
        LIMIT.wait()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'tangy-football-research'}), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            time.sleep(min(60, 5 * 2 ** attempt))
        except Exception:
            time.sleep(min(60, 2 ** attempt))
    return None


def like_ours(l):
    s, sc, rp = l.get('settings') or {}, l.get('scoring_settings') or {}, l.get('roster_positions') or []
    return (l.get('status') == 'complete' and s.get('type', 0) == 0 and not s.get('best_ball')
            and 10 <= (l.get('total_rosters') or 0) <= 14 and rp.count('QB') == 1 and 'SUPER_FLEX' not in rp
            and sc.get('rec') in (0.5, 1.0) and sc.get('pass_td') == 4 and not s.get('divisions')
            and s.get('playoff_teams') in (4, 6) and l.get('league_id') != OURS)


def save_league(season, l):
    path = os.path.join(OUT, season, f"{l['league_id']}.json.gz")
    if os.path.exists(path): return []
    lid = l['league_id']; end = min((l['settings'].get('playoff_week_start') or 15) + 2, 18)
    rosters = get(f'{API}/league/{lid}/rosters')
    if not rosters: return None
    matchups = {}
    for w in range(1, end + 1):
        m = get(f'{API}/league/{lid}/matchups/{w}')
        if m is None: return None
        matchups[w] = [{k: x.get(k) for k in ('roster_id', 'matchup_id', 'points', 'starters', 'players', 'players_points')} for x in m]
    # A league that wasn't played (no points in week 1) is no use
    if not any((x.get('points') or 0) > 0 for x in matchups.get(1, [])): return None
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, 'wt') as f:
        json.dump({'league': l, 'rosters': rosters, 'matchups': matchups}, f, separators=(',', ':'))
    return rosters


def cached_managers():
    """Every manager in leagues already collected (any season), to seed older seasons"""
    out = []
    for f in glob.glob(os.path.join(OUT, '*', '*.json.gz')):
        try:
            out += [r.get('owner_id') for r in json.load(gzip.open(f, 'rt')).get('rosters') or [] if r.get('owner_id')]
        except Exception:
            pass
    return list(dict.fromkeys(out))


def predecessors(season):
    """The previous season of every league collected for the next season (league histories)"""
    out = []
    for f in glob.glob(os.path.join(OUT, str(int(season) + 1), '*.json.gz')):
        try:
            prev = json.load(gzip.open(f, 'rt'))['league'].get('previous_league_id')
        except Exception:
            continue
        if prev and prev != '0': out.append(prev)
    return out


def crawl(season, cap, seeds):
    have = {f[:-8] for f in os.listdir(os.path.join(OUT, season))} if os.path.isdir(os.path.join(OUT, season)) else set()
    users, seen_users, seen_leagues = deque(seeds), set(seeds), set(have)
    kept = len(have); looked = 0
    lock = threading.Lock(); work = queue.Queue()

    def worker():
        nonlocal kept
        while True:
            l = work.get()
            if l is None: return
            try:
                with lock:
                    if kept >= cap: continue
                rosters = save_league(season, l)
                if rosters is not None:
                    with lock: kept += 1
                    for r in rosters or (get(f"{API}/league/{l['league_id']}/rosters") or []):
                        o = r.get('owner_id')
                        with lock:
                            if o and o not in seen_users: seen_users.add(o); users.append(o)
            finally:
                work.task_done()
    threads = [threading.Thread(target=worker, daemon=True) for _ in range(6)]
    for t in threads: t.start()
    def expand(lid):
        """Queue a league's managers (any league, kept or not, so the sample keeps growing)"""
        for r in get(f'{API}/league/{lid}/rosters') or []:
            o = r.get('owner_id')
            with lock:
                if o and o not in seen_users: seen_users.add(o); users.append(o)

    # Walk league histories back first: last season's league of every league collected a season later
    for lid in predecessors(season):
        if kept >= cap: break
        if lid in seen_leagues: continue
        seen_leagues.add(lid)
        l = get(f'{API}/league/{lid}')
        if l and l.get('season') == season and like_ours(l): work.put(l)
        elif l and len(users) < 500: expand(lid)
    work.join()
    while users and kept < cap:
        uid = users.popleft()
        for l in get(f'{API}/user/{uid}/leagues/nfl/{season}') or []:
            looked += 1
            if l['league_id'] in seen_leagues: continue
            seen_leagues.add(l['league_id'])
            if like_ours(l): work.put(l)
            # Only widen the net while the queue of managers is short
            elif len(users) < 500: expand(l['league_id'])
        if work.qsize() > 30: work.join()
    work.join()
    for _ in threads: work.put(None)
    print(f'{season}: kept {kept} leagues (looked at {looked}, {len(seen_users)} managers reached)', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--per-season', type=int, default=300)
    ap.add_argument('--seasons', nargs='*', default=['2025', '2024', '2023', '2022'])
    ap.add_argument('--seed', nargs='*', default=[], help='user IDs to start from (before our league\'s managers)')
    ap.add_argument('--seed-from-cache', action='store_true', help='also start from every manager in leagues already collected (for older seasons)')
    args = ap.parse_args()
    seeds = list(args.seed)
    for season in ('2022', '2023', '2024', '2025', '2026'):
        path = os.path.join(os.path.dirname(OUT), '..', '..', '..', 'data', 'sleeper', season, 'users.json.gz')
        if os.path.exists(path):
            seeds += [u['user_id'] for u in json.load(gzip.open(path, 'rt'))]
    seeds = list(dict.fromkeys(seeds)) or [u['user_id'] for u in get(f'{API}/league/{OURS}/users')]
    if args.seed_from_cache:
        seeds = list(dict.fromkeys(seeds + cached_managers()))
        print(f'{len(seeds)} seed managers', flush=True)
    for season in args.seasons:
        crawl(season, args.per_season, seeds)


if __name__ == '__main__':
    main()
