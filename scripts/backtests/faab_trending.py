"""Would Sleeper's trending adds have told a bidder the crowd's demand in time? A historical
stand-in: for every FAAB auction (faab_auctions.py), how many other crawled leagues (any waiver
type) had already added the player in the 72 hours before the bids were due (processing time
minus 6 hours), as a share of the season's crawled leagues. Trending counts adds across Sleeper
the same way: instant free-agent pickups and processed claims, as they happen.

Adds cache/faab_auctions.parquet's 'early' column (and 'early24', the last 24 hours), and the
player's trending rank: his place among every player by leagues adding him in the 72 hours
before that week's typical deadline (rank 1 most added; Sleeper's endpoint lists the top 100,
so ranks past 100 are 101), and his count relative to the week's most-added player.

    ../../.venv/bin/python faab_trending.py
"""
import glob, gzip, json, os
from collections import defaultdict
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
H = 3600 * 1000


def main():
    path = os.path.join(CACHE, 'faab_auctions.parquet')
    df = pd.read_parquet(path)
    df['early'] = 0.0; df['early24'] = 0.0
    for season, part in df.groupby('season'):
        adds = defaultdict(list)  # player -> [(time, league)]
        files = glob.glob(os.path.join(CACHE, 'transactions', str(season), '*.json.gz'))
        for f in files:
            lid = os.path.basename(f).split('.')[0]
            for ts in json.load(gzip.open(f, 'rt')).values():
                for t in ts:
                    if t['status'] != 'complete' or t['type'] not in ('free_agent', 'waiver') or not t.get('adds'): continue
                    for p in t['adds']: adds[p].append((t.get('status_updated') or t.get('created') or 0, lid))
        n = len(files)
        times = {p: (np.array([x[0] for x in v]), np.array([x[1] for x in v])) for p, v in adds.items()}
        for p in times:
            o = np.argsort(times[p][0]); times[p] = (times[p][0][o], times[p][1][o])
        # each week's ranking, at the week's typical deadline (median processing time - 6 h)
        due_leg = (part.groupby('leg')['when'].median() - 6 * H).to_dict()
        ranking = {}
        for leg, due in due_leg.items():
            cnt = []
            for p, (t, l) in times.items():
                a, b = np.searchsorted(t, due - 72 * H), np.searchsorted(t, due)
                if b > a: cnt.append(len(set(l[a:b])))
            ranking[leg] = np.sort(np.array(cnt))[::-1]
        e72, e24 = [], []
        for pid, when, lg in zip(part.player.values, part['when'].values, part.league.values):
            if pid not in times: e72.append(0.0); e24.append(0.0); continue
            t, l = times[pid]; due = when - 6 * H
            for out, back in ((e72, 72), (e24, 24)):
                a, b = np.searchsorted(t, due - back * H), np.searchsorted(t, due)
                out.append(len(set(l[a:b]) - {lg}) / n)
        df.loc[part.index, 'early'] = e72; df.loc[part.index, 'early24'] = e24
        ranks, rel = [], []
        for leg, e in zip(part.leg.values, e72):
            r = ranking[leg]; c = e * n
            ranks.append(min(101, 1 + int(np.sum(r > c + 1e-9)))); rel.append(c / r[0] if len(r) and r[0] else 0.0)
        df.loc[part.index, 'trend_rank'] = ranks; df.loc[part.index, 'trend_rel'] = rel
        print(season, f'{n} leagues; mean early share {np.mean(e72):.3%}, rows with any {np.mean(np.array(e72) > 0):.1%}', flush=True)
    df.to_parquet(path)


if __name__ == '__main__':
    main()
