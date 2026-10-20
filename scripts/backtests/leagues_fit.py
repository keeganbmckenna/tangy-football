"""The playoff model on hundreds of other Sleeper leagues (crawl_leagues.py), 2022-2025.

Our league has 48 team-seasons; the crawled leagues like ours (redraft, 10-14 teams, one QB,
half or full PPR, no divisions) have thousands. For each league-season, from snapshot weeks
4, 7 and 10: player values as the site sets them (half the snapshot week's Sleeper projection,
half season points per game padded with 3 games of projection, in the league's PPR), each
team's best lineup per remaining week (byes score 0), expected score = league average +
weight x (lineup - league's average lineup), the remaining real schedule simulated 1,000
times. Scored on who made the playoffs (top N by wins, then points) with Brier score.

Compared: the projection weight (0.5-1.1), projection-only values, and bye-week holes filled
by the best free agent who can play them. Intervals resample leagues. Run crawl_leagues.py
first.
"""
import glob, gzip, json, math, os, statistics as st, sys
from collections import defaultdict
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE = os.path.join(HERE, '..', '..', 'data', 'sleeper')
SNAPSHOTS = (4, 7, 10)
WEIGHTS = (0.5, 0.6, 0.75, 0.9, 1.0, 1.1)
N = 1000
SLOT = {'FLEX': ('RB', 'WR', 'TE'), 'WRRB_FLEX': ('RB', 'WR'), 'REC_FLEX': ('WR', 'TE')}
POS = ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')

_arch = {}


def arch(season, name):
    key = (season, name)
    if key not in _arch:
        _arch[key] = json.load(gzip.open(os.path.join(ARCHIVE, season, f'{name}.json.gz'), 'rt'))
    return _arch[key]


_tables = {}


def table(season, e, ppr):
    """Player values for weeks e..18 from week e: id -> (position, {week: (value, projection only)})"""
    key = (season, e, ppr)
    if key in _tables: return _tables[key]
    col = 'pts_ppr' if ppr == 1.0 else 'pts_half_ppr'
    sched = arch(season, 'schedule'); playing = defaultdict(set)
    for g in sched: playing[g['week']].update((g['home'], g['away']))
    tot, gp = defaultdict(float), defaultdict(int)
    for w in range(1, e):
        for p, s in arch(season, f'stats/{w}').items():
            if s.get('gp'): tot[p] += s.get(col) or 0; gp[p] += 1
    out = {}
    for r in arch(season, f'projections/{e}'):
        pos = (r.get('player') or {}).get('position')
        if pos not in POS: continue
        pid = r['player_id']; pts = (r.get('stats') or {}).get(col) or 0
        if pos == 'DEF':  # defenses: games played = team games
            gp[pid] = sum(1 for w in range(1, e) if pid in playing[w])
        ppg = (tot[pid] + 3 * pts) / (gp[pid] + 3)
        team = r.get('team') or (pid if pos == 'DEF' else None)
        weeks = {}
        for w in range(e, 19):
            on = team in playing[w]
            weeks[w] = ((0.5 * pts + 0.5 * ppg) if (on and pts > 0) else 0.0, pts if on else 0.0)
        out[pid] = (pos, weeks)
    _tables[key] = out
    return out


def lineup(players, vals, slots, w, k, fa=None, bye=None):
    """Best lineup points; with fa (position -> free agents' values that week, best first), a slot
    left empty only because a rostered player is on bye takes the best free agent who can play it"""
    pool = sorted(((vals[p][1][w][k], p, vals[p][0]) for p in players if p in vals and w in vals[p][1]), reverse=True)
    used, taken, tot = set(), defaultdict(int), 0.0
    for el in sorted((SLOT.get(s, (s,)) for s in slots if s not in ('BN', 'IR', 'TAXI')), key=len):
        pick = next(((v, p) for v, p, pos in pool if p not in used and pos in el), None)
        if pick and pick[0] > 0:
            used.add(pick[1]); tot += pick[0]
        elif fa is not None and any(vals[p][0] in el for p in bye):
            best = max(el, key=lambda pos: (fa.get(pos) or [0])[min(taken[pos], len(fa.get(pos) or [0]) - 1)])
            lst = fa.get(best) or [0]; tot += lst[min(taken[best], len(lst) - 1)]; taken[best] += 1
        elif pick:
            used.add(pick[1])
    return tot


