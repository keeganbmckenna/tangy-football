"""Manager skill: how much of a manager's record is skill that carries over, and how to estimate it.

For every owner in the crawled 12-team leagues (cache/leagues, cache/leagues_div, cache/history;
this league left out), each regular season's all-play win % (the share of the other teams it
outscored each week, ties half: its record on an average schedule) and its real win %.

Model, fixed before any scoring: a season's all-play win % = 0.5 + skill + noise, where skill
drifts season to season as AR(1) (variance v, year-to-year correlation phi) and noise is
independent (variance s2). From covariances of the same owner's seasons k years apart,
C(k) = v * phi^k (k = 1..3, least squares on the logs), and s2 = Var - v. A season known only by
its record (this league's 2017-2021) adds luck: the variance of real minus all-play win %.

Test: predict each season 2019-2025 from the same owner's earlier seasons only, with the
parameters fitted without that season, three ways: the league average (0.5), the owner's raw
mean of earlier seasons, and the AR(1) estimate (best linear predictor). Scored by mean squared
error, with a bootstrap over owners for the difference. Shipped if the estimate beats both
baselines in most seasons.

    python manager_skill.py
"""
import glob, gzip, json, os, sys
from collections import defaultdict
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import leagues_fit as LF  # noqa: E402  (OURS: this league's IDs)

SOURCES = ('leagues', 'leagues_div', 'history')
MAX_LAG = 3


def season_rows():
    """[(owner, season, all-play win %, real win %)] for 12-team leagues with every regular-season week played"""
    seen, rows = set(), []
    for f in (f for src in SOURCES for f in glob.glob(os.path.join(HERE, 'cache', src, '*', '*.json.gz'))):
        try:
            d = json.load(gzip.open(f, 'rt'))
        except Exception:
            continue
        L = d['league']; lid = L['league_id']
        if lid in seen or lid in LF.OURS: continue
        seen.add(lid)
        own = {r['roster_id']: r.get('owner_id') for r in d.get('rosters') or []}
        if len(own) != 12: continue
        end = (L['settings'].get('playoff_week_start') or 15) - 1
        M = {int(w): m for w, m in (d.get('matchups') or {}).items()}
        if end < 10 or any(w not in M for w in range(1, end + 1)): continue
        allplay, real, games = defaultdict(float), defaultdict(float), defaultdict(int)
        ok = True
        for w in range(1, end + 1):
            pts = {m['roster_id']: m.get('points') or 0 for m in M[w]}
            if len(pts) != 12 or np.mean(list(pts.values())) < 50: ok = False; break
            for r, p in pts.items():
                others = [q for o, q in pts.items() if o != r]
                allplay[r] += (sum(p > q for q in others) + 0.5 * sum(p == q for q in others)) / len(others)
            by = defaultdict(list)
            for m in M[w]:
                if m.get('matchup_id') is not None: by[m['matchup_id']].append(m)
            for pair in by.values():
                if len(pair) != 2: continue
                a, b = pair; pa, pb = a.get('points') or 0, b.get('points') or 0
                real[a['roster_id']] += 1 if pa > pb else 0.5 if pa == pb else 0
                real[b['roster_id']] += 1 if pb > pa else 0.5 if pa == pb else 0
                games[a['roster_id']] += 1; games[b['roster_id']] += 1
        if not ok: continue
        for r, o in own.items():
            if o and games[r]:
                rows.append((o, int(L['season']), allplay[r] / end, real[r] / games[r]))
    return rows


def by_owner(rows, skip=None):
    """owner -> {season: mean all-play win % - 0.5} (an owner in several leagues a season: their mean)"""
    acc = defaultdict(lambda: defaultdict(list))
    for o, s, ap, _ in rows:
        if s != skip: acc[o][s].append(ap - 0.5)
    return {o: {s: float(np.mean(v)) for s, v in ss.items()} for o, ss in acc.items()}


