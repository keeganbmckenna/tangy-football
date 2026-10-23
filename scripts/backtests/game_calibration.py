"""Single-game win odds from games.npy: calibration and the spread that fits best."""
import numpy as np, math
G = np.load('games.npy'); season, t0, h, won, dB, dN, dF, sd = G.T
erf = np.vectorize(math.erf)
def probs(w1, wl, byes_later, s1, sl):
    wt = np.where(h == 1, w1, wl); dp = np.where(h == 1, dB, dB if byes_later else dN)
    sc = np.where(h == 1, s1, sl)
    return np.clip(0.5 * (1 + erf((wt * dp + (1 - wt) * dF) / (sc * sd * math.sqrt(2)))), 1e-4, 1 - 1e-4)
ll = lambda p, m=slice(None): -np.mean(np.where(won[m] == 1, np.log(p[m]), np.log(1 - p[m])))
br = lambda p, m=slice(None): np.mean((p[m] - won[m]) ** 2)
grid = [(w1, wl, b, s1, sl) for w1 in (0.6, 0.7, 0.8, 0.9, 1.0) for wl in np.arange(0, 1.01, 0.1) for b in (True, False)
        for s1 in (1.0, 1.2, 1.4, 1.6, 1.8, 2.0) for sl in (1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.4)]
cur = (0.75, 0.75, True, 1.0, 1.0)
res = {'tuned': [], 'current': [], 'current, wider spread only': [], 'form only': []}
for s in (2022, 2023, 2024, 2025):
    tr, te = season != s, season == s
    bc = min(grid, key=lambda c: ll(probs(*c), tr))
    bs = min([(0.75, 0.75, True, x, x) for x in np.arange(1, 2.6, 0.1)], key=lambda c: ll(probs(*c), tr))
    for k, c in [('tuned', bc), ('current', cur), ('current, wider spread only', bs), ('form only', (0, 0, True, 1.0, 1.0))]:
        res[k].append((ll(probs(*c), te), br(probs(*c), te), te.sum()))
    print(s, 'tuned picks', [round(float(x), 2) for x in bc], ' spread-only picks x%.1f' % bs[3])
for k, v in res.items():
    n = sum(x[2] for x in v); print(f'{k:28} out-of-sample log loss %.4f  Brier %.4f' % (sum(a * c for a, _, c in v) / n, sum(b * c for _, b, c in v) / n))
allb = min(grid, key=lambda c: ll(probs(*c))); print('best on all 4 seasons:', [round(float(x), 2) for x in allb])
p = probs(*allb)
for lo, hi in [(0, .3), (.3, .4), (.4, .5), (.5, .6), (.6, .7), (.7, 1)]:
    m = (p >= lo) & (p < hi); print(f'  tuned p in [{lo},{hi}): n={m.sum():4} predicted %.2f actual %.2f' % (p[m].mean(), won[m].mean()))
for k in (1, 2, 3, 4, 6, 9):
    m = (h == k) if k < 9 else (h >= 9); print(f'  h={k}{"+" if k == 9 else " "} n={m.sum():4}  current ll %.4f  tuned ll %.4f' % (ll(probs(*cur), m), ll(p, m)))
