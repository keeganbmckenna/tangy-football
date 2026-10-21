"""strength_model.py's season simulator on the GPU (PyTorch), for every league snapshot at once.

The CPU simulator loops in Python over snapshots, weeks and games. Here every snapshot is
padded to 14 teams and the longest remaining schedule, each team's opponent per week is an
index (-1 for a bye or a padded week), and all snapshots, simulated seasons and models step
through the weeks together. Same model as strength_model.brier: each remaining week a team
scores the league average so far + its offset + weekly noise (the league's spread) + one
persistent offset per team per simulated season (sd tau); the top n_po by wins, then points,
make the playoffs. Models share their random draws within a snapshot, so differences
between them are paired.

    python gpu_sim.py                 # strength_model.py's table and intervals (leave one season out)
    python gpu_sim.py --sims 10000    # more simulated seasons per snapshot
    python gpu_sim.py --check         # same random draws as the CPU simulator: results must match

Requires torch (CUDA if available, otherwise it runs on the CPU, slowly).
"""
import argparse, math, time
import numpy as np
import torch
import strength_model as S
import leagues_fit as LF

DEV = torch.device('cuda' if torch.cuda.is_available() else 'cpu')


def record(r, through):
    """Wins (ties count half) and points for each team through a week"""
    T = len(r['ids']); W = np.zeros(T); PF = np.zeros(T)
    for w in range(1, through + 1):
        p = [r['pts'][w][i] for i in r['ids']]
        for a, b in r['games'][w]:
            W[a] += 1 if p[a] > p[b] else 0.5 if p[a] == p[b] else 0; W[b] += 1 if p[b] > p[a] else 0.5 if p[a] == p[b] else 0
        PF += p
    return W, PF


def pack(data):
    """Pad every snapshot into arrays: opponents per remaining week, standings so far, outcomes"""
    B = len(data); T = max(len(r['ids']) for r in data); K = max(r['end'] - r['e'] + 1 for r in data)
    opp = np.full((B, K, T), -1, np.int64); weeks = np.zeros((B, K), bool); teams = np.zeros((B, T), bool)
    W0, PF0, made = np.zeros((B, T)), np.zeros((B, T)), np.zeros((B, T))
    X = np.zeros((B, T, len(S.FEATURES))); y = np.zeros((B, T)); pts = np.zeros((B, K, T))
    for i, r in enumerate(data):
        n = len(r['ids']); teams[i, :n] = True; X[i, :n] = r['X']; y[i, :n] = r['y']
        for k, w in enumerate(range(r['e'], r['end'] + 1)):
            weeks[i, k] = True; pts[i, k, :n] = [r['pts'][w][j] for j in r['ids']]
            for a, b in r['games'][w]: opp[i, k, a] = b; opp[i, k, b] = a
        Wf, PFf = record(r, r['end']); made[i, np.lexsort((-PFf, -Wf))[:r['n_po']]] = 1
        W0[i, :n], PF0[i, :n] = record(r, r['e'] - 1)
    sd = np.array([S.spread(r) for r in data])
    return dict(opp=opp, weeks=weeks, teams=teams, pts=pts, W0=W0, PF0=PF0, made=made, X=X, y=y, sd=sd,
                lg=np.array([r['lg'] for r in data]), n_po=np.array([r['n_po'] for r in data]),
                rem=np.array([r['end'] - r['e'] + 1 for r in data]), e=np.array([r['e'] for r in data]),
                season=np.array([int(r['season']) for r in data]), league=np.array([r['league'] for r in data]))


