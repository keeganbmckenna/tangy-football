"""Kalshi's 2025 player props (kalshi_props.py) as each player's expected final stats, minute by
minute, for the props test (PREREGISTRATION_2026.md, 2026-10-26 addendum, test 5).

Per market minute, the bid/ask midpoint (both sides quoted, else no price that minute) is the
chance of the event. Per player and minute:
  yards and receptions   ladders ("90+ rushing yards") give P(stat >= k) at each rung; made
                         non-increasing in k (pool adjacent violators), then the expected final
                         stat is the area under that survival curve: from 0 to the first rung
                         linear from 1, between rungs linear, past the top rung an exponential tail
                         at the rate of the last two rungs (capped)
  touchdowns             anytime touchdown p (capped at 0.97): -ln(1 - p) expected rushing +
                         receiving touchdowns (Poisson), only until he scores one (the market then
                         says nothing about more; the replay falls back to the model); passing
                         touchdowns from their ladder like yards
Each stat's latest price at or before a moment is its value then (prices carry forward 15 minutes).

    python kalshi_props_model.py     # builds cache/kalshi_props_expected.pkl and reports coverage

Output: {(week, Sleeper ID): {'times': [...], stat: [expected final or nan per time]}} with stats
pass_yd, rush_yd, rec_yd, rec, pass_td, td (rushing + receiving).
"""
import glob, gzip, json, math, os, pickle, re, unicodedata
from collections import defaultdict
from datetime import datetime

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'cache', 'kalshi_props')
OUT = os.path.join(HERE, 'cache', 'kalshi_props_expected.pkl')
ARCHIVE = os.path.join(HERE, '..', '..', 'data', 'sleeper', '2025')
SERIES_STAT = {'KXNFLPASSYDS': 'pass_yd', 'KXNFLRSHYDS': 'rush_yd', 'KXNFLRECYDS': 'rec_yd', 'KXNFLREC': 'rec', 'KXNFLPASSTDS': 'pass_td', 'KXNFLANYTD': 'td'}
STATS = ('pass_yd', 'rush_yd', 'rec_yd', 'rec', 'pass_td', 'td')
CARRY = 15 * 60
# Kalshi's names for players Sleeper lists differently
ALIASES = {'Hollywood Brown': 'Marquise Brown'}
STEP = 60


def norm(name):
    name = unicodedata.normalize('NFKD', name or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z]', '', re.sub(r'\b(jr|sr|ii|iii|iv|v)\b\.?', '', name))


def arch(name):
    return json.load(gzip.open(os.path.join(ARCHIVE, f'{name}.json.gz'), 'rt'))


def players_by_week():
    """week -> normalised name -> [(Sleeper ID, team)] from that week's projection rows"""
    out = {}
    for w in range(1, 19):
        d = defaultdict(list)
        for r in arch(f'projections/{w}'):
            p = r.get('player') or {}
            if p.get('position') in ('QB', 'RB', 'WR', 'TE'):
                d[norm(f"{p.get('first_name', '')} {p.get('last_name', '')}")].append((r['player_id'], r.get('team')))
        out[w] = d
    return out


def week_of(date):
    """2025 week of a game date, from the schedule"""
    for g in arch('schedule'):
        pass
    return None


def schedule_weeks():
    by_date = {}
    for g in arch('schedule'):
        by_date[(g['date'], g['home'])] = g['week']; by_date[(g['date'], g['away'])] = g['week']
    return by_date


def survival_mean(ks, ps, cap_tail=3.0):
    """Area under a survival curve known at rungs ks (ascending) with P(X >= k) = ps"""
    ps = np.minimum.accumulate(np.clip(ps, 0, 1))  # non-increasing (a cheap monotone fix after pooling)
    area, prev_k, prev_p = 0.0, 0.0, 1.0
    for k, p in zip(ks, ps):
        area += (k - prev_k) * (prev_p + p) / 2
        prev_k, prev_p = k, p
    # Tail past the top rung: exponential at the last two rungs' rate
    if len(ks) >= 2 and ps[-1] > 0 and ps[-2] > ps[-1]:
        rate = math.log(ps[-2] / ps[-1]) / (ks[-1] - ks[-2])
        area += min(ps[-1] / rate, cap_tail * (ks[-1] - ks[-2]) * ps[-1] / max(ps[-2] - ps[-1], 1e-6) * (ps[-2] - ps[-1]))
    return area


