"""Does team strength drift through the season, and should the simulation let it?

strength_model.py's best model ('fitted + tau') gives each team one random offset per
simulated season, the same in every remaining week. Weekly residuals say otherwise: their
covariance falls with the gap between weeks (injuries, trades, waivers change a team), so a
week soon after the snapshot is better known than one far off.

Every model here uses the fitted means (lineup + points per game, leave one season out);
only the uncertainty around them differs. Measured on the training seasons' residuals
(weekly score - league average so far - fitted offset, centred within each league-week),
from their covariance between weeks j < k after the snapshot (week 0 = the first remaining
week; same-week variance is left out, as it holds the weekly noise):

  fixed, tau_for     the current model: one offset, sd from strength_model.tau_for
  fixed, moments     one offset, sd^2 = the average covariance (a control for the method)
  AR(1)              fixed part + a part that drifts and reverts: tc^2 + td^2 rho^(k-j)
  random walk        fixed part + a walk from the first remaining week: t0^2 + s^2 j

Nothing is tuned on Brier. Rule, set before the run: a drift model replaces the fixed offset
only if it beats it out of sample with a 95% interval (resampling leagues) excluding zero, in
at least 5 of 8 seasons.

    python drift.py [--sims 10000]
"""
import argparse, math, time
import numpy as np
import torch
import gpu_sim as G
import leagues_fit as LF


def covariances(P, rows, off):
    """Average residual covariance between remaining weeks j < k, and how many products each has"""
    m = P['teams'][rows][:, None, :] & P['weeks'][rows][:, :, None]
    R = (P['pts'][rows] - P['lg'][rows][:, None, None] - off[:, None, :]) * m
    n = m.sum(2, keepdims=True).clip(1)
    R = (R - R.sum(2, keepdims=True) / n) * m * np.sqrt(n / (n - 1).clip(1))  # centred within league-week, unshrunk
    Rt, mt = torch.as_tensor(R, device=G.DEV), torch.as_tensor(m, device=G.DEV, dtype=torch.float64)
    C = torch.einsum('bjt,bkt->jk', Rt, Rt).cpu().numpy(); N = torch.einsum('bjt,bkt->jk', mt, mt).cpu().numpy()
    j, k = np.triu_indices(C.shape[0], 1); keep = N[j, k] > 0
    return j[keep], k[keep], C[j, k][keep] / N[j, k][keep], N[j, k][keep]


def wls(A, c, w):
    """Weighted least squares with non-negative coefficients (two columns: drop one if negative)"""
    sw = np.sqrt(w)
    b, *_ = np.linalg.lstsq(A * sw[:, None], c * sw, rcond=None)
    if (b >= 0).all(): return b, np.sum(w * (A @ b - c) ** 2)
    best = None
    for i in range(A.shape[1]):
        bi = max(np.sum(w * A[:, i] * c) / np.sum(w * A[:, i] ** 2), 0); full = np.zeros(A.shape[1]); full[i] = bi
        sse = np.sum(w * (A @ full - c) ** 2)
        if best is None or sse < best[1]: best = (full, sse)
    return best


def measure(j, k, c, w):
    fixed = math.sqrt(max(np.average(c, weights=w), 0))
    ar = min((wls(np.c_[np.ones_like(c), rho ** (k - j)], c, w) + (rho,) for rho in np.arange(0, 0.99, 0.01)), key=lambda x: x[1])
    (tc2, td2), _, rho = ar
    (t02, s2), _ = wls(np.c_[np.ones_like(c), j.astype(float)], c, w)
    return dict(fixed=fixed, tc=math.sqrt(tc2), td=math.sqrt(td2), rho=rho, t0=math.sqrt(t02), s=math.sqrt(s2))


NAMES = ['fixed, tau_for', 'fixed, moments', 'AR(1)', 'random walk']


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--sims', type=int, default=10000); a = ap.parse_args()
    t0 = time.time()
    P = G.pack(G.S.collect()); B, T = P['y'].shape; M = len(NAMES)
    off = np.zeros((M, B, T)); tau = np.zeros((M, B)); td, rho, rw = np.zeros((M, B)), np.zeros((M, B)), np.zeros((M, B))
    print('measured on the training seasons (points per week):')
    for s in np.unique(P['season']):
        for e in LF.SNAPSHOTS:
            train = (P['season'] != s) & (P['e'] == e); test = (P['season'] == s) & (P['e'] == e)
            b = G.fit(P, train, [0, 1])
            off[:, test] = P['X'][test][:, :, [0, 1]] @ b
            q = measure(*covariances(P, train, P['X'][train][:, :, [0, 1]] @ b))
            tau[0, test] = G.tau_for(P, train, [0, 1], b); tau[1, test] = q['fixed']
            tau[2, test] = q['tc']; td[2, test] = q['td']; rho[2, test] = q['rho']
            tau[3, test] = q['t0']; rw[3, test] = q['s']
            if s == P['season'].max():
                print(f"  week {e:2d} (held out {s}): fixed tau_for {tau[0, test][0]:.1f}, moments {q['fixed']:.1f};"
                      f" AR(1) fixed {q['tc']:.1f} + drifting {q['td']:.1f} (rho {q['rho']:.2f});"
                      f" walk {q['t0']:.1f} + {q['s']:.1f} a week")
    off *= P['teams']
    prob = G.simulate(P, off, tau, sims=a.sims, drift=(td, rho, rw)); br = G.brier(P, prob)
    print(f'\nplayoff Brier, out of sample, {a.sims} simulated seasons:')
    print(f"{'from week':>9}  " + '  '.join(f'{n:>15}' for n in NAMES))
    for e in list(LF.SNAPSHOTS) + ['all']:
        sel = (P['e'] == e) if e != 'all' else np.ones(B, bool)
        print(f'{str(e):>9}  ' + '  '.join(f'{br[m, sel].mean():15.4f}' for m in range(M)))
    seasons = np.unique(P['season'])
    # Against the current model, and against the fixed offset measured the same way (drift alone)
    for base, ms in ((0, range(1, M)), (1, range(2, M))):
        print(f'\nagainst {NAMES[base]}, 95% interval resampling leagues:')
        for m in ms:
            d = br[m] - br[base]
            for e in list(LF.SNAPSHOTS) + ['all']:
                sel = (P['e'] == e) if e != 'all' else np.ones(B, bool)
                mean, lo, hi = G.interval(P, d, sel)
                print(f'  week {str(e):>3}  {NAMES[m]:>15}: {mean:+.5f}  [{lo:+.5f}, {hi:+.5f}]')
            print(f'  {NAMES[m]} better in {sum(d[P["season"] == s].mean() < 0 for s in seasons)} of {len(seasons)} seasons')
    print(f'\n{time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
