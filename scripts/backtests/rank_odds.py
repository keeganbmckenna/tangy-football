"""Rank, wins, playoff and bye odds under our league's rules, scored without schedule luck.

Our rules, applied to every crawled league (whatever its own settings): head-to-head wins only
(no median game), ties broken by points for, top 6 make the playoffs, top 2 get byes. Each
league keeps its own teams, weekly scores and regular-season length.

Two evaluations, every model fitted leaving one season out (gpu_sim.offsets):

  development   Schedule luck removed. A real schedule is one random round robin (99% of the
                crawled leagues play everyone once before anyone twice), and outcomes swing
                a lot with it: with every weekly score known, the remaining schedule alone
                flips the playoff fate of half the teams. So the target is each league's
                actual remaining scores replayed under random round robins (team order and
                round order shuffled, the cycle repeating), and the forecast is made without
                the schedule (simulated on random round robins too). Scoring against that
                averaged target equals the average score over schedules: for Brier,
                E[(p - y)^2] = (p - q)^2 + q(1 - q); the ranked probability score is a sum of
                such terms. Same expected ranking of models, far less noise.
  final check   The real remaining schedule and the real outcome under our rules.

Scores (lower is better): Brier for playoffs and byes; ranked probability score over final
rank (Epstein 1969, divided by teams - 1); and over final wins in half-win steps, times 0.5
(a discrete CRPS, in wins). Intervals resample leagues.

    python rank_odds.py [--sims 4000] [--target-sims 2000]
"""
import argparse, math, time
import numpy as np
import torch
import gpu_sim as G
import leagues_fit as LF

DEV = G.DEV
PLAYOFF, BYE = 6, 2
NW = 37  # final wins in half-win steps, 0-18
METRICS = ['playoff Brier', 'bye Brier', 'rank RPS', 'wins CRPS']


def t(a, dt=torch.float32):
    return torch.as_tensor(a, device=DEV, dtype=dt)


