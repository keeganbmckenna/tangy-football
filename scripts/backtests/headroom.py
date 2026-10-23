"""How much better can any team-strength model get? A ceiling for the playoff odds.

The fitted model (gpu_sim.offsets, 'fitted + tau') leaves each team's true strength for the
rest of the season uncertain by tau points a week (strength_model.tau_for), simulated as one
offset per team. Suppose that offset were real and a better model could learn a share rho of
its variance. In that world every forecaster is calibrated by construction, so its expected
Brier is the average of p(1 - p) over its own odds: the model that knows rho of the offset is
simulated with offsets pred + sqrt(rho) tau z (z drawn as the truth would be) and remaining
uncertainty sqrt(1 - rho) tau. rho = 0 is today's model, rho = 1 knows every team's true
strength. The check that this world is fair: at rho = 0 it should reproduce the fitted
model's real Brier on real outcomes.

Not all of tau is knowable at the snapshot: part is change still to come (injuries, trades,
waivers). drift.py's random walk splits it, measured on the training seasons' residuals: a
part present at the snapshot (t0) and a part that grows s^2 a week. Averaged over the K
remaining weeks the future part adds s^2 sum_j ((K - j) / K)^2, so the knowable share is
t0^2 / (t0^2 + that). 'Knowable' is the Brier with exactly that share known: the ceiling for
any model that knows everything about every team as it stands at the snapshot.

12-team leagues, every snapshot week (strength_model.collect(weekly=True)), real schedules,
our cutoff (top 6), leave one season out, no divisions (they change the Brier by under 0.0003).

    python headroom.py [--sims 2000] [--draws 8]
"""
import argparse, time
import numpy as np
import gpu_sim as G
import drift as D

RHOS = (0.0, 0.25, 0.5, 0.75, 1.0)