def fit(owners):
    """v (skill variance), phi (year-to-year), s2 (season noise) from same-owner covariances"""
    allv = np.array([x for ss in owners.values() for x in ss.values()])
    var = allv.var()
    cov = []
    for k in range(1, MAX_LAG + 1):
        pairs = [(ss[s], ss[s + k]) for ss in owners.values() for s in ss if s + k in ss]
        a = np.array(pairs)
        cov.append((k, float(np.mean(a[:, 0] * a[:, 1])), len(pairs)))
    ks = np.array([k for k, c, _ in cov if c > 0]); cs = np.array([c for k, c, _ in cov if c > 0])
    slope, intercept = np.polyfit(ks, np.log(cs), 1)
    v = float(np.exp(intercept)); phi = float(min(np.exp(slope), 1.0))
    v = min(v, var * 0.99)
    return {'v': v, 'phi': phi, 's2': float(var - v), 'var': float(var), 'cov': cov}


def predict(past, target, p, extra=None):
    """Best linear predictor of skill at season `target` from past {season: y}; extra: {season: added noise variance}"""
    ss = sorted(past)
    if not ss: return 0.0, p['v']
    y = np.array([past[s] for s in ss])
    S = np.array([[p['v'] * p['phi'] ** abs(a - b) for b in ss] for a in ss]) + np.diag([p['s2'] + (extra or {}).get(s, 0) for s in ss])
    c = np.array([p['v'] * p['phi'] ** abs(target - s) for s in ss])
    w = np.linalg.solve(S, c)
    return float(w @ y), float(p['v'] - c @ w)


def main():
    rows = season_rows()
    seasons = sorted({s for _, s, _, _ in rows})
    owners = by_owner(rows)
    luck = np.var([re - ap for _, _, ap, re in rows])
    print(f'{len(rows)} owner-seasons, {len(owners)} owners, seasons {seasons[0]}-{seasons[-1]}; '
          f'owners with 2+ seasons: {sum(len(v) > 1 for v in owners.values())}')
    p = fit(owners)
    print(f"all-play win % sd {np.sqrt(p['var']):.4f}; same-owner covariance by gap: "
          + ', '.join(f'{k}y {c:.5f} (n={n})' for k, c, n in p['cov']))
    print(f"fit: skill sd {np.sqrt(p['v']):.4f}, year-to-year {p['phi']:.3f}, season noise sd {np.sqrt(p['s2']):.4f}; "
          f"one season's reliability {p['v'] / p['var']:.3f}; luck (real - all-play) sd {np.sqrt(luck):.4f} "
          f"({np.sqrt(luck) * 14:.2f} wins over 14)")

    print('\nPredicting each season from earlier ones (parameters fitted without it); MSE x 1000:')
    print(f"{'season':>6} {'n':>6} {'average':>8} {'raw mean':>9} {'estimate':>9}  est - raw [95%]          est - avg [95%]")
    rng = np.random.default_rng(0)
    wins_raw = wins_avg = 0
    for s in [x for x in seasons if x >= seasons[0] + 2]:
        ps = fit(by_owner(rows, skip=s))
        target = by_owner([r for r in rows if r[1] == s])
        hist = by_owner([r for r in rows if r[1] < s])
        e_avg, e_raw, e_est = [], [], []
        for o, ss in target.items():
            past = hist.get(o)
            if not past: continue
            y = ss[s]
            e_avg.append(y ** 2)
            e_raw.append((y - np.mean(list(past.values()))) ** 2)
            e_est.append((y - predict(past, s, ps)[0]) ** 2)
        a, r, e = map(np.array, (e_avg, e_raw, e_est))
        if len(a) < 50: continue
        boot = lambda d: np.percentile([d[rng.integers(0, len(d), len(d))].mean() for _ in range(2000)], [2.5, 97.5]) * 1000
        lr, hr = boot(e - r); la, ha = boot(e - a)
        wins_raw += (e - r).mean() < 0; wins_avg += (e - a).mean() < 0
        print(f'{s:>6} {len(a):>6} {a.mean() * 1000:>8.3f} {r.mean() * 1000:>9.3f} {e.mean() * 1000:>9.3f}  '
              f'{(e - r).mean() * 1000:+.3f} [{lr:+.3f}, {hr:+.3f}]  {(e - a).mean() * 1000:+.3f} [{la:+.3f}, {ha:+.3f}]')
    print(f'\nestimate beats raw mean in {wins_raw}, league average in {wins_avg} seasons')
    print(f"\nconstants for web/lib/analyze/managerSkill.ts: SKILL_VAR = {p['v']:.6f}, YEAR_CORR = {p['phi']:.4f}, "
          f"SEASON_NOISE_VAR = {p['s2']:.6f}, LUCK_VAR = {luck:.6f}")


if __name__ == '__main__':
    main()
