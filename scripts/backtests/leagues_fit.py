"""The playoff model on thousands of other Sleeper leagues (crawl_leagues.py), 2018-2025.

Our league has 48 team-seasons; the crawled leagues like ours (redraft, 10-14 teams, one QB,
half or full PPR, no divisions) have thousands. For each league-season, from snapshot weeks
4, 7 and 10: player values as the site sets them (half the snapshot week's Sleeper projection,
half season points per game padded with 3 games of projection, in the league's PPR), each
team's best lineup per remaining week (byes score 0), expected score = league average +
weight x (lineup - league's average lineup), the remaining real schedule simulated 1,000
times. Scored on who made the playoffs (top N by wins, then points) with Brier score.

Compared: the projection weight (0.1-1.1), projection-only values, bye-week holes filled
by the best free agent who can play them, both together, and persistent team uncertainty
(one random offset per team per simulated season, sd tau) instead of a lower weight. Intervals resample leagues. Run crawl_leagues.py
first.
"""
import glob, gzip, json, math, os, statistics as st, sys
from collections import defaultdict
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE = os.path.join(HERE, '..', '..', 'data', 'sleeper')
SNAPSHOTS = (4, 7, 10)
WEIGHTS = (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1.0, 1.1)
# Persistent team uncertainty: each simulated season draws one offset per team (sd tau, points
# per week), held for every remaining week, on top of the weekly noise
TAUS = (5, 10, 15)
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



# A league-season counts only if it was played: at most 10% of team-weeks at 0 points (a team
# that started nobody). About 1% of the crawled leagues fail, most with several teams abandoned.
MAX_ZERO = 0.1


def played(pts, ids, end, max_zero=MAX_ZERO):
    return np.mean([pts[w][r] == 0 for w in range(1, end + 1) for r in ids]) <= max_zero