def knowable_share(P):
    """Share of tau^2 present at the snapshot (random-walk split), per snapshot, fitted leaving
    the snapshot's season out"""
    out = np.ones(len(P['e']))  # one week left: nothing still to change
    for s in np.unique(P['season']):
        for e in np.unique(P['e']):
            train = (P['season'] != s) & (P['e'] == e); test = (P['season'] == s) & (P['e'] == e)
            if not test.any() or P['rem'][test].max() < 2: continue
            b = G.fit(P, train, [0, 1])
            q = D.measure(*D.covariances(P, train, P['X'][train][:, :, [0, 1]] @ b))
            K = P['rem'][test]
            future = np.array([q['s'] ** 2 * sum(((k - j) / k) ** 2 for j in range(1, k)) for k in K])
            out[test] = q['t0'] ** 2 / (q['t0'] ** 2 + future) if q['t0'] + q['s'] > 0 else 1.0
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sims', type=int, default=2000); ap.add_argument('--draws', type=int, default=8)
    a = ap.parse_args(); t0 = time.time()
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12]
    n_week = np.bincount([r['e'] for r in data])
    data = [r for r in data if n_week[r['e']] >= 500]  # week 15: only a handful of 15-week seasons
    P = G.pack(data); B, T = P['y'].shape
    P['n_po'] = np.full(B, 6)  # our cutoff
    P['made'] = np.zeros((B, T))
    for i, r in enumerate(data):
        Wf, PFf = G.record(r, r['end']); P['made'][i, np.lexsort((-PFf, -Wf))[:6]] = 1
    off5, tau5 = G.offsets(P); pred, tau = off5[3], tau5[3]
    f = knowable_share(P)
    rng = np.random.default_rng(1)
    # forecasters: (label, share known per snapshot, draws)
    cases = [(f'rho {r:.2f}', np.full(B, r), 1 if r == 0 else a.draws) for r in RHOS] + [('knowable', f, a.draws)]
    offs, taus, owner = [], [], []
    for c, (label, rho, n) in enumerate(cases):
        for _ in range(n):
            z = rng.standard_normal((B, T))
            offs.append((pred + np.sqrt(rho)[:, None] * tau[:, None] * z) * P['teams'])
            taus.append(np.sqrt(1 - rho) * tau); owner.append(c)
    prob = G.simulate(P, np.stack(offs), np.stack(taus), sims=a.sims, seed=3).double().cpu().numpy()
    tm = P['teams']
    pq = (prob * (1 - prob) * a.sims / (a.sims - 1) * tm).sum(-1) / tm.sum(-1)  # expected Brier per forecaster, snapshot
    owner = np.array(owner)
    synth = np.stack([pq[owner == c].mean(0) for c in range(len(cases))])
    real = ((prob[0] - P['made']) ** 2 * tm).sum(-1) / tm.sum(-1)  # rho 0 = the fitted model, on real outcomes
    coin = G.simulate(P, np.zeros((1, B, T)), np.zeros((1, B)), sims=a.sims, seed=4)
    coin = ((coin[0].double().cpu().numpy() - P['made']) ** 2 * tm).sum(-1) / tm.sum(-1)
    weeks = np.unique(P['e'])
    print(f'{B} snapshots (12-team leagues, weeks {weeks.min()}-{weeks.max()}), {a.sims} simulated seasons, {a.draws} truth draws, {time.time() - t0:.0f}s')
    print('\nplayoff Brier. real: on real outcomes; the rest: expected Brier with a share of the fitted model\'s')
    print('remaining strength uncertainty known (rho 0 = the fitted model, 1 = true current strength known)')
    head = ['coin flip (real)', 'fitted (real)'] + [c[0] for c in cases]
    print(f"{'week':>5} {'known':>6}" + ''.join(f'{h:>17}' for h in head))
    rows = [(e, P['e'] == e) for e in weeks] + [('all', np.ones(B, bool))]
    for e, sel in rows:
        print(f'{str(e):>5} {f[sel].mean():6.2f}' + f'{coin[sel].mean():17.4f}{real[sel].mean():17.4f}' + ''.join(f'{synth[c, sel].mean():17.4f}' for c in range(len(cases))))
    # variance decomposition of the rest-of-season average (points per week, squared)
    m = tm.sum(1)
    vy = ((P['y'] ** 2 * tm).sum(1) / m); vp = ((pred - (pred * tm).sum(1, keepdims=True) / m[:, None]) ** 2 * tm).sum(1) / m
    noise = P['sd'] ** 2 / P['rem']
    print('\nwhat a team\'s rest-of-season average is made of (variance, pts/week squared; share of the total):')
    print(f"{'week':>5}{'total':>9}{'explained':>18}{'knowable, missed':>20}{'future change':>18}{'weekly luck':>16}")
    for e, sel in rows:
        tot = vy[sel].mean(); parts = [vp[sel].mean(), (f * tau ** 2)[sel].mean(), ((1 - f) * tau ** 2)[sel].mean(), noise[sel].mean()]
        print(f'{str(e):>5}{tot:9.1f}' + ''.join(f'{p:12.1f} ({p / tot:4.0%})' for p in parts))
    # The simulated world is a little less noisy than the real one (rho 0 vs the real Brier), so
    # gains are read as differences within it and applied to the real Brier
    print(f"\n{'':>5} {'fitted, real':>13} {'gain so far':>12} {'knowable gain':>14} {'ceiling (real)':>15} {'all strength':>13} {'sim gap':>8}")
    for e, sel in rows:
        g0 = coin[sel].mean() - real[sel].mean(); k = synth[0, sel].mean() - synth[-1, sel].mean(); full = synth[0, sel].mean() - synth[len(RHOS) - 1, sel].mean()
        print(f'{str(e):>5} {real[sel].mean():13.4f} {g0:12.4f} {k:14.4f} {real[sel].mean() - k:15.4f} {real[sel].mean() - full:13.4f} {real[sel].mean() - synth[0, sel].mean():8.4f}')
    print("  gain so far: fitted vs coin flip; knowable gain: from knowing every team's current strength;")
    print("  all strength: also knowing the change still to come; sim gap: real minus simulated Brier of the fitted model")


if __name__ == '__main__':
    main()
