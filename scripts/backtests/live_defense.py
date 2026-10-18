"""Defenses in the Live tab's projections: 2022-2025, this league's scoring.

A defense's points allowed are scored in brackets (shutout 10 ... 35+ -4), and every
defense starts its game in the shutout bracket, so the Live tab projects where its points
allowed will end up instead of adding its projection on top. This checks the pieces:
how far Sleeper's projected points allowed lands from the actual (its bias and spread,
the Live tab's POINTS_ALLOWED_SD), and pre-game projections of league points three ways.
"""
import math, statistics as st
from common import J, leagues

sc = leagues['2026']['scoring_settings']
TIERS = [(0, 0, 'pts_allow_0'), (1, 6, 'pts_allow_1_6'), (7, 13, 'pts_allow_7_13'), (14, 20, 'pts_allow_14_20'),
         (21, 27, 'pts_allow_21_27'), (28, 34, 'pts_allow_28_34'), (35, 999, 'pts_allow_35p')]
cdf = lambda z: 0.5 * (1 + math.erf(z / math.sqrt(2)))
points = lambda s, skip_allowed=False: sum(v * sc[k] for k, v in s.items() if k in sc and not (skip_allowed and k.startswith('pts_allow')))
def bracket_points(pa):
    return next(sc.get(k, 0) for lo, hi, k in TIERS if lo <= pa <= hi)
def expected_brackets(mu, sd):
    e = 0
    for lo, hi, k in TIERS:
        upper = 1 if hi == 999 else cdf((hi + 0.5 - mu) / sd)
        lower = 0 if lo == 0 else cdf((lo - 0.5 - mu) / sd)
        e += (upper - lower) * sc.get(k, 0)
    return e

rows = []
for s in ('2022', '2023', '2024', '2025'):
    for w in range(1, 18):
        try:
            P, S = J(f'proj_{s}_{w}'), J(f'stats_{s}_{w}')
        except FileNotFoundError:
            continue
        for r in P:
            if (r.get('player') or {}).get('position') != 'DEF': continue
            ps, a = r.get('stats') or {}, S.get(r['player_id'])
            if not a or 'pts_allow' not in ps or not a.get('gp'): continue
            rows.append((ps['pts_allow'], a.get('pts_allow', 0), ps.get('pts_half_ppr', 0), points(ps, True), points(a)))

err = [act - proj for proj, act, *_ in rows]
sd = st.stdev(err)
print(f'{len(rows)} defense-games; projected points allowed vs actual: bias {st.mean(err):+.2f}, spread {sd:.2f}')
actual = [r[4] for r in rows]
print(f'actual league points per game: {st.mean(actual):.2f}')
for label, pred in (("Sleeper's projection (standard scoring)", [r[2] for r in rows]),
                    ('league scoring, bracket of the projected points allowed', [r[3] + bracket_points(round(r[0])) for r in rows]),
                    ('league scoring, expected over brackets (the Live tab)', [r[3] + expected_brackets(r[0], sd) for r in rows])):
    print(f'{label}: {st.mean(pred):.2f}, bias {st.mean(a - p for a, p in zip(actual, pred)):+.2f}, mean abs error {st.mean(abs(a - p) for a, p in zip(actual, pred)):.2f}')
