"""Kalshi's in-game fantasy-points prices against the play-by-play: how far behind the plays they
run, and whether they know more than the Live tab's player model while games are on.

Kalshi lists one market per player per game ("Over 18.5 fantasy points"), settled on Sleeper's
full-PPR points. Its API keeps every settled market's one-minute bid/ask candles and every
trade. nflverse's play-by-play has every play's wall-clock time. Here, for 2026 weeks 1-7:

  1. Each player's full-PPR points after every play (live_components.play_stats, the replay's
     own scoring), matched to his Kalshi market.
  2. Lag: for each scoring play worth 4+ points (touchdowns, mostly), when the market's trades
     first reflect it: the first trade at or after the play that's at least halfway from the
     pre-play price to where the price settled 10 minutes later. Seconds after the play's time.
  3. In-game information, every 3 minutes of each player's game: P(final > line) from the
     market (bid/ask midpoint of that minute's candle) against the Live tab's player model
     (points so far + projection x share of game left, a normal spread a + b x projection by
     position x share left, from the live_var fits, times one scale fitted here). Log loss, and
     a blend. Weeks are few: exploratory, intervals resample players.

    python kalshi_live.py

Downloads are cached in cache/kalshi_live/ (git-ignored).
"""
import json, math, os, re, time, unicodedata, urllib.request
from collections import defaultdict
from datetime import datetime

import numpy as np
import pandas as pd

import live_components as LC
import live_model as LM
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache', 'kalshi_live')
KALSHI = 'https://api.elections.kalshi.com/trade-api/v2'
SEASON = 2026
WEEKS = range(1, 8)
STEP = 180
FULL = {'pass_yd': 0.04, 'pass_td': 4, 'pass_int': -1, 'pass_2pt': 2, 'rec': 1, 'rec_yd': 0.1, 'rec_td': 6, 'rec_2pt': 2,
        'rush_yd': 0.1, 'rush_td': 6, 'rush_2pt': 2, 'fum_lost': -2, 'xpm': 1, 'xpmiss': -1, 'fgm_0_19': 3, 'fgm_20_29': 3,
        'fgm_30_39': 3, 'fgm_40_49': 4, 'fgm_50p': 5, 'fgmiss': -1}
TEAM = {'LA': 'LAR', 'JAC': 'JAX', 'WSH': 'WAS'}


def get(url, name, pause=0.12):
    path = os.path.join(CACHE, name)
    if os.path.exists(path):
        return json.load(open(path))
    os.makedirs(CACHE, exist_ok=True)
    for attempt in range(8):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'curl/8'}), timeout=60) as r:
                data = json.load(r)
            break
        except Exception:
            if attempt == 7: raise
            time.sleep(min(2 ** attempt, 30))
    json.dump(data, open(path, 'w'))
    time.sleep(pause)
    return data


def norm(name):
    name = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z]', '', re.sub(r'\b(jr|sr|ii|iii|iv|v)\b\.?', '', name))


def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


def markets():
    out, cur = [], None
    for page in range(20):
        d = get(f'{KALSHI}/markets?series_ticker=KXNFLFFPTS&status=settled&limit=1000' + (f'&cursor={cur}' if cur else ''), f'markets_{page}.json')
        out += d['markets']; cur = d.get('cursor')
        if not cur or not d['markets']: break
    return out


def trades(ticker):
    out, cur = [], None
    for page in range(30):
        d = get(f'{KALSHI}/markets/trades?ticker={ticker}&limit=1000' + (f'&cursor={cur}' if cur else ''), f'trades_{ticker}_{page}.json')
        out += d['trades']; cur = d.get('cursor')
        if not cur or not d['trades']: break
    return sorted((ts(t['created_time']), float(t['yes_price_dollars'])) for t in out)


def candles(ticker, start, end):
    d = get(f'{KALSHI}/series/KXNFLFFPTS/markets/{ticker}/candlesticks?start_ts={int(start)}&end_ts={int(end)}&period_interval=1', f'candles_{ticker}.json')
    out = []
    for c in d.get('candlesticks') or []:
        bid = float(c['yes_bid'].get('close_dollars') or 0); ask = float(c['yes_ask'].get('close_dollars') or 0)
        if 0 < bid < ask <= 1: out.append((c['end_period_ts'], (bid + ask) / 2, ask - bid))
    return out


