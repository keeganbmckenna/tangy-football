"""Kalshi's player fantasy-points markets vs Sleeper's projections, 2026 weeks 1-6.

Kalshi lists one line per player per game ("Drake Maye: Over 21.6 fantasy points"),
settled on Sleeper's own full-PPR points, so both sides are scored in the same format
and no conversion is needed here. For each settled market: Kalshi's price just before
kickoff (the bid/ask midpoint), Sleeper's projection for the week and the player's actual
full-PPR points. Compares:

  - P(over the line): the market's price vs a normal around Sleeper's projection (with
    the Live tab's per-position spreads, and with the spread refitted), and blends
    (log loss, Brier, calibration);
  - the expected points each implies (the market's from its one line and price, with the
    same spreads) against actual points (mean absolute and squared error).

Downloads are cached in cache/kalshi/.
"""
import json, math, os, re, statistics as st, sys, time, unicodedata, urllib.request
from collections import defaultdict

CACHE = os.path.join(os.path.dirname(__file__), 'cache', 'kalshi')
SEASON = 2026
WEEKS = range(1, 7)
POS_RATIO = {'QB': 0.45, 'RB': 0.6, 'WR': 0.6, 'TE': 0.65, 'K': 0.55, 'DEF': 0.6}
KALSHI = 'https://api.elections.kalshi.com/trade-api/v2'


def get(url, name, pause=0.0):
    path = os.path.join(CACHE, name)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    for attempt in range(8):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'curl/8'}), timeout=60) as r:
                data = json.load(r)
            break
        except Exception as e:  # rate limits and blips: back off and retry
            if attempt == 7:
                raise
            time.sleep(min(2 ** attempt, 30))
    with open(path, 'w') as f:
        json.dump(data, f)
    time.sleep(pause)
    return data


def norm(name):
    name = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    name = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b\.?', '', name)
    return re.sub(r'[^a-z]', '', name)


