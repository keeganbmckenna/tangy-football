"""How low can the playoff-odds Brier go? Bounds from the 2,025 crawled league-seasons.

For each league and snapshot week (4, 7, 10), the same simulator with three kinds of
expected scores:

  coin flip        every team equal: only the standings so far count
  perfect strength each team's actual average over the rest of the season (unknowable in
                   advance), with the usual weekly noise: the best any strength model could
                   do, since the week-to-week swings stay random
  model            the site's lineup model at weight 0.75 and 0.3 (leagues_fit.py)

The gap between the model and perfect strength is all better modeling could ever win.
"""
import glob, gzip, json, math, os, statistics as st
from collections import defaultdict
import numpy as np
import leagues_fit as LF

HERE = os.path.dirname(os.path.abspath(__file__))


def rows_for(path, rng):
    d = json.load(gzip.open(path, 'rt'))
    L, M = d['league'], {int(w): m for w, m in d['matchups'].items()}
    season = L['season']; ppr = L['scoring_settings'].get('rec'); slots = L['roster_positions']
    end = (L['settings'].get('playoff_week_start') or 15) - 1; n_po = L['settings'].get('playoff_teams') or 6
    if any(w not in M for w in range(1, end + 1)): return []
    ids = sorted(m['roster_id'] for m in M[1]); ix = {r: i for i, r in enumerate(ids)}; T = len(ids)
    pts = {w: {m['roster_id']: (m.get('points') or 0) for m in M[w]} for w in range(1, end + 1)}
    if not LF.played(pts, ids, end) or L['league_id'] in LF.OURS: return []
    games = {}
    for w in range(1, end + 1):
        by = defaultdict(list)
        for m in M[w]:
            if m.get('matchup_id') is not None: by[m['matchup_id']].append(ix[m['roster_id']])
        games[w] = [tuple(v) for v in by.values() if len(v) == 2]
    def record(through):
        W = np.zeros(T); PF = np.zeros(T)
        for w in range(1, through + 1):
            for a, b in games[w]:
                pa, pb = pts[w][ids[a]], pts[w][ids[b]]
                W[a] += 1 if pa > pb else 0.5 if pa == pb else 0; W[b] += 1 if pb > pa else 0.5 if pa == pb else 0
            for r in ids: PF[ix[r]] += pts[w][r]
        return W, PF
    Wf, PFf = record(end)
    made = np.zeros(T); made[np.lexsort((-PFf, -Wf))[:n_po]] = 1
    out = []
    for e in LF.SNAPSHOTS:
        if e >= end - 1: continue
        vals = LF.table(season, e, ppr)
        rosters = {m['roster_id']: (m.get('players') or []) for m in M[e]}
        lg = st.mean(pts[w][r] for w in range(1, e) for r in ids)
        sq = sum((pts[w][r] - st.mean(pts[x][r] for x in range(1, e))) ** 2 for r in ids for w in range(1, e))
        sd = max(math.sqrt(sq / (T * (e - 2))), 15)
        future = np.array([st.mean(pts[w][r] for w in range(e, end + 1)) for r in ids])
        means = {'coin flip': {w: np.full(T, lg) for w in range(e, end + 1)},
                 'perfect strength': {w: future for w in range(e, end + 1)}}
        for wt in (0.75, 0.3):
            means[f'model {wt}'] = {}
            for w in range(e, end + 1):
                b = np.array([LF.lineup(rosters.get(r, []), vals, slots, w, 0) for r in ids])
                means[f'model {wt}'][w] = lg + wt * (b - b.mean())
        W0, PF0 = record(e - 1)
        noise = {w: rng.standard_normal((LF.N, T)) for w in range(e, end + 1)}
        for name, mw in means.items():
            Wv = np.repeat(W0[None], LF.N, 0); PFv = np.repeat(PF0[None], LF.N, 0)
            for w in range(e, end + 1):
                sc = mw[w][None] + sd * noise[w]
                for a, c in games[w]:
                    Wv[:, a] += sc[:, a] > sc[:, c]; Wv[:, c] += sc[:, c] > sc[:, a]
                PFv += sc
            seeds = np.argsort(np.argsort(-(Wv + PFv / (PFv.max(1, keepdims=True) + 1)), axis=1), axis=1)
            p = (seeds < n_po).mean(0)
            out.append((e, name, float(np.mean((p - made) ** 2))))
    return out


def main():
    rng = np.random.default_rng(61)
    rows = []
    for f in sorted(glob.glob(os.path.join(HERE, 'cache', 'leagues', '*', '*.json.gz'))):
        try: rows += rows_for(f, rng)
        except Exception as ex: print('skip', os.path.basename(f), ex)
    by = defaultdict(list)
    for e, name, br in rows: by[(e, name)].append(br)
    names = ['coin flip', 'model 0.75', 'model 0.3', 'perfect strength']
    print(f"{'from week':>9}  " + '  '.join(f'{n:>16}' for n in names) + '   share of the gap closed (0.75 -> 0.3)')
    for e in LF.SNAPSHOTS:
        m = {n: np.mean(by[(e, n)]) for n in names}
        gap = m['model 0.75'] - m['perfect strength']
        closed = (m['model 0.75'] - m['model 0.3']) / gap if gap > 0 else float('nan')
        print(f'{e:9d}  ' + '  '.join(f'{m[n]:16.4f}' for n in names) + f'   {closed:.0%}')
    m = {n: np.mean([v for (e, k), vs in by.items() if k == n for v in vs]) for n in names}
    print(f"{'all':>9}  " + '  '.join(f'{m[n]:16.4f}' for n in names))


if __name__ == '__main__':
    main()
