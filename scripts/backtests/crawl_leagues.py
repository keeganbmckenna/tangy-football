"""Collect other Sleeper leagues like ours, for fitting the model on far more than 48 team-seasons.

Snowball sample: start from this league's managers, list each manager's leagues for a season
(GET /user/{id}/leagues/nfl/{season}), keep the ones like ours, and add their managers to the
queue. Kept: finished redraft (not keeper, dynasty or best ball) leagues of 10-14 teams with
one QB slot and no superflex, half or full PPR, 4-point passing touchdowns, no divisions.
For each: the league object, rosters and every week's matchups (lineups and points). Managers
are followed through every league seen, kept or not, so the sample keeps growing.

Sleeper's API is public and read-only; its docs ask for under 1,000 calls a minute, and this
stays near 700 by default (--calls-per-min). Saved to cache/leagues/{season}/{league_id}.json.gz (not committed: other
people's leagues; analyses use aggregates only).

    python crawl_leagues.py [--per-season 300] [--calls-per-min 700] [--seasons 2022 2023 2024 2025] [--seed USER_ID ...]

--divisions collects leagues in our exact format instead: 12 teams in exactly 3 divisions, 6
playoff teams (otherwise the same filter), saved to cache/leagues_div/{season}/ in the same
format (each roster's division is in rosters[].settings.division). --check-divisions then
reports, per season, how many of their schedules are ours exactly (14 weeks, division rivals
twice, everyone else once).

--transactions saves every week's transactions (weeks 1-18: waivers, free agents, trades, FAAB)
of every league in cache/leagues and cache/leagues_div to cache/transactions/{season}/.
--histories follows previous_league_id back from every cached league (to 2017, Sleeper's
first season) and saves each earlier season, like ours or not, to cache/history/{season}/ in
the same format, so managers can be linked across seasons. --summary counts the files per
season and checks every one reads back. All of these skip files that exist, so an interrupted
run resumes; files are written to a temporary name and renamed, so none is left half-written.

    python crawl_leagues.py --divisions --seed-from-cache --per-season 1000 --seasons 2025 ... 2018 --calls-per-min 900
    python crawl_leagues.py --check-divisions
    python crawl_leagues.py --transactions --calls-per-min 900
    python crawl_leagues.py --histories --calls-per-min 900
    python crawl_leagues.py --summary

Seeded first from dezdroppedit27 (869000996184055808), whose leagues are full of serious
players, then our other managers. For seasons before ours (Sleeper's projections start in
2018), --seed-from-cache starts from every manager already collected, and each season first
walks back the league histories (previous_league_id) of the leagues collected a season later.
"""
import argparse, glob, gzip, json, os, queue, threading, time, urllib.request
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor
import leagues_fit

API = 'https://api.sleeper.app/v1'
# Every season of our league (2026, and the archive's earlier seasons): never saved, so checks on it stay out of sample
OURS = {'1323741311471194112'} | leagues_fit.OURS
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache')
OUT = os.path.join(CACHE, 'leagues')
DIV = os.path.join(CACHE, 'leagues_div')
TRANSACTIONS = os.path.join(CACHE, 'transactions')
HISTORY = os.path.join(CACHE, 'history')
DIVISIONS = False  # --divisions: keep leagues in our exact format (12 teams, 3 divisions, 6 playoff teams)
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
    if DIVISIONS:
        size = l.get('total_rosters') == 12 and s.get('divisions') == 3 and s.get('playoff_teams') == 6
    else:
        size = 10 <= (l.get('total_rosters') or 0) <= 14 and not s.get('divisions') and s.get('playoff_teams') in (4, 6)
    return (l.get('status') == 'complete' and s.get('type', 0) == 0 and not s.get('best_ball') and size
            and rp.count('QB') == 1 and 'SUPER_FLEX' not in rp
            and sc.get('rec') in (0.5, 1.0) and sc.get('pass_td') == 4 and l.get('league_id') not in OURS)


def write_gz(path, obj):
    """Write to a temporary name and rename, so an interrupted crawl never leaves a broken file"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path + '.tmp', 'wt') as f:
        json.dump(obj, f, separators=(',', ':'))
    os.replace(path + '.tmp', path)


def fetch_league(l):
    """Rosters and every week's matchups through playoff week 3, or None if a call failed"""
    lid = l['league_id']; end = min(((l.get('settings') or {}).get('playoff_week_start') or 15) + 2, 18)
    rosters = get(f'{API}/league/{lid}/rosters')
    if rosters is None: return None
    matchups = {}
    for w in range(1, end + 1):
        m = get(f'{API}/league/{lid}/matchups/{w}')
        if m is None: return None
        matchups[w] = [{k: x.get(k) for k in ('roster_id', 'matchup_id', 'points', 'starters', 'players', 'players_points')} for x in m]
    return rosters, matchups