def simulate(P, off, tau, sims=1000, seed=0, chunk=None, noise=None, dtype=torch.float32, drift=None):
    """Playoff odds for M models: off (M, B, T) expected offsets, tau (M, B) persistent team sd.
    Returns (M, B, T) probabilities. noise=(z, team) with z (sims, B, K, T) and team (sims, B, T)
    replaces the random draws (for --check). drift=(td, rho, rw), each (M, B), adds strength that
    changes through the season: an AR(1) offset with sd td and week-to-week correlation rho, and
    a random walk starting at 0 in the first remaining week, growing by sd rw a week."""
    M, B, T = off.shape; K = P['opp'].shape[1]
    t = lambda a, dt=dtype: torch.as_tensor(a, device=DEV, dtype=dt)
    off, tau = t(off), t(tau)
    if drift: td, rho, rw = (t(x) for x in drift)
    gen = torch.Generator(device=DEV); gen.manual_seed(seed)
    chunk = chunk or max(1, int(1.5e8 // (M * sims * T)))
    out = torch.empty((M, B, T), device=DEV, dtype=dtype)
    for s in range(0, B, chunk):
        sl = slice(s, min(s + chunk, B)); b = sl.stop - sl.start
        opp = t(P['opp'][sl], torch.int64); weeks = t(P['weeks'][sl]); teams = t(P['teams'][sl], torch.bool)
        lg, sd, n_po = t(P['lg'][sl]), t(P['sd'][sl]), t(P['n_po'][sl], torch.int64)
        Wv = t(P['W0'][sl]).expand(M, sims, b, T).clone(); PFv = t(P['PF0'][sl]).expand(M, sims, b, T).clone()
        team = t(noise[1][:, sl]) if noise else torch.randn((sims, b, T), device=DEV, dtype=dtype, generator=gen)
        base = (lg[None, :, None] + off[:, sl])[:, None] + tau[:, None, sl, None] * team[None]  # (M, sims, b, T)
        if drift:
            ar = torch.randn((M, sims, b, T), device=DEV, dtype=dtype, generator=gen); walk = torch.zeros_like(ar)
            a_td, a_rho, a_rw = (x[:, None, sl, None] for x in (td, rho, rw))
        for k in range(K):
            if not bool(weeks[:, k].any()): break
            z = t(noise[0][:, sl, k]) if noise else torch.randn((sims, b, T), device=DEV, dtype=dtype, generator=gen)
            sc = base + sd[None, None, :, None] * z[None]
            if drift:
                if k:
                    ar = a_rho * ar + torch.sqrt(1 - a_rho ** 2) * torch.randn(ar.shape, device=DEV, dtype=dtype, generator=gen)
                    walk = walk + torch.randn(ar.shape, device=DEV, dtype=dtype, generator=gen)
                sc = sc + a_td * ar + a_rw * walk
            o = opp[:, k]; has = (o >= 0)
            theirs = sc.gather(-1, o.clamp(min=0).expand(M, sims, b, T))
            Wv += ((sc > theirs) & has).to(dtype)
            PFv += sc * weeks[:, k].to(dtype)[None, None, :, None]
        key = Wv + PFv / (PFv.max(-1, keepdim=True).values + 1)
        key = key.masked_fill(~teams, -math.inf)
        rank = key.argsort(-1, descending=True).argsort(-1)
        out[:, sl] = (rank < n_po[None, None, :, None]).to(dtype).mean(1)
    return out


def brier(P, prob):
    """Brier score per model and snapshot, averaged over a snapshot's teams (as strength_model.brier)"""
    made, teams = (torch.as_tensor(P[k], device=DEV) for k in ('made', 'teams'))
    sq = (prob.double() - made) ** 2 * teams
    return (sq.sum(-1) / teams.sum(-1)).cpu().numpy()


def fit(P, rows, cols):
    m = P['teams'][rows]
    b, *_ = np.linalg.lstsq(P['X'][rows][m][:, cols], P['y'][rows][m], rcond=None)
    return b


def tau_for(P, rows, cols, b):
    """strength_model.tau_for on the packed arrays"""
    m = P['teams'][rows]; res = (P['y'][rows] - P['X'][rows][:, :, cols] @ b) * m
    excess = (res ** 2).sum(1) / m.sum(1) - P['sd'][rows] ** 2 / P['rem'][rows]
    return math.sqrt(max(excess.mean(), 0))


NAMES = ['coin flip', 'lineup 0.3', 'fitted lineup+ppg', 'fitted + tau', 'perfect strength']


def offsets(P):
    """Each model's offsets, fitted leaving the snapshot's season out (as strength_model.main)"""
    B, T = P['y'].shape
    off = np.zeros((len(NAMES), B, T)); tau = np.zeros((len(NAMES), B))
    off[1] = 0.3 * P['X'][:, :, 0]; off[4] = P['y']
    for s in np.unique(P['season']):
        for e in LF.SNAPSHOTS:
            train = (P['season'] != s) & (P['e'] == e); test = (P['season'] == s) & (P['e'] == e)
            b = fit(P, train, [0, 1])
            off[2, test] = off[3, test] = P['X'][test][:, :, [0, 1]] @ b
            tau[3, test] = tau_for(P, train, [0, 1], b)
    return off * P['teams'], tau


def interval(P, d, sel, n=4000, seed=0):
    """Mean difference with a 95% interval resampling leagues"""
    _, g = np.unique(P['league'][sel], return_inverse=True)
    sums = torch.as_tensor(np.bincount(g, d[sel]), device=DEV); cnts = torch.as_tensor(np.bincount(g), device=DEV, dtype=torch.float64)
    idx = torch.randint(len(sums), (n, len(sums)), device=DEV, generator=torch.Generator(device=DEV).manual_seed(seed))
    bs = (sums[idx].sum(1) / cnts[idx].sum(1)).cpu().numpy()
    return d[sel].mean(), *np.percentile(bs, [2.5, 97.5])


def check(data, n=300, seed=5):
    """Feed the CPU simulator and this one the same random draws: per-snapshot Brier must match"""
    rows = list(np.random.default_rng(seed).choice(len(data), n, replace=False))
    sub = [data[i] for i in rows]; P = pack(sub); B, K, T = P['opp'].shape
    off = np.stack([np.zeros((B, T)), 0.3 * P['X'][:, :, 0], P['y']]); tau = np.stack([np.zeros(B), np.full(B, 9.0), np.zeros(B)])
    rng = np.random.default_rng(seed); z = np.zeros((LF.N, B, K, T)); team = np.zeros((LF.N, B, T)); cpu = []
    for i, r in enumerate(sub):
        nt = len(r['ids']); ws = range(r['e'], r['end'] + 1)
        nz = {w: rng.standard_normal((LF.N, nt)) for w in ws}; tn = rng.standard_normal((LF.N, nt))
        for k, w in enumerate(ws): z[:, i, k, :nt] = nz[w]
        team[:, i, :nt] = tn
        o = {'a': off[0, i, :nt], 'b': off[1, i, :nt], 'c': off[2, i, :nt]}
        cpu.append([v for v in S.brier(r, o, nz, {'b': 9.0}, tn).values()])
    gpu = brier(P, simulate(P, off, tau, sims=LF.N, noise=(z, team), dtype=torch.float64)).T
    diff = np.abs(np.array(cpu) - gpu)
    print(f'{n} snapshots, same random draws: largest per-snapshot Brier difference {diff.max():.2e} '
          f'(models: coin flip, lineup 0.3 + tau 9, perfect strength)')
    return diff.max() < 1e-9


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sims', type=int, default=LF.N)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--max-zero', type=float, default=LF.MAX_ZERO, help='drop league-seasons with more team-weeks at 0 (1 keeps all)')
    a = ap.parse_args()
    print(f'device: {torch.cuda.get_device_name(0) if DEV.type == "cuda" else "CPU"}')
    data = S.collect(a.max_zero)
    if a.check:
        raise SystemExit(0 if check(data) else 1)
    t0 = time.time(); P = pack(data); t1 = time.time()
    off, tau = offsets(P)
    prob = simulate(P, off, tau, sims=a.sims, seed=a.seed); torch.cuda.synchronize() if DEV.type == 'cuda' else None
    t2 = time.time(); br = brier(P, prob)
    print(f'{len(data)} snapshots: packed in {t1 - t0:.0f}s, simulated {a.sims} seasons each for {len(NAMES)} models in {t2 - t1:.1f}s')
    # Finite simulations add p(1-p)/sims to each team's expected squared error: the estimate without it
    p = prob.double().cpu().numpy(); teams = P['teams']
    mc = ((p * (1 - p) / (a.sims - 1)) * teams).sum(-1) / teams.sum(-1)
    print(f'\nplayoff Brier, out of sample (fitted on the other seasons), {a.sims} simulated seasons:')
    print(f"{'from week':>9}  " + '  '.join(f'{n:>17}' for n in NAMES))
    for e in list(LF.SNAPSHOTS) + ['all']:
        sel = (P['e'] == e) if e != 'all' else np.ones(len(br[0]), bool)
        print(f'{str(e):>9}  ' + '  '.join(f'{br[m, sel].mean():17.4f}' for m in range(len(NAMES))))
    print(f'  (finite-simulation noise adds about {mc[3].mean():.5f}; with infinitely many seasons, fitted + tau: {(br[3] - mc[3]).mean():.4f})')
    print('\ndifferences, 95% interval resampling leagues, seasons better:')
    for i, j in ((3, 1), (3, 2), (1, 0)):
        d = br[i] - br[j]
        for e in list(LF.SNAPSHOTS) + ['all']:
            sel = (P['e'] == e) if e != 'all' else np.ones(len(d), bool)
            m, lo, hi = interval(P, d, sel)
            print(f'  week {str(e):>3}  {NAMES[i]} - {NAMES[j]}: {m:+.4f}  [{lo:+.4f}, {hi:+.4f}]')
        wins = sum(d[P['season'] == s].mean() < 0 for s in np.unique(P['season']))
        print(f'  {NAMES[i]} better in {wins} of {len(np.unique(P["season"]))} seasons')
    print(f'\ntotal {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
