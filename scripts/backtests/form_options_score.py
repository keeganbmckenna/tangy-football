"""Scores form_options.py: error of each variant, and its difference from
'manager' (the current model) with a 95% interval from resampling trades /
snapshots."""
import json, random, sys
import numpy as np

VARIANTS = ['manager', 'travel', 'proj', 'blend75', 'blend50', 'blend25', 'blend50s1', 'blend50s6', 'blend50out', 'blend75+', 'blend50+']
for path in sys.argv[1:]:
    rows = json.load(open(path))
    test = rows[0][0]
    by = {}
    for r in rows:
        by.setdefault(r[4], {})[(r[2], r[3])] = r
    keys = sorted(by['manager']); groups = sorted({k[0] for k in keys})
    gk = {}
    for k in keys: gk.setdefault(k[0], []).append(k)
    def err(v, ks):
        xs = [by[v][k] for k in ks]
        return np.mean([(x[5] - x[6]) ** 2 for x in xs]), np.mean([(x[7] - x[8]) ** 2 for x in xs])
    print(f'\n== {test}: {len(groups)} {"trades" if test == "trades" else "snapshots"}, {len(keys)} team predictions')
    random.seed(9)
    boots = [[k for g in random.choices(groups, k=len(groups)) for k in gk[g]] for _ in range(1500)]
    base = [err('manager', ks) for ks in boots]
    for v in VARIANTS:
        w, b = err(v, keys)
        line = f'  {v:9} wins sq err {w:.3f}  playoffs Brier {b:.4f}'
        if v != 'manager':
            dw = [base[i][0] - err(v, ks)[0] for i, ks in enumerate(boots)]
            db = [base[i][1] - err(v, ks)[1] for i, ks in enumerate(boots)]
            line += f'   better than manager by: wins {np.mean(dw):+.3f} [{np.percentile(dw, 2.5):+.3f}, {np.percentile(dw, 97.5):+.3f}]  Brier {np.mean(db):+.4f} [{np.percentile(db, 2.5):+.4f}, {np.percentile(db, 97.5):+.4f}]'
        print(line)