def league_rows(path, rng):
    d = json.load(gzip.open(path, 'rt'))
    L, M = d['league'], {int(w): m for w, m in d['matchups'].items()}
    season = L['season']; ppr = L['scoring_settings'].get('rec'); slots = L['roster_positions']
    end = (L['settings'].get('playoff_week_start') or 15) - 1; n_po = L['settings'].get('playoff_teams') or 6
    if any(w not in M for w in range(1, end + 1)): return []
    ids = sorted(m['roster_id'] for m in M[1]); ix = {r: i for i, r in enumerate(ids)}; T = len(ids)
    pts = {w: {m['roster_id']: (m.get('points') or 0) for m in M[w]} for w in range(1, end + 1)}
    if not played(pts, ids, end): return []
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
    # How active the league is: starting slots left empty or given to a player on bye, per team-week
    team_of = {}
    for r in arch(season, f'projections/{end}'): team_of[r['player_id']] = r.get('team')
    sched = arch(season, 'schedule'); playing = defaultdict(set)
    for g in sched: playing[g['week']].update((g['home'], g['away']))
    holes = sum(1 for w in range(1, end + 1) for m in M[w] for p in (m.get('starters') or [])
                if p in ('0', '', None) or (team_of.get(p) or (p if p.isalpha() else None)) not in playing[w] and (team_of.get(p) or p.isalpha()))
    activity = holes / (T * end)
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
        B = {v: {} for v in ('blend', 'proj', 'byes', 'projbyes')}
        for w in range(e, end + 1):
            fa, fa_proj = defaultdict(list), defaultdict(list)
            for p, (pos, wk) in vals.items():
                if p not in rostered and wk.get(w, (0, 0))[0] > 0: fa[pos].append(wk[w][0]); fa_proj[pos].append(wk[w][1])
            for pos in fa: fa[pos].sort(reverse=True); fa_proj[pos].sort(reverse=True)
            bye = {r: [p for p in rosters.get(r, []) if p in vals and vals[p][1].get(e, (0, 0))[1] > 0 and vals[p][1].get(w, (0, 0))[1] == 0] for r in ids}
            B['blend'][w] = np.array([lineup(rosters.get(r, []), vals, slots, w, 0) for r in ids])
            B['proj'][w] = np.array([lineup(rosters.get(r, []), vals, slots, w, 1) for r in ids])
            B['byes'][w] = np.array([lineup(rosters.get(r, []), vals, slots, w, 0, fa, bye[r]) for r in ids])
            B['projbyes'][w] = np.array([lineup(rosters.get(r, []), vals, slots, w, 1, fa_proj, bye[r]) for r in ids])
        W0, PF0 = record(e - 1)
        noise = {w: rng.standard_normal((N, T)) for w in range(e, end + 1)}
        team_noise = rng.standard_normal((N, T))
        variants = {f'blend@{wt}': ('blend', wt) for wt in WEIGHTS}
        variants.update({f'proj@{wt}': ('proj', wt) for wt in (0.5, 0.75, 1.0)})
        variants.update({f'byes@{wt}': ('byes', wt) for wt in (0.5, 0.75, 1.0)})
        variants.update({f'projbyes@{wt}': ('projbyes', wt) for wt in (0.4, 0.5, 0.6)})
        variants.update({f'proj@{wt}': ('proj', wt) for wt in (0.4, 0.6)})
        variants.update({f'{k}@{wt}+tau{t}': (k, wt, t) for k in ('blend', 'projbyes') for wt in (0.75, 1.0) for t in TAUS})
        for name, spec in variants.items():
            kind, wt = spec[0], spec[1]; tau = spec[2] if len(spec) > 2 else 0
            Wv = np.repeat(W0[None], N, 0); PFv = np.repeat(PF0[None], N, 0)
            for w in range(e, end + 1):
                b = B[kind][w]; sc = (lg + wt * (b - b.mean()))[None] + sd * noise[w] + tau * team_noise
                for a, c in games[w]:
                    Wv[:, a] += sc[:, a] > sc[:, c]; Wv[:, c] += sc[:, c] > sc[:, a]
                PFv += sc
            # Seeds by wins, then points
            order = np.argsort(-(Wv + PFv / (PFv.max(1, keepdims=True) + 1)), axis=1)
            seeds = np.argsort(order, axis=1)
            p = (seeds < n_po).mean(0)
            rows.append((L['league_id'], season, e, name, float(np.mean((p - made) ** 2)), activity))
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
    for name in sorted(by, key=lambda n: (n.split('@')[0], float(n.split('@')[1].split('+')[0]), n)):
        x = np.array([np.mean(by[name][k]) for k in leagues]); d = x - base
        print(f'{name:12} {x.mean():13.4f}  {d.mean():+.4f} ({np.percentile(d[boot].mean(1), 2.5):+.4f} to {np.percentile(d[boot].mean(1), 97.5):+.4f})')
    # By how active the league is (holes per team-week), thirds
    act = {}
    for lid, season, e, name, br, a in rows: act[(lid, season)] = a
    cuts = np.quantile([act[k] for k in leagues], [1 / 3, 2 / 3])
    print(f'\nleague activity: holes per team-week, thirds cut at {cuts[0]:.3f} / {cuts[1]:.3f} (our league 2022-2025: 0.019)')
    for label, lo, hi in (('most active', -1, cuts[0]), ('middle', cuts[0], cuts[1]), ('least active', cuts[1], 9)):
        ks = [k for k in leagues if lo < act[k] <= hi]
        best = min(by, key=lambda n: np.mean([np.mean(by[n][k]) for k in ks]))
        print(f'  {label:12} ({len(ks)} leagues): ' + '  '.join(f"{n} {np.mean([np.mean(by[n][k]) for k in ks]):.4f}" for n in ('blend@0.5', 'blend@0.75', 'blend@1.0', 'byes@0.75', 'proj@0.75')) + f'   best: {best}')
    seasons = sorted({k[1] for k in leagues})
    print('\nby season (Brier; current = blend@0.75):')
    show = ('blend@0.75', 'blend@0.5', 'proj@0.5', 'byes@0.75', 'projbyes@0.5')
    print('  season leagues  ' + '  '.join(f'{n:>12}' for n in show))
    wins = defaultdict(int)
    for season in seasons:
        ks = [k for k in leagues if k[1] == season]
        m = {n: np.mean([np.mean(by[n][k]) for k in ks]) for n in show}
        for n in show[1:]: wins[n] += m[n] < m['blend@0.75']
        print(f'  {season}  {len(ks):6d}  ' + '  '.join(f'{m[n]:12.4f}' for n in show))
    print('  better than current in: ' + ', '.join(f'{n} {wins[n]} of {len(seasons)}' for n in show[1:]))
    # Leave one season out: pick the best variant on the other seasons, score the held-out one
    print('\nleave-one-season-out (variant picked on the other seasons):')
    tot_pick = tot_cur = n = 0
    for season in seasons:
        train = [k for k in leagues if k[1] != season]; test = [k for k in leagues if k[1] == season]
        pick = min(by, key=lambda v: np.mean([np.mean(by[v][k]) for k in train]))
        bp = np.mean([np.mean(by[pick][k]) for k in test]); bc = np.mean([np.mean(by['blend@0.75'][k]) for k in test])
        tot_pick += bp * len(test); tot_cur += bc * len(test); n += len(test)
        print(f'  held out {season}: picked {pick:13} {bp:.4f} vs current {bc:.4f}')
    print(f'  overall: picked {tot_pick / n:.4f} vs current {tot_cur / n:.4f} ({(tot_pick - tot_cur) / n:+.4f})')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'report':
        report(json.load(open(os.path.join(HERE, 'leagues_fit.json'))))
    else:
        main()