def cdf(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


# ESPN codes that differ from Sleeper's (and Kalshi's)
ESPN_TEAM = {'WSH': 'WAS'}


def kickoffs():
    """(game date as Kalshi writes it, e.g. 26OCT19, frozenset of the two teams) -> (kickoff unix time, week)"""
    out = {}
    for w in WEEKS:
        sb = get(f'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week={w}&dates={SEASON}', f'espn_{SEASON}_{w}.json')
        for e in sb['events']:
            ts = time.mktime(time.strptime(e['date'], '%Y-%m-%dT%H:%MZ')) - time.timezone
            teams = frozenset(ESPN_TEAM.get(c['team']['abbreviation'], c['team']['abbreviation']) for c in e['competitions'][0]['competitors'])
            # Kalshi dates games in US Eastern time
            et = time.gmtime(ts - 4 * 3600)
            key = time.strftime('%y%b%d', et).upper()
            out[(key, teams)] = (ts, w)
    return out


def split_teams(code, known):
    """'WASSF' -> {'WAS', 'SF'}, trying each split against the known team codes"""
    for i in range(2, 4):
        a, b = code[:i], code[i:]
        alias = {'JAC': 'JAX', 'LA': 'LAR'}
        a, b = alias.get(a, a), alias.get(b, b)
        if a in known and b in known:
            return frozenset((a, b))
    return None


def market_price(ticker, kick):
    """Midpoint of the bid and ask at the last minute before kickoff (None if there's no book)"""
    d = get(f'{KALSHI}/series/KXNFLFFPTS/markets/{ticker}/candlesticks?start_ts={int(kick) - 3 * 3600}&end_ts={int(kick)}&period_interval=1',
            f'candles_{ticker}.json', pause=0.25)
    candles = [c for c in d.get('candlesticks') or [] if c['end_period_ts'] <= kick]
    for c in reversed(candles):
        bid = float(c['yes_bid'].get('close_dollars') or 0)
        ask = float(c['yes_ask'].get('close_dollars') or 0)
        if 0 < bid < ask <= 1:
            return (bid + ask) / 2, ask - bid
    return None, None


def main():
    markets = get(f'{KALSHI}/markets?series_ticker=KXNFLFFPTS&status=settled&limit=1000', 'ffpts_settled.json')
    players = get('https://api.sleeper.app/v1/players/nfl', 'sleeper_players.json')
    by_name = defaultdict(list)
    for pid, p in players.items():
        if p.get('full_name'):
            by_name[norm(p['full_name'])].append(pid)
    proj = {w: {r['player_id']: r for r in get(f'https://api.sleeper.com/projections/nfl/{SEASON}/{w}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF', f'proj_{SEASON}_{w}.json')} for w in WEEKS}
    stats = {w: get(f'https://api.sleeper.app/v1/stats/nfl/regular/{SEASON}/{w}', f'stats_{SEASON}_{w}.json') for w in WEEKS}
    games = kickoffs()
    known = {t for _, teams in games for t in teams}

    rows, skipped = [], defaultdict(int)
    for m in markets:
        date_teams = m['event_ticker'].split('-')[1]
        game = split_teams(date_teams[7:], known)
        hit = games.get((date_teams[:7], game)) if game else None
        if not hit:
            skipped['no game'] += 1
            continue
        kick, week = hit
        name = m['title'].split(':')[0].strip()
        line = float(m['floor_strike'])
        if 'D/ST' in name:
            team = m['ticker'].split('-')[2][:3]
            team = {'JAC': 'JAX', 'LA': 'LAR'}.get(team, team)
            pid, pos = team if team in known else None, 'DEF'
        else:
            ids = [i for i in by_name.get(norm(name), []) if players[i].get('team') in game or i in proj[week]]
            ids = [i for i in ids if i in proj[week]] or ids
            pid = ids[0] if len(ids) == 1 else None
            pos = players[pid].get('position') if pid else None
        if not pid or pid not in proj[week]:
            skipped['no player or projection'] += 1
            continue
        pr = (proj[week][pid].get('stats') or {}).get('pts_ppr')
        actual = (stats[week].get(pid) or {}).get('pts_ppr')
        if pr is None:
            skipped['no projection'] += 1
            continue
        # Kalshi: a player who doesn't play scores 0
        actual = actual or 0.0
        price, spread = market_price(m['ticker'], kick)
        if price is None:
            skipped['no book at kickoff'] += 1
            continue
        over = m['result'] == 'yes'
        if over != (actual > line):
            skipped['settlement disagrees with Sleeper stats'] += 1
        rows.append(dict(ticker=m['ticker'], name=name, pos=pos, week=week, line=line, price=price, spread=spread,
                         proj=pr, actual=actual, over=over, volume=float(m.get('volume_fp') or 0)))

    print(f'{len(rows)} markets used; skipped {dict(skipped)}')
    json.dump(rows, open(os.path.join(CACHE, 'rows.json'), 'w'))
    report(rows)


def sleeper_p(r, scale):
    sd = max(scale * POS_RATIO.get(r['pos'], 0.6) * max(r['proj'], 1), 1)
    return 1 - cdf((r['line'] - r['proj']) / sd)


def market_mean(r, scale):
    """The expected points that put the market's price on its line, with the same spreads"""
    p = min(max(r['price'], 0.02), 0.98)
    lo, hi = 0.0, 80.0
    for _ in range(60):
        mid = (lo + hi) / 2
        sd = max(scale * POS_RATIO.get(r['pos'], 0.6) * max(mid, 1), 1)
        if 1 - cdf((r['line'] - mid) / sd) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def logloss(ps, ys):
    return -st.mean(math.log(min(max(p, 1e-4), 1 - 1e-4)) if y else math.log(1 - min(max(p, 1e-4), 1 - 1e-4)) for p, y in zip(ps, ys))


def brier(ps, ys):
    return st.mean((p - y) ** 2 for p, y in zip(ps, ys))


def report(rows):
    ys = [r['over'] for r in rows]
    print(f"\nlines vs Sleeper: line - projection mean {st.mean(r['line'] - r['proj'] for r in rows):+.2f}, "
          f"median |diff| {st.median(abs(r['line'] - r['proj']) for r in rows):.2f}; over hit {st.mean(ys):.3f}; "
          f"median bid/ask spread {st.median(r['spread'] for r in rows):.2f}")

    print('\nP(over the line)            log loss   Brier')
    print(f"  coin flip                   {logloss([0.5] * len(ys), ys):.4f}   {brier([0.5] * len(ys), ys):.4f}")
    print(f"  Kalshi price                {logloss([r['price'] for r in rows], ys):.4f}   {brier([r['price'] for r in rows], ys):.4f}")
    for scale in (1.0,):
        ps = [sleeper_p(r, scale) for r in rows]
        print(f"  Sleeper, Live's spreads     {logloss(ps, ys):.4f}   {brier(ps, ys):.4f}")
    best = min((logloss([sleeper_p(r, s) for r in rows], ys), s) for s in [x / 20 for x in range(8, 41)])
    ps_s = [sleeper_p(r, best[1]) for r in rows]
    print(f"  Sleeper, spread x{best[1]:.2f} (fit) {best[0]:.4f}   {brier(ps_s, ys):.4f}")
    for w in (0.25, 0.5, 0.75):
        ps = [w * r['price'] + (1 - w) * p for r, p in zip(rows, ps_s)]
        print(f"  blend {int(w * 100)}% Kalshi            {logloss(ps, ys):.4f}   {brier(ps, ys):.4f}")

    # Out of sample: fit the spread on the other weeks, score each week
    print('\nby week (Sleeper spread fitted on the other weeks):  n   Kalshi   Sleeper  (log loss)')
    for w in sorted({r['week'] for r in rows}):
        test = [r for r in rows if r['week'] == w]
        train = [r for r in rows if r['week'] != w]
        s = min((logloss([sleeper_p(r, s) for r in train], [r['over'] for r in train]), s) for s in [x / 20 for x in range(8, 41)])[1]
        ty = [r['over'] for r in test]
        print(f"  week {w}  {len(test):4d}   {logloss([r['price'] for r in test], ty):.4f}   {logloss([sleeper_p(r, s) for r in test], ty):.4f}")

    print('\nKalshi calibration:  price bucket   n   avg price   hit rate')
    for lo in (0, 0.2, 0.35, 0.5, 0.65, 0.8):
        b = [r for r in rows if lo <= r['price'] < lo + (0.2 if lo in (0, 0.8) else 0.15)]
        if b:
            print(f"  {lo:.2f}+          {len(b):5d}   {st.mean(r['price'] for r in b):.3f}      {st.mean(r['over'] for r in b):.3f}")

    print('\nexpected points vs actual     mean abs err   rmse   bias')
    for label, est in [('Sleeper projection', [r['proj'] for r in rows]),
                       ('Kalshi line alone', [r['line'] for r in rows]),
                       ('Kalshi (line + price)', [market_mean(r, best[1]) for r in rows])]:
        errs = [e - r['actual'] for e, r in zip(est, rows)]
        print(f"  {label:26s}  {st.mean(abs(x) for x in errs):6.3f}      {math.sqrt(st.mean(x * x for x in errs)):6.3f}  {st.mean(errs):+.2f}")
    km = [market_mean(r, best[1]) for r in rows]
    for w in (0.25, 0.5, 0.75):
        errs = [w * k + (1 - w) * r['proj'] - r['actual'] for k, r in zip(km, rows)]
        print(f"  blend {int(w * 100)}% Kalshi            {st.mean(abs(x) for x in errs):6.3f}      {math.sqrt(st.mean(x * x for x in errs)):6.3f}  {st.mean(errs):+.2f}")

    print('\nby position (mean abs err)   n   Sleeper   Kalshi   50/50')
    for pos in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF'):
        b = [(r, k) for r, k in zip(rows, km) if r['pos'] == pos]
        if b:
            print(f"  {pos:4s}                    {len(b):4d}   {st.mean(abs(r['proj'] - r['actual']) for r, _ in b):6.3f}   {st.mean(abs(k - r['actual']) for r, k in b):6.3f}   {st.mean(abs((k + r['proj']) / 2 - r['actual']) for r, k in b):6.3f}")

    # Where they disagree most: who was right?
    gaps = sorted(zip(rows, km), key=lambda x: -abs(x[1] - x[0]['proj']))[: len(rows) // 5]
    closer = sum(abs(k - r['actual']) < abs(r['proj'] - r['actual']) for r, k in gaps)
    print(f"\nbiggest disagreements (top 20%, {len(gaps)} markets, gap >= {abs(gaps[-1][1] - gaps[-1][0]['proj']):.1f} pts): Kalshi closer in {closer} ({closer / len(gaps):.0%})")


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'report':
        report(json.load(open(os.path.join(CACHE, 'rows.json'))))
    else:
        main()
