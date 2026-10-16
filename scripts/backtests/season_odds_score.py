import pickle, numpy as np, random
out = pickle.load(open('season.pkl', 'rb'))
def metrics(rows, key):  # key 2=playoffs, 3=bye
    p = np.concatenate([r[key] for r in rows]); y = np.concatenate([r[key + 2] for r in rows])
    pc = np.clip(p, 0.005, 0.995)
    return np.mean((p - y) ** 2), -np.mean(y * np.log(pc) + (1 - y) * np.log(1 - pc)), p, y
print(f'{"":26} playoffs: Brier  logloss | bye: Brier  logloss   (early wks 2-6 Brier | late wks 7-13 Brier)')
for k, rows in out.items():
    b, l, p, y = metrics(rows, 2); b2, l2, _, _ = metrics(rows, 3)
    e = metrics([r for r in rows if r[1] <= 6], 2)[0]; la = metrics([r for r in rows if r[1] >= 7], 2)[0]
    print(f'{k:26}         %.4f  %.4f  |      %.4f  %.4f   (%.4f | %.4f)' % (b, l, b2, l2, e, la))
for k in ('current', 'widen later weeks x1.6', 'shrink later means x0.6'):
    _, _, p, y = metrics(out[k], 2); print(k)
    for lo, hi in [(0, .05), (.05, .25), (.25, .5), (.5, .75), (.75, .95), (.95, 1.01)]:
        m = (p >= lo) & (p < hi)
        if m.sum():
            print('   said %3.0f-%3.0f%%: n=%3d  avg said %4.1f%%  happened %4.1f%%' % (100 * lo, 100 * hi, m.sum(), 100 * p[m].mean(), 100 * y[m].mean()))
# paired bootstrap by snapshot: current vs best
names = list(out); bestk = min(names, key=lambda k: metrics(out[k], 2)[0])
random.seed(3); n = len(out['current']); d = []
for _ in range(2000):
    ii = random.choices(range(n), k=n)
    d.append(metrics([out['current'][i] for i in ii], 2)[0] - metrics([out[bestk][i] for i in ii], 2)[0])
print('best:', bestk, ' Brier improvement vs current 95%% CI %.4f to %.4f, P(better)=%.2f' % (*np.percentile(d, [2.5, 97.5]), np.mean(np.array(d) > 0)))
