"""Kalshi's 2025 NFL player props, downloaded for the props test (PREREGISTRATION_2026.md, the
2026-10-26 addendum, test 5).

Kalshi had no fantasy-points markets in 2025, but it had per-stat ones: anytime touchdown (from
week 1), passing, rushing and receiving yards ladders (from week 5), receptions (late October)
and passing touchdowns (late November). Settled markets live in its historical store. For every
2025 regular-season game: each series' markets (ticker, title, strike, result) and their
one-minute bid/ask candles from three hours before kickoff to the close.

    python kalshi_props.py           # download (cached; resumable)

Writes cache/kalshi_props/{event}.json: the event's markets with their candles
[[unix minute end, bid, ask], ...]. Read with load().
"""
import json, os, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache', 'kalshi_props')
KALSHI = 'https://api.elections.kalshi.com/trade-api/v2'
SERIES = ('KXNFLANYTD', 'KXNFLPASSYDS', 'KXNFLRSHYDS', 'KXNFLRECYDS', 'KXNFLREC', 'KXNFLPASSTDS')
START, END = datetime(2025, 9, 1), datetime(2026, 1, 6)  # the 2025 regular season


def get(url):
    for attempt in range(10):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'curl/8'}), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (400, 404): return None
            time.sleep(min(2 ** attempt, 30))
        except Exception:
            time.sleep(min(2 ** attempt, 30))
    raise RuntimeError(url)


def events(series):
    out, cur = [], None
    while True:
        d = get(f'{KALSHI}/events?series_ticker={series}&status=settled&limit=200' + (f'&cursor={cur}' if cur else ''))
        out += [e['event_ticker'] for e in d.get('events', [])]
        cur = d.get('cursor')
        if not cur or not d.get('events'): return out


def game_date(event):
    try: return datetime.strptime(event.split('-')[1][:7], '%y%b%d')
    except ValueError: return None


def candles(ticker, start, end):
    d = get(f'{KALSHI}/historical/markets/{ticker}/candlesticks?start_ts={int(start)}&end_ts={int(end)}&period_interval=1') or {}
    out = []
    for c in d.get('candlesticks') or []:
        bid = float((c.get('yes_bid') or {}).get('close_dollars') or 0); ask = float((c.get('yes_ask') or {}).get('close_dollars') or 0)
        out.append([c['end_period_ts'], bid, ask])
    return out


def fetch_event(event):
    path = os.path.join(CACHE, f'{event}.json')
    if os.path.exists(path): return 0
    markets, cur = [], None
    while True:
        d = get(f'{KALSHI}/historical/markets?event_ticker={event}&limit=1000' + (f'&cursor={cur}' if cur else '')) or {}
        markets += d.get('markets', []); cur = d.get('cursor')
        if not cur or not d.get('markets'): break
    out = []
    for m in markets:
        close = datetime.fromisoformat(m['close_time'].replace('Z', '+00:00')).timestamp()
        # A game's markets close soon after it ends; its candles: the 8 hours before the close
        out.append({'ticker': m['ticker'], 'title': m.get('title'), 'subtitle': m.get('yes_sub_title'),
                    'strike': m.get('floor_strike'), 'result': m.get('result'), 'close': close,
                    'candles': candles(m['ticker'], close - 8 * 3600, close)})
    os.makedirs(CACHE, exist_ok=True)
    json.dump({'event': event, 'markets': out}, open(path + '.tmp', 'w'))
    os.replace(path + '.tmp', path)
    return len(out)


def load(event):
    return json.load(open(os.path.join(CACHE, f'{event}.json')))


if __name__ == '__main__':
    todo = []
    for s in SERIES:
        evs = [e for e in events(s) if (d := game_date(e)) and START <= d <= END]
        print(f'{s}: {len(evs)} 2025 regular-season games', flush=True)
        todo += evs
    done = 0
    with ThreadPoolExecutor(4) as pool:
        for n in pool.map(fetch_event, todo):
            done += 1
            if done % 25 == 0: print(f'{done} of {len(todo)} events', flush=True)
    print('done', flush=True)