def save_league(season, l):
    path = os.path.join(OUT, season, f"{l['league_id']}.json.gz")
    if os.path.exists(path): return []
    got = fetch_league(l)
    if not got or not got[0]: return None
    rosters, matchups = got
    # A league that wasn't played (no points in week 1) is no use
    if not any((x.get('points') or 0) > 0 for x in matchups.get(1, [])): return None
    write_gz(path, {'league': l, 'rosters': rosters, 'matchups': matchups})
    return rosters


def cached_managers():
    """Every manager in leagues already collected (any season), to seed older seasons"""
    out = []
    for f in glob.glob(os.path.join(CACHE, 'leagues', '*', '*.json.gz')) + glob.glob(os.path.join(DIV, '*', '*.json.gz')):
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
    have = {f[:-8] for f in os.listdir(os.path.join(OUT, season)) if f.endswith('.json.gz')} if os.path.isdir(os.path.join(OUT, season)) else set()
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
    # Managers' league lists are fetched 8 at a time (the limiter still caps the rate)
    pool = ThreadPoolExecutor(8)
    while users and kept < cap:
        batch = [users.popleft() for _ in range(min(40, len(users)))]
        for ls in pool.map(lambda uid: get(f'{API}/user/{uid}/leagues/nfl/{season}') or [], batch):
            for l in ls:
                looked += 1
                if l['league_id'] in seen_leagues: continue
                seen_leagues.add(l['league_id'])
                if like_ours(l): work.put(l)
                # Only widen the net while the queue of managers is short
                elif len(users) < 500: expand(l['league_id'])
        if work.qsize() > 30: work.join()
    work.join()
    pool.shutdown()
    for _ in threads: work.put(None)
    print(f'{season}: kept {kept} leagues (looked at {looked}, {len(seen_users)} managers reached)', flush=True)


def league_files(*dirs):
    return sorted(f for d in dirs for f in glob.glob(os.path.join(d, '*', '*.json.gz')))


def crawl_transactions():
    """Weeks 1-18 of transactions for every cached league"""
    todo = [f for f in league_files(OUT, DIV) if os.path.basename(f)[:-8] not in OURS
            and not os.path.exists(os.path.join(TRANSACTIONS, os.path.basename(os.path.dirname(f)), os.path.basename(f)))]
    print(f'transactions: {len(todo)} leagues to fetch', flush=True)
    done = Counter()

    def one(f):
        season, name = os.path.basename(os.path.dirname(f)), os.path.basename(f)
        lid = name[:-8]; weeks = {}
        for w in range(1, 19):
            t = get(f'{API}/league/{lid}/transactions/{w}')
            if t is None: return  # failed (retried); left for the next run
            weeks[w] = t
        write_gz(os.path.join(TRANSACTIONS, season, name), weeks)
        done[season] += 1
        if sum(done.values()) % 250 == 0: print(f'  {sum(done.values())} done', flush=True)
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(one, todo))
    print(f'transactions: saved {dict(sorted(done.items()))}', flush=True)


def crawl_histories():
    """Follow previous_league_id back from every cached league; save each earlier season to cache/history"""
    cached = {os.path.basename(f)[:-8]: f for f in league_files(OUT, DIV, HISTORY)}
    starts = []
    for f in league_files(OUT, DIV):
        if os.path.basename(f)[:-8] in OURS: continue
        try:
            prev = json.load(gzip.open(f, 'rt'))['league'].get('previous_league_id')
        except Exception:
            continue
        if prev and prev != '0': starts.append(prev)
    print(f'histories: {len(starts)} leagues with a previous season', flush=True)
    seen, lock, saved = set(), threading.Lock(), Counter()

    def chain(lid):
        while lid and lid != '0' and lid not in OURS:
            with lock:
                if lid in seen: return
                seen.add(lid)
            if lid in cached:  # already have it (collected, or an earlier run): keep walking from the file
                try:
                    lid = json.load(gzip.open(cached[lid], 'rt'))['league'].get('previous_league_id')
                except Exception:
                    return
                continue
            l = get(f'{API}/league/{lid}')
            if not l or int(l.get('season') or 0) < 2017: return
            got = fetch_league(l)
            if got is None: return
            write_gz(os.path.join(HISTORY, l['season'], f'{lid}.json.gz'), {'league': l, 'rosters': got[0], 'matchups': got[1]})
            with lock:
                saved[l['season']] += 1
                if sum(saved.values()) % 250 == 0: print(f'  {sum(saved.values())} saved', flush=True)
            lid = l.get('previous_league_id')
    with ThreadPoolExecutor(6) as pool:
        list(pool.map(chain, starts))
    print(f'histories: saved {dict(sorted(saved.items()))}', flush=True)