def pava_desc(ys):
    """Pool adjacent violators for a non-increasing fit"""
    out = []
    for y in ys:
        out.append([y, 1])
        while len(out) > 1 and out[-2][0] / out[-2][1] < out[-1][0] / out[-1][1]:
            a = out.pop(); out[-1][0] += a[0]; out[-1][1] += a[1]
    return [v for s, n in out for v in [s / n] * n]


def build():
    pw, weeks_by = players_by_week(), schedule_weeks()
    series = defaultdict(lambda: defaultdict(dict))   # (week, pid) -> stat -> rung -> [(t, mid)]
    unmatched = defaultdict(int)
    for f in glob.glob(os.path.join(SRC, '*.json')):
        d = json.load(open(f))
        ev = d['event']; prefix = ev.split('-')[0]; stat = SERIES_STAT.get(prefix)
        if not stat: continue
        date = datetime.strptime(ev.split('-')[1][:7], '%y%b%d').date().isoformat()
        for m in d['markets']:
            name = m.get('subtitle') if stat == 'td' else re.sub(r'\s+records\s.*$', '', m.get('title') or '')
            if not name or name.lower().startswith('no touchdown') or 'D/ST' in name: continue
            name = ALIASES.get(name, name)
            k = 1.0 if stat == 'td' else (float(m['strike']) if m.get('strike') is not None else float(re.search(r'(\d+)\+', m['title']).group(1)))
            cands = []
            for w in {weeks_by.get((date, t)) for t in [x for (dt_, x) in weeks_by if dt_ == date]} - {None}:
                cands += [(w, pid, team) for pid, team in pw[w].get(norm(name), [])]
            # Same name on two teams that day: the one whose team played this game
            game_teams = {x for (dt_, x) in weeks_by if dt_ == date}
            cands = [c for c in cands if c[2] in game_teams] or cands
            if len({(c[0], c[1]) for c in cands}) != 1: unmatched[stat] += 1; continue
            w, pid, _ = cands[0]
            pts = [(c[0], (c[1] + c[2]) / 2) for c in m['candles'] if c[1] > 0 and c[2] > 0]
            if pts: series[(w, pid)][stat][k] = pts
    out = {}
    for key, stats in series.items():
        t0 = min(t for st in stats.values() for pts in st.values() for t, _ in pts)
        t1 = max(t for st in stats.values() for pts in st.values() for t, _ in pts)
        times = np.arange(t0 - t0 % STEP, t1 + STEP, STEP)
        row = {'times': times}
        for stat in STATS:
            rungs = stats.get(stat)
            if not rungs: continue
            ks = sorted(rungs)
            # Each rung's latest price at or before each time (carried 15 minutes)
            P = np.full((len(times), len(ks)), np.nan)
            for j, k in enumerate(ks):
                ts_ = np.array([t for t, _ in rungs[k]]); ps_ = np.array([p for _, p in rungs[k]])
                i = np.searchsorted(ts_, times, side='right') - 1
                ok = (i >= 0) & (times - ts_[np.clip(i, 0, None)] <= CARRY)
                P[ok, j] = ps_[i[ok]]
            vals = np.full(len(times), np.nan)
            for r in range(len(times)):
                have = ~np.isnan(P[r])
                if not have.any(): continue
                kk = np.array(ks)[have]; pp = np.array(pava_desc(list(P[r][have])))
                vals[r] = -math.log(1 - min(pp[0], 0.97)) if stat == 'td' else (survival_mean(kk, pp) if stat != 'pass_td' else float(np.sum(pp)) if list(kk) == list(range(1, len(kk) + 1)) else survival_mean(kk, pp))
            row[stat] = vals
        out[key] = row
    pickle.dump(out, open(OUT, 'wb'))
    print(f'{len(out)} player-games; unmatched markets by stat {dict(unmatched)}')
    cov = defaultdict(int)
    for row in out.values():
        for st in STATS:
            if st in row and np.isfinite(row[st]).any(): cov[st] += 1
    print('player-games with a priced stat:', dict(cov))
    return out


def load():
    return pickle.load(open(OUT, 'rb'))


if __name__ == '__main__':
    build()
