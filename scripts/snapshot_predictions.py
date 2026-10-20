"""Save the site's live predictions, for scoring the 2026 season out of sample.

Run on a schedule by .github/workflows/prediction-log.yml, which commits the files to the
prediction-log branch. Each run saves, gzipped, from the deployed site:

  playoff-odds   every team's playoff, bye, title and toilet-bowl odds
  trade-data     each team's expected score per remaining week and the spread (enough to
                 recompute any game's win odds), and every rostered player's injury status
                 and weekly values (Sleeper overwrites injury statuses, so they can't be
                 recovered later)
  live           the Live tab's inputs: matchups, projections, NFL game clocks
  projections    (before kickoffs only) Sleeper's projections for every player, with each
                 one's injury status at that moment, which Sleeper's archive overwrites

to predictions/{season}/w{week}-{label}-{UTC time}.json.gz, where label says when it was
taken: after-scoring (Wednesday), pre-thursday, pre-sunday or pre-monday (just before
those kickoffs). See scripts/backtests/PREREGISTRATION_2026.md for how they're scored.
"""
import datetime as dt
import gzip
import json
import os
import sys
import urllib.request

SITE = os.environ.get('SITE_URL', 'https://tangy-football.vercel.app')
OUT = os.environ.get('OUT_DIR', 'predictions')
LABELS = {2: 'after-scoring', 3: 'pre-thursday', 6: 'pre-sunday', 0: 'pre-monday'}  # Python weekday -> label


def fetch(path):
    req = urllib.request.Request(f'{SITE}{path}', headers={'User-Agent': 'tangy-football-prediction-log'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def main():
    now = dt.datetime.now(dt.timezone.utc)
    label = sys.argv[1] if len(sys.argv) > 1 else LABELS.get(now.weekday(), 'manual')
    snapshot = {'takenAt': now.isoformat(timespec='seconds'), 'label': label, 'site': SITE, 'errors': {}}
    for key, path in (('playoffOdds', '/api/playoff-odds'), ('tradeData', '/api/trade-data'), ('live', '/api/live')):
        try:
            snapshot[key] = fetch(path)
        except Exception as e:  # keep what loaded; the next run tries again
            snapshot['errors'][key] = str(e)
    odds = snapshot.get('playoffOdds') or {}
    season = str(odds.get('season') or (snapshot.get('tradeData') or {}).get('season') or now.year)
    week = (odds.get('lastScoredWeek') or 0) + 1
    # Before kickoffs: Sleeper's projections for every player with his injury status right now.
    # Its archive keeps the projections but overwrites the statuses, so this is the only way
    # to backtest injury handling later
    if label.startswith('pre-'):
        q = '&'.join(f'position%5B%5D={p}' for p in ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])
        try:
            req = urllib.request.Request(f'https://api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular&{q}', headers={'User-Agent': 'curl/8'})
            with urllib.request.urlopen(req, timeout=120) as r:
                snapshot['projections'] = json.load(r)
        except Exception as e:
            snapshot['errors']['projections'] = str(e)
    folder = os.path.join(OUT, season)
    os.makedirs(folder, exist_ok=True)
    name = f"w{week:02d}-{label}-{now.strftime('%Y%m%dT%H%MZ')}.json.gz"
    with gzip.open(os.path.join(folder, name), 'wt') as f:
        json.dump(snapshot, f, separators=(',', ':'))
    print(f'saved {folder}/{name}; errors: {snapshot["errors"] or "none"}')
    if all(k in snapshot['errors'] for k in ('playoffOdds', 'tradeData', 'live')):
        sys.exit(1)


if __name__ == '__main__':
    main()