def check_divisions():
    """Per season: division leagues kept, and how many schedules are ours exactly"""
    for season in sorted(os.listdir(DIV)) if os.path.isdir(DIV) else []:
        c = Counter()
        for f in league_files(DIV):
            if os.path.basename(os.path.dirname(f)) != season: continue
            d = json.load(gzip.open(f, 'rt'))
            start = d['league']['settings'].get('playoff_week_start') or 15
            div = {r['roster_id']: (r.get('settings') or {}).get('division') for r in d['rosters']}
            games = Counter()
            for w in range(1, start):
                pairs = {}
                for x in d['matchups'].get(str(w), []):
                    if x.get('matchup_id'): pairs.setdefault(x['matchup_id'], []).append(x['roster_id'])
                for p in pairs.values():
                    if len(p) == 2: games[frozenset(p)] += 1
            exact = start == 15 and len(set(div.values())) == 3 and all(
                games[frozenset((a, b))] == (2 if div[a] == div[b] else 1) for a in div for b in div if a < b)
            if exact: c['exact'] += 1
            elif start == 15: c['other 14-week'] += 1
            else: c[f'{start - 1}-week'] += 1
        print(f'{season}: {sum(c.values())} division leagues; {c["exact"]} play our schedule exactly'
              f' (rivals twice, others once, 14 weeks); other: {dict((k, v) for k, v in c.items() if k != "exact")}', flush=True)


def summary():
    """Files per season in each cache folder, each read back in full"""
    for d in (OUT, DIV, TRANSACTIONS, HISTORY):
        counts, bad = Counter(), []
        for f in league_files(d):
            try:
                with gzip.open(f, 'rb') as g:
                    while g.read(1 << 20): pass
                counts[os.path.basename(os.path.dirname(f))] += 1
            except Exception:
                bad.append(f)
        print(f'{os.path.basename(d)}: {sum(counts.values())} files {dict(sorted(counts.items()))}'
              + (f', {len(bad)} unreadable: {bad[:5]}' if bad else ', all read back'), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--per-season', type=int, default=300)
    ap.add_argument('--calls-per-min', type=int, default=CALLS_PER_MIN, help='Sleeper asks for under 1,000')
    ap.add_argument('--seasons', nargs='*', default=['2025', '2024', '2023', '2022'])
    ap.add_argument('--seed', nargs='*', default=[], help='user IDs to start from (before our league\'s managers)')
    ap.add_argument('--seed-from-cache', action='store_true', help='also start from every manager in leagues already collected (for older seasons)')
    ap.add_argument('--divisions', action='store_true', help='leagues in our exact format (12 teams, 3 divisions, 6 playoff teams) -> cache/leagues_div')
    ap.add_argument('--check-divisions', action='store_true', help='per season: division leagues and how many play our schedule exactly')
    ap.add_argument('--transactions', action='store_true', help='weeks 1-18 of transactions for every cached league -> cache/transactions')
    ap.add_argument('--histories', action='store_true', help='earlier seasons of every cached league (previous_league_id) -> cache/history')
    ap.add_argument('--summary', action='store_true', help='files per season in each cache folder, each read back')
    args = ap.parse_args()
    LIMIT.gap = 60.0 / min(args.calls_per_min, 999)
    if args.check_divisions: return check_divisions()
    if args.summary: return summary()
    if args.transactions: return crawl_transactions()
    if args.histories: return crawl_histories()
    if args.divisions:
        global DIVISIONS, OUT
        DIVISIONS, OUT = True, DIV
    seeds = list(args.seed)
    for season in ('2022', '2023', '2024', '2025', '2026'):
        path = os.path.join(os.path.dirname(OUT), '..', '..', '..', 'data', 'sleeper', season, 'users.json.gz')
        if os.path.exists(path):
            seeds += [u['user_id'] for u in json.load(gzip.open(path, 'rt'))]
    seeds = list(dict.fromkeys(seeds)) or [u['user_id'] for u in get(f'{API}/league/1323741311471194112/users')]
    if args.seed_from_cache:
        seeds = list(dict.fromkeys(seeds + cached_managers()))
        print(f'{len(seeds)} seed managers', flush=True)
    for season in args.seasons:
        crawl(season, args.per_season, seeds)


if __name__ == '__main__':
    main()