def player_timelines():
    """Each player's (Sleeper ID) full-PPR points after every play, games' clocks, from the 2026 play-by-play"""
    import build_play_timelines as BPT
    pbp = pd.read_parquet(os.path.join(LC.PBP, f'play_by_play_{SEASON}.parquet'))
    pbp = pbp[(pbp.season_type == 'REG') & (pbp.play_type != 'no_play') & pbp.week.isin(list(WEEKS))]
    players = get('https://api.sleeper.app/v1/players/nfl', 'sleeper_players.json')
    pos = {p: v.get('position') for p, v in players.items()}
    ids = BPT.crosswalk()
    known = set(ids.values())
    for gsis, sid in BPT.name_matches({p for p, v in players.items() if v.get('position') in ('QB', 'RB', 'WR', 'TE', 'K') and v.get('active')} - known).items():
        ids.setdefault(gsis, sid)
    sid = lambda g: ids.get(g) if isinstance(g, str) else None
    w8 = {k: v for k, v in FULL.items()}
    series = defaultdict(list)   # (week, pid) -> [(t, cumulative full PPR)] in that week's game
    games = {}                   # team -> (week, first t, last t, snaps [(t, qtr, clock, own, opp)])
    for (week, gid), g in pbp.groupby(['week', 'game_id']):
        g = g.sort_values('play_id', kind='stable')
        home, away = TEAM.get(g.home_team.iloc[0], g.home_team.iloc[0]), TEAM.get(g.away_team.iloc[0], g.away_team.iloc[0])
        snaps, tot, t_last = [], defaultdict(float), None
        for p in g.itertuples():
            t = LC.epoch(p.time_of_day) or t_last
            if t is None: continue
            t_last = t
            snaps.append((t, int(LC.num(p.qtr) or 1), int(LC.num(p.quarter_seconds_remaining)), int(LC.num(p.total_home_score)), int(LC.num(p.total_away_score))))
            for who, k, v in LC.play_stats(p, sid, pos):
                if k in w8 and not who.isalpha():
                    tot[who] += w8[k] * v
                    series[(int(week), who)].append((t, round(tot[who], 2)))
        s = np.array(snaps, dtype=float)
        games[(week, home)] = (s, 3, 4); games[(week, away)] = (s, 4, 3)
    return series, games, players


def at(series, t):
    i = np.searchsorted([x[0] for x in series], t, side='right') - 1
    return series[i][1] if i >= 0 else 0.0


def main():
    ms = markets()
    series, games, players = player_timelines()
    by_name = defaultdict(list)
    for pid, p in players.items():
        if p.get('full_name') and p.get('position') in ('QB', 'RB', 'WR', 'TE', 'K'): by_name[norm(p['full_name'])].append(pid)
    proj = {w: {r['player_id']: r for r in get(f'https://api.sleeper.com/projections/nfl/{SEASON}/{w}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K', f'proj_{w}.json')} for w in WEEKS}
    var = json.load(open(os.path.join(HERE, 'cache', 'live_var', '2025.json')))  # fitted on 2018-2024 (half PPR; shape only)

    lags, rows, skipped = [], [], defaultdict(int)
    for m in ms:
        name = m['title'].split(':')[0].strip()
        if 'D/ST' in name: skipped['defense'] += 1; continue
        close = ts(m['close_time'])
        cands = by_name.get(norm(name), [])
        # The player whose team played a game this market covers, by week
        hit = None
        for pid in cands:
            team = TEAM.get(players[pid].get('team'), players[pid].get('team'))
            for w in WEEKS:
                g = games.get((w, team))
                if g and g[0][0, 0] - 6 * 3600 < close < g[0][-1, 0] + 12 * 3600: hit = (pid, w, g)
        if not hit: skipped['no player or game'] += 1; continue
        pid, week, (snaps, mine, theirs) = hit
        pr = (proj[week].get(pid) or {}).get('stats') or {}
        if not pr.get('pts_ppr'): skipped['no projection'] += 1; continue
        line, over = float(m['floor_strike']), m['result'] == 'yes'
        first, last = snaps[0, 0], snaps[-1, 0]
        tr = trades(m['ticker'])
        cs = candles(m['ticker'], first - 3600, last + 600)
        s = series.get((week, pid), [])
        final = s[-1][1] if s else 0.0
        if (final > line) != over: skipped['replay final disagrees with settlement'] += 1
        # 2. Lag after each 4+ point play
        prev = 0.0
        for t, v in s:
            jump = v - prev; prev = v
            if jump < 4: continue
            before = [p for x, p in tr if t - 300 <= x < t - 5]
            after = [p for x, p in tr if t + 540 <= x <= t + 660] or [p for x, p in tr if t + 300 <= x <= t + 900]
            if not before or not after: continue
            p0, p1 = before[-1], np.median(after)
            if p1 - p0 < 0.05: continue
            half = p0 + (p1 - p0) / 2
            reached = next((x for x, p in tr if x >= t - 5 and p >= half), None)
            if reached is not None: lags.append(dict(ticker=m['ticker'], pid=pid, lag=reached - t, move=p1 - p0, n_trades=len(tr)))
        # 3. In-game samples every 3 minutes of his game
        ratio = var.get(players[pid].get('position'), [0, 5])
        for t in np.arange(first + STEP, last, STEP):
            c = [x for x in cs if t - 60 <= x[0] <= t]
            if not c: continue
            i = np.searchsorted(snaps[:, 0], t, side='right') - 1
            q, clock, own, opp = snaps[i, 1], snaps[i, 2], snaps[i, mine], snaps[i, theirs]
            rem = float(LM.game_remaining(torch.tensor(1), torch.tensor(float(q)), torch.tensor(float(clock)), torch.tensor(float(own - opp))))
            rows.append(dict(ticker=m['ticker'], pid=pid, week=week, line=line, over=over, t=t, rem=rem, so_far=at(s, t),
                             proj=pr['pts_ppr'], a=ratio[0], b=ratio[1], mid=c[-1][1], spread=c[-1][2]))
    print(f'{len(ms)} settled markets; skipped {dict(skipped)}')
    report(pd.DataFrame(lags), pd.DataFrame(rows))