def league_rows(path, rng):
    d = json.load(gzip.open(path, 'rt'))
    L, M = d['league'], {int(w): m for w, m in d['matchups'].items()}
    season = L['season']; ppr = L['scoring_settings'].get('rec'); slots = L['roster_positions']
    end = (L['settings'].get('playoff_week_start') or 15) - 1; n_po = L['settings'].get('playoff_teams') or 6
    if any(w not in M for w in range(1, end + 1)): return []
    ids = sorted(m['roster_id'] for m in M[1]); ix = {r: i for i, r in enumerate(ids)}; T = len(ids)
    pts = {w: {m['roster_id']: (m.get('points') or 0) for m in M[w]} for w in range(1, end + 1)}
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
    rows = []
    for e in SNAPSHOTS:
        if e >= end - 1: continue
        vals = table(season, e, ppr)
        rosters = {r: [p for p in (m.get('players') or [])] for m in M[e] for r in [m['roster_id']]}
        rostered = {p for ps in rosters.values() for p in ps}
        lg = st.mean(pts[w][r] for w in range(1, e) for r in ids)
        sq = sum((pts[w][r] - st.mean(pts[x][r] for x in range(1, e))) ** 2 for r in ids for w in range(1, e))
        sd = max(math.sqrt(sq / (T * (e - 2))), 15)
        B = {v: {} for v in ('blend', 'proj', 'byes')}
        for w in range(e, end + 1):
            fa = defaultdict(list)
            for p, (pos, wk) in vals.items():
                if p not in rostered and wk.get(w, (0, 0))[0] > 0: fa[pos].append(wk[w][0])
            for pos in fa: fa[pos].sort(reverse=True)
            bye = {r: [p for p in rosters.get(r, []) if p in vals and vals[p][1].get(e, (0, 0))[1] > 0 and vals[p][1].get(w, (0, 0))[1] == 0] for r in ids}
            B['blend'][w] = np.array([lineup(rosters.get(r, []), vals, slots, w, 0) for r in ids])
            B['proj'][w] = np.array([lineup(rosters.get(r, []), vals, slots, w, 1) for r in ids])
            B['byes'][w] = np.array([lineup(rosters.get(r, []), vals, slots, w, 0, fa, bye[r]) for r in ids])
        W0, PF0 = record(e - 1)
        noise = {w: rng.standard_normal((N, T)) for w in range(e, end + 1)}
        variants = {f'blend@{wt}': ('blend', wt) for wt in WEIGHTS}
        variants.update({'proj@0.75': ('proj', 0.75), 'proj@1.0': ('proj', 1.0), 'byes@0.75': ('byes', 0.75), 'byes@1.0': ('byes', 1.0)})
        for name, (kind, wt) in variants.items():
            Wv = np.repeat(W0[None], N, 0); PFv = np.repeat(PF0[None], N, 0)
            for w in range(e, end + 1):
                b = B[kind][w]; sc = (lg + wt * (b - b.mean()))[None] + sd * noise[w]
                for a, c in games[w]:
                    Wv[:, a] += sc[:, a] > sc[:, c]; Wv[:, c] += sc[:, c] > sc[:, a]
                PFv += sc
            # Seeds by wins, then points
            order = np.argsort(-(Wv + PFv / (PFv.max(1, keepdims=True) + 1)), axis=1)
            seeds = np.argsort(order, axis=1)
            p = (seeds < n_po).mean(0)
            rows.append((L['league_id'], season, e, name, float(np.mean((p - made) ** 2)), T))
    return rows


def main():
    rng = np.random.default_rng(51)
    files = sorted(glob.glob(os.path.join(HERE, 'cache', 'leagues', '*', '*.json.gz')))
    rows = []
    for i, f in enumerate(files):
        try:
            rows += league_rows(f, rng)
        except Exception as ex:
            print('skip', os.path.basename(f), ex)
        if i % 100 == 99: print(f'{i + 1}/{len(files)} leagues', flush=True)
    json.dump(rows, open(os.path.join(HERE, 'leagues_fit.json'), 'w'))
    report(rows)


def report(rows):
    by = defaultdict(lambda: defaultdict(list))  # variant -> league -> briers
    for lid, season, e, name, br, T in rows: by[name][(lid, season)].append(br)
    leagues = sorted(by['blend@0.75']); print(f'\n{len(leagues)} league-seasons, {len(rows) // len(by)} snapshots')
    base = np.array([np.mean(by['blend@0.75'][k]) for k in leagues])
    boot = np.random.default_rng(2).integers(0, len(leagues), (4000, len(leagues)))
    print(f"{'variant':12} {'playoff Brier':>13}  vs current (weight 0.75), 95% by league")
    for name in sorted(by, key=lambda n: (n.split('@')[0], float(n.split('@')[1]))):
        x = np.array([np.mean(by[name][k]) for k in leagues]); d = x - base
        print(f'{name:12} {x.mean():13.4f}  {d.mean():+.4f} ({np.percentile(d[boot].mean(1), 2.5):+.4f} to {np.percentile(d[boot].mean(1), 97.5):+.4f})')
    for season in ('2022', '2023', '2024', '2025'):
        ks = [k for k in leagues if k[1] == season]
        if ks: print(f'  {season} ({len(ks)} leagues): ' + '  '.join(f"{n} {np.mean([np.mean(by[n][k]) for k in ks]):.4f}" for n in ('blend@0.75', 'blend@1.0', 'byes@0.75', 'byes@1.0')))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'report':
        report(json.load(open(os.path.join(HERE, 'leagues_fit.json'))))
    else:
        main()