def circle(n):
    """Round robin by the circle method: R[r, slot] = opponent slot in round r"""
    R = np.zeros((n - 1, n), np.int64); slots = list(range(n))
    for r in range(n - 1):
        for i in range(n // 2):
            a, b = slots[i], slots[n - 1 - i]; R[r, a] = b; R[r, b] = a
        slots = [slots[0], slots[-1]] + slots[1:-1]
    return R


def random_round_robin(gen, sims, b, n, weeks=18):
    """Opponents (sims, b, weeks, n) for season weeks 1..weeks: teams and round order shuffled,
    every team meets every other once per cycle of n - 1 weeks, then the cycle repeats"""
    R = t(circle(n), torch.int64)
    pos = torch.rand((sims, b, n), device=DEV, generator=gen).argsort(-1); inv = pos.argsort(-1)
    order = torch.rand((sims, b, n - 1), device=DEV, generator=gen).argsort(-1)
    return torch.stack([inv.gather(-1, R[order[..., (w - 1) % (n - 1)]].gather(-1, pos)) for w in range(1, weeks + 1)], 2)


def season(P, idx, n, sims, gen, schedule, model=None):
    """Final rank and wins distributions, (M, b, n, n) and (M, b, n, NW), for snapshots idx (all
    with n teams). model=(off (M, b, n), tau (M, b)) simulates the remaining scores as
    gpu_sim.simulate does; None replays the actual scores. schedule: 'real' or 'random'."""
    b = len(idx); K = P['opp'].shape[1]
    weeks = t(P['weeks'][idx])
    if model:
        off, tau = t(model[0]), t(model[1]); M = off.shape[0]
        lg, sd = t(P['lg'][idx]), t(P['sd'][idx])
        team = torch.randn((sims, b, n), device=DEV, generator=gen)
        base = (lg[:, None] + off)[:, None] + tau[:, None, :, None] * team[None]
    else:
        M = 1; pts = t(P['pts'][idx][:, :, :n])
    W = t(P['W0'][idx][:, :n]).expand(M, sims, b, n).clone(); PF = t(P['PF0'][idx][:, :n]).expand(M, sims, b, n).clone()
    if schedule == 'random':
        rr = random_round_robin(gen, sims, b, n); e = t(P['e'][idx], torch.int64)
    else:
        opp = t(P['opp'][idx][:, :, :n], torch.int64)
    for k in range(K):
        if not bool(weeks[:, k].any()): break
        sc = base + t(P['sd'][idx])[None, None, :, None] * torch.randn((sims, b, n), device=DEV, generator=gen)[None] if model \
            else pts[:, k][None, None].expand(M, sims, b, n)
        if schedule == 'random':
            o = rr.gather(2, (e + k - 1).clamp(max=rr.shape[2] - 1)[None, :, None, None].expand(sims, b, 1, n)).squeeze(2)
            o = o[None].expand(M, sims, b, n); has = (weeks[:, k] > 0)[None, None, :, None]
        else:
            o = opp[:, k][None, None].expand(M, sims, b, n); has = o >= 0
        theirs = sc.gather(-1, o.clamp(min=0))
        W += ((sc > theirs).float() + 0.5 * (sc == theirs).float()) * has
        PF += sc * weeks[:, k][None, None, :, None]
    key = W + PF / (PF.max(-1, keepdim=True).values + 1)
    rank = key.argsort(-1, descending=True).argsort(-1)
    tid = torch.arange(n, device=DEV)
    def hist(v, size):
        flat = (tid * size + v).permute(0, 2, 1, 3).reshape(M, b, sims * n)
        c = torch.zeros((M, b, n * size), device=DEV).scatter_add_(-1, flat, torch.ones_like(flat, dtype=torch.float32))
        return c.view(M, b, n, size) / sims
    return hist(rank, n), hist((2 * W).round().long().clamp(0, NW - 1), NW)


def score(F, G_, Fw, Gw, n):
    """Expected scores per model and snapshot (M, b, metric), averaged over the snapshot's teams;
    the target G_ (1, b, n, n) and Gw may be distributions (schedule-averaged) or one-hot (real)"""
    cF, cG = F.cumsum(-1), G_.cumsum(-1); wF, wG = Fw.cumsum(-1), Gw.cumsum(-1)
    b2 = lambda p, q: (p - q) ** 2 + q * (1 - q)
    out = [b2(cF[..., PLAYOFF - 1], cG[..., PLAYOFF - 1]), b2(cF[..., BYE - 1], cG[..., BYE - 1]),
           b2(cF[..., :-1], cG[..., :-1]).sum(-1) / (n - 1), 0.5 * b2(wF[..., :-1], wG[..., :-1]).sum(-1)]
    return torch.stack([o.mean(-1) for o in out], -1).cpu().numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sims', type=int, default=4000); ap.add_argument('--target-sims', type=int, default=2000)
    ap.add_argument('--seed', type=int, default=0)
    a = ap.parse_args(); t0 = time.time()
    P = G.pack(G.S.collect()); B = len(P['e'])
    off, tau = G.offsets(P); M = len(G.NAMES)
    gen = torch.Generator(device=DEV).manual_seed(a.seed)
    res = {ev: np.zeros((M, B, len(METRICS))) for ev in ('development', 'final check')}
    nteams = P['teams'].sum(1); mismatch = 0
    for n in sorted(set(nteams)):
        ids = np.where(nteams == n)[0]; chunk = max(1, int(1.5e8 // (M * a.sims * n)))
        for s in range(0, len(ids), chunk):
            ii = ids[s:s + chunk]; model = (off[:, ii, :n], tau[:, ii])
            real_r, real_w = season(P, ii, n, 1, gen, 'real')
            # the real schedule and actual scores must reproduce who made it (the league's own cutoff)
            own = (real_r[0].cumsum(-1).gather(-1, t(P['n_po'][ii] - 1, torch.int64)[:, None, None].expand(len(ii), n, 1)).squeeze(-1)).cpu().numpy()
            mismatch += int((own != P['made'][ii][:, :n]).any(1).sum())
            avg_r, avg_w = season(P, ii, n, a.target_sims, gen, 'random')
            Fr, Fw = season(P, ii, n, a.sims, gen, 'random', model)
            res['development'][:, ii] = score(Fr, avg_r, Fw, avg_w, n)
            Fr, Fw = season(P, ii, n, a.sims, gen, 'real', model)
            res['final check'][:, ii] = score(Fr, real_r, Fw, real_w, n)
    print(f'{B} snapshots; real schedules reproduce the actual outcome in all but {mismatch}. '
          f'{a.sims} simulated seasons per forecast, {a.target_sims} random round robins per target, {time.time() - t0:.0f}s')
    for ev, r in res.items():
        print(f'\n{ev}' + (' (schedule-averaged target, forecasts without the schedule)' if ev == 'development' else ' (real schedule, real outcome)'))
        print(f"{'':>20}" + ''.join(f'{m:>15}' for m in METRICS))
        for m in range(M): print(f'{G.NAMES[m]:>20}' + ''.join(f'{r[m, :, j].mean():15.4f}' for j in range(len(METRICS))))
        print(f"{'playoff Brier by week':>20}" + ''.join(f'   week {e}: ' + ' / '.join(f'{r[m, P["e"] == e, 0].mean():.4f}' for m in (0, 1, 3)) for e in LF.SNAPSHOTS) + '  (coin flip / lineup 0.3 / fitted + tau)')
    print('\ndifferences, 95% interval resampling leagues (seasons better of 8); interval width, final check / development:')
    seasons = np.unique(P['season']); everything = np.ones(B, bool)
    for i, j in ((3, 1), (3, 2), (1, 0)):
        for k, met in enumerate(METRICS):
            line = f'  {G.NAMES[i]} - {G.NAMES[j]}, {met:>13}:'; widths = []
            for ev in ('development', 'final check'):
                d = res[ev][i, :, k] - res[ev][j, :, k]; m, lo, hi = G.interval(P, d, everything); widths.append(hi - lo)
                line += f'  {ev[:5]} {m:+.5f} [{lo:+.5f}, {hi:+.5f}] ({sum(d[P["season"] == s].mean() < 0 for s in seasons)})'
            print(line + f'  width x{widths[1] / widths[0]:.1f}')


if __name__ == '__main__':
    main()