def phi(z):
    return 0.5 * (1 + np.vectorize(math.erf)(z / math.sqrt(2)))


def ll(p, y):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def report(lags, rows):
    print(f'\nLag: {len(lags)} scoring plays (4+ points) whose market moved 5+ cents')
    q = lags.lag.quantile([0.1, 0.25, 0.5, 0.75, 0.9])
    print('  seconds from the play to the market being halfway to its new price: ' + ', '.join(f'p{int(k * 100)} {v:.0f}' for k, v in q.items()))
    print(f'  within 30 s: {np.mean(lags.lag <= 30):.0%}; within 2 min: {np.mean(lags.lag <= 120):.0%}; before the play time: {np.mean(lags.lag < 0):.0%}')
    rows = rows.copy()
    y = rows.over.astype(float).to_numpy()
    print(f'\nIn game: {len(rows):,} player-samples (every 3 minutes of a game), {rows.ticker.nunique()} markets; median bid/ask spread {rows.spread.median():.2f}')
    mean = rows.so_far + rows.proj * rows.rem
    sd0 = np.sqrt(np.maximum((rows.a + rows.b * rows.proj) * rows.rem, 1e-6))
    best = min(((ll(phi((mean - rows.line) / (k * sd0)), y).mean(), k) for k in np.arange(0.6, 2.01, 0.05)))
    model = np.asarray(phi((mean - rows.line) / (best[1] * sd0)))
    market = rows.mid.to_numpy()
    print(f'  model (points so far + projection x share left, spread x{best[1]:.2f} fitted here): log loss {ll(model, y).mean():.4f}')
    print(f'  market midpoint:                                           log loss {ll(market, y).mean():.4f}')
    for w in (0.25, 0.5, 0.75):
        print(f'  blend {w:.2f} market:                                         log loss {ll(w * market + (1 - w) * model, y).mean():.4f}')
    # Interval for market - model, resampling players
    d = ll(market, y) - ll(model, y)
    g = rows.pid.to_numpy(); ids, inv = np.unique(g, return_inverse=True)
    s = np.bincount(inv, weights=d); c = np.bincount(inv)
    rng = np.random.default_rng(0); w = rng.multinomial(len(ids), np.full(len(ids), 1 / len(ids)), size=2000)
    lo, hi = np.percentile((w @ s) / (w @ c), [2.5, 97.5])
    print(f'  market - model: {d.mean():+.4f} (95% {lo:+.4f} to {hi:+.4f}, resampling players)')
    for lo_, hi_, label in ((0.75, 1.1, 'first quarter'), (0.25, 0.75, 'middle'), (0, 0.25, 'last quarter')):
        sel = (rows.rem > lo_) & (rows.rem <= hi_)
        print(f'    {label:13s} n={sel.sum():6,}  model {ll(model[sel], y[sel]).mean():.4f}  market {ll(market[sel], y[sel]).mean():.4f}')


if __name__ == '__main__':
    main()
