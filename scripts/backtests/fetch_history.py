"""Cache the league's history from Sleeper into ./cache: leagues, rosters, trades,
matchups and weekly projections for every season. Run first; the other
backtests read only the cache."""
import json, os, urllib.request
D = os.path.dirname(os.path.abspath(__file__)) + '/cache'
os.makedirs(D, exist_ok=True)
def g(u, name):
    p = f'{D}/{name}.json'
    if os.path.exists(p): return json.load(open(p))
    d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'curl/8'})))
    json.dump(d, open(p, 'w')); return d
lid = '1323741311471194112'
seasons = []
while lid and lid != '0':
    L = g(f'https://api.sleeper.app/v1/league/{lid}', f'league_{lid}')
    seasons.append((L['season'], lid)); lid = L.get('previous_league_id')
    g(f"https://api.sleeper.app/v1/league/{L['league_id']}/rosters", f"rosters_{L['season']}")
for season, lid in seasons:
    for w in range(1, 18):
        g(f'https://api.sleeper.app/v1/league/{lid}/transactions/{w}', f'tx_{season}_{w}')
        g(f'https://api.sleeper.app/v1/league/{lid}/matchups/{w}', f'm_{season}_{w}')
        q = '&'.join(f'position%5B%5D={p}' for p in ['QB','RB','WR','TE','K','DEF'])
        g(f'https://api.sleeper.com/projections/nfl/{season}/{w}?season_type=regular&{q}', f'proj_{season}_{w}')
        g(f'https://api.sleeper.app/v1/stats/nfl/regular/{season}/{w}', f'stats_{season}_{w}')
    print(season, 'ok')
