"""Archive completed seasons' Sleeper data into the repo, gzipped, so it never has to be
fetched again and can't change or disappear upstream.

A finished season is static: Sleeper's stat corrections run for a few days after each week's
games (through the following Thursday), so by the offseason every week is final. Each
completed season in the league's history goes to data/sleeper/{season}/:

  league, users, rosters, winners_bracket, losers_bracket, draft, draft_picks, schedule (NFL)
  matchups/{week}, transactions/{week}               weeks 1-18
  projections/{week}, stats/{week}                   NFL regular-season weeks 1-18, all players
  players                                            Sleeper's player database when archived

plus a manifest with when it was archived. Seasons already archived are skipped unless
--force. With --nfl-only, only the NFL projections, stats and schedule (seasons before our
league, 2018-2021, used by the other-league backtests; Sleeper's projections start in 2018). Run by .github/workflows/archive-seasons.yml each offseason, or by hand:

    python scripts/archive_season.py [season ...] [--force]

Caveats: projections are what Sleeper's archive holds (made before each week's games), but
the injury statuses inside them are as of when they're fetched, not as of the game.
"""
import argparse
import datetime as dt
import gzip
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'sleeper')
API = 'https://api.sleeper.app/v1'
LEAGUE_ID = os.environ.get('LEAGUE_ID', '1323741311471194112')
WEEKS = range(1, 19)
POSITIONS = '&'.join(f'position%5B%5D={p}' for p in ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])


def get(url):
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'curl/8'})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception:
            if attempt == 5:
                raise
            time.sleep(2 ** attempt)


def save(folder, name, data):
    path = os.path.join(folder, f'{name}.json.gz')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # mtime=0: the same data always gives the same bytes, so re-archiving doesn't churn git
    with open(path, 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as f:
        f.write(json.dumps(data, separators=(',', ':'), sort_keys=True).encode())


def history():
    """Every season of the league, newest first: (league object)"""
    out, lid = [], LEAGUE_ID
    while lid and lid != '0':
        league = get(f'{API}/league/{lid}')
        out.append(league)
        lid = league.get('previous_league_id')
    return out


def archive(league, players):
    season, lid = league['season'], league['league_id']
    folder = os.path.join(OUT, season)
    print(f'{season}: archiving league {lid}', flush=True)
    save(folder, 'league', league)
    for name in ('users', 'rosters', 'winners_bracket', 'losers_bracket'):
        save(folder, name, get(f'{API}/league/{lid}/{name}'))
    if league.get('draft_id'):
        save(folder, 'draft', get(f'{API}/draft/{league["draft_id"]}'))
        save(folder, 'draft_picks', get(f'{API}/draft/{league["draft_id"]}/picks'))
    save(folder, 'schedule', get(f'https://api.sleeper.com/schedule/nfl/regular/{season}'))
    for w in WEEKS:
        save(folder, f'matchups/{w}', get(f'{API}/league/{lid}/matchups/{w}'))
        save(folder, f'transactions/{w}', get(f'{API}/league/{lid}/transactions/{w}'))
        save(folder, f'projections/{w}', get(f'https://api.sleeper.com/projections/nfl/{season}/{w}?season_type=regular&{POSITIONS}'))
        save(folder, f'stats/{w}', get(f'{API}/stats/nfl/regular/{season}/{w}'))
    save(folder, 'players', players)
    save(folder, 'manifest', {'season': season, 'leagueId': lid, 'archivedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
                              'weeks': list(WEEKS), 'source': 'scripts/archive_season.py'})


def archive_nfl(season):
    """Only the NFL side of a season (projections, stats, schedule): for seasons before our league,
    which the other-league backtests need"""
    folder = os.path.join(OUT, season)
    print(f'{season}: archiving NFL data', flush=True)
    save(folder, 'schedule', get(f'https://api.sleeper.com/schedule/nfl/regular/{season}'))
    for w in WEEKS:
        save(folder, f'projections/{w}', get(f'https://api.sleeper.com/projections/nfl/{season}/{w}?season_type=regular&{POSITIONS}'))
        save(folder, f'stats/{w}', get(f'{API}/stats/nfl/regular/{season}/{w}'))
    save(folder, 'manifest', {'season': season, 'nflOnly': True, 'archivedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
                              'weeks': list(WEEKS), 'source': 'scripts/archive_season.py --nfl-only'})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('seasons', nargs='*')
    parser.add_argument('--force', action='store_true', help='re-archive seasons already archived')
    parser.add_argument('--nfl-only', action='store_true', help='archive only NFL projections, stats and schedule for the given seasons')
    args = parser.parse_args()
    if args.nfl_only:
        for season in args.seasons:
            if os.path.exists(os.path.join(OUT, season, 'manifest.json.gz')) and not args.force:
                print(f'{season}: already archived'); continue
            archive_nfl(season)
        return
    leagues = history()
    done = []
    players = None
    for league in leagues:
        season = league['season']
        if args.seasons and season not in args.seasons:
            continue
        if league.get('status') != 'complete':
            print(f'{season}: not complete ({league.get("status")}), skipped')
            continue
        if os.path.exists(os.path.join(OUT, season, 'manifest.json.gz')) and not args.force:
            print(f'{season}: already archived')
            continue
        players = players or get(f'{API}/players/nfl')
        archive(league, players)
        done.append(season)
    print(f'archived: {", ".join(done) or "nothing new"}')


if __name__ == '__main__':
    sys.exit(main())
