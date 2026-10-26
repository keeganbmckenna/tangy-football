"""Scores the live win odds replayed on the crawled leagues (live_replay.py), and tests the
preregistered improvements in order (PREREGISTRATION_2026.md, live addendum).

Primary score: log loss averaged over each matchup's samples (every 3 minutes while games are
on), each matchup weighted equally, decided matchups only; odds clipped to [1e-6, 1 - 1e-6].
A variant is adopted only if, fitted on the other seasons and scored on each held-out one, it
lowers the primary score by at least 0.002, with a 95% interval resampling leagues that
excludes zero, in at least 6 of 8 seasons.

    python live_eval.py            # the current model, by season and stage, and calibration
    python live_eval.py --l1       # rung 1: the spread recalibrated (one multiplier, or by time left)
    python live_eval.py --l1c      # added: a Student-t link
    python live_eval.py --l2       # rung 2: skew, and the weight on the projected margin
    python live_eval.py --l3       # rung 3: production curve over the game clock (LIVE_ALPHA replays first)
    python live_eval.py --l4       # rungs 4-5 and their ceilings (live_state.py --fit and the LIVE_USE replays first)
    python live_eval.py --l3b-fit  # rung 3b: each fold's player variances, then for each season s:
      LIVE_VAR=cache/live_var/s.json LIVE_TAG=_vs python live_replay.py; then python live_eval.py --l3b
"""
import math, os, sys

import numpy as np
import torch

import live_replay as LR
import live_components as LC

DEV = LR.DEV
EPS = 1e-6
MIN_GAIN = 0.002
SEASONS = LC.SEASONS
# Rung 1's curve: a multiplier on the spread, piecewise linear in the share of the kickoff
# variance still to come, at these knots
KNOTS = (0.0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0)


def flat(season, out=None):
    """All samples of a season's decided matchups as flat arrays, with each matchup's index"""
    parts = LR.load(season, out)
    out = {k: [] for k in ('diff', 'sd', 'left', 'cur', 'k3', 'stage', 'mi', 'n')}
    meta = {k: [] for k in ('league', 'outcome', 'week')}
    base = 0
    for r in parts:
        keep = r['outcome'] != 0.5
        M, T = int(keep.sum()), r['diff'].shape[1]
        for k in ('diff', 'sd', 'left', 'cur', 'k3'): out[k].append(r[k][keep].reshape(-1))
        # Stage: 0 kickoff (first sample), then quarters of the week's game time
        st = np.concatenate([[0], 1 + np.minimum(3, (np.arange(1, T) * 4) // T)])
        out['stage'].append(np.tile(st, M).astype(np.int8))
        out['mi'].append(np.repeat(np.arange(base, base + M), T))
        out['n'].append(np.full(M, T))
        for k in meta: meta[k].append(r[k][keep])
        base += M
    o = {k: np.concatenate(v) for k, v in out.items()}
    o.update({k: np.concatenate(v) for k, v in meta.items()})
    o['season'] = season
    return o


def to_dev(d):
    t = lambda a, dt=torch.float32: torch.tensor(a, dtype=dt, device=DEV)
    return {'diff': t(d['diff']), 'sd': t(d['sd']), 'left': t(d['left']), 'cur': t(d['cur']), 'k3': t(d['k3']), 'mi': t(d['mi'], torch.long),
            'n': t(d['n']), 'y': t(d['outcome']), 'stage': t(d['stage'], torch.long), 'league': d['league'], 'M': len(d['outcome'])}


def phi(z):
    return 0.5 * (1 + torch.erf(z / math.sqrt(2)))


def per_matchup(D, odds):
    """Each matchup's log loss averaged over its samples"""
    y = D['y'][D['mi']]
    p = odds.clamp(EPS, 1 - EPS)
    ll = -(y * torch.log(p) + (1 - y) * torch.log(1 - p))
    return torch.zeros(D['M'], device=DEV).index_add_(0, D['mi'], ll) / D['n']


def baseline_odds(D, mult=None):
    sd = D['sd'] if mult is None else D['sd'] * mult
    return torch.where(sd > 0.01, phi(D['diff'] / sd.clamp(min=0.01)), torch.where(D['diff'] > 0, 1.0, torch.where(D['diff'] < 0, 0.0, 0.5)))


def interp(left, values):
    """Piecewise-linear curve over KNOTS"""
    k = torch.tensor(KNOTS, device=DEV)
    x = left.clamp(0, 1)
    i = torch.searchsorted(k, x.contiguous(), right=True).clamp(1, len(KNOTS) - 1) - 1
    w = (x - k[i]) / (k[i + 1] - k[i])
    return values[i] * (1 - w) + values[i + 1] * w


def league_interval(league, delta, n=2000, seed=0):
    """95% interval for the mean of per-matchup differences, resampling leagues"""
    ids, inv = np.unique(league, return_inverse=True)
    s = np.bincount(inv, weights=delta); c = np.bincount(inv)
    rng = np.random.default_rng(seed)
    w = rng.multinomial(len(ids), np.full(len(ids), 1 / len(ids)), size=n)
    boots = (w @ s) / (w @ c)
    return np.percentile(boots, [2.5, 97.5])


def calibration_slope(D, odds, stage=None, n=400000, seed=0):
    """Logistic regression of the outcome on the odds' log-odds (a sample of samples, matchup-weighted)"""
    # Matchups drawn evenly, then a sample within each (in the stage, if given)
    g = torch.Generator(device=DEV).manual_seed(seed)
    start = torch.cumsum(D['n'].long(), 0) - D['n'].long()
    if stage is None:
        m = torch.randint(0, D['M'], (n,), device=DEV, generator=g)
        idx = start[m] + torch.minimum((torch.rand(n, device=DEV, generator=g) * D['n'][m]).long(), D['n'][m].long() - 1)
    else:
        cand = torch.nonzero(D['stage'] == stage).squeeze(1)
        w = 1 / D['n'][D['mi'][cand]]
        idx = cand[torch.multinomial(w, n, replacement=True, generator=g)] if len(cand) < 2 ** 24 else \
            cand[torch.randint(0, len(cand), (n,), device=DEV, generator=g)]
    p = odds[idx].clamp(1e-4, 1 - 1e-4); x = torch.log(p / (1 - p)); y = D['y'][D['mi'][idx]]
    a = torch.zeros(2, device=DEV, requires_grad=True)
    opt = torch.optim.LBFGS([a], max_iter=100, line_search_fn='strong_wolfe')
    def closure():
        opt.zero_grad(); l = torch.nn.functional.binary_cross_entropy_with_logits(a[0] + a[1] * x, y); l.backward(); return l
    opt.step(closure)
    return a[1].item()


def report_baseline(data):
    print('Current model on the crawled leagues (log loss averaged over each matchup\'s week, decided matchups)')
    print('season  matchups  leagues  log loss  kickoff   1st qtr  2nd qtr  3rd qtr  4th qtr  slope  slope late')
    allm = []
    for s, D in data.items():
        odds = baseline_odds(D)
        pm = per_matchup(D, odds)
        stages = []
        y = D['y'][D['mi']]; p = odds.clamp(EPS, 1 - EPS); ll = -(y * torch.log(p) + (1 - y) * torch.log(1 - p))
        for st in range(5):
            m = D['stage'] == st
            w = (1 / D['n'][D['mi']]) * m
            stages.append((ll * w).sum().item() / w.sum().item())
        allm.append(pm.cpu().numpy())
        print(f'{s}  {D["M"]:8,}  {len(np.unique(D["league"])):7}  {pm.mean().item():.4f}   ' + '   '.join(f'{v:.4f}' for v in stages)
              + f'  {calibration_slope(D, odds):.3f}  {calibration_slope(D, odds, stage=4):.3f}')
    print(f'all     {sum(len(a) for a in allm):8,}           {np.concatenate(allm).mean():.4f}')


def thin(D, every=4):
    """Every few samples of each matchup (from its first), for fitting; each matchup still weighs the same"""
    start = torch.cumsum(D['n'].long(), 0) - D['n'].long()
    pos = torch.arange(len(D['mi']), device=DEV) - start[D['mi']]
    keep = pos % every == 0
    out = {k: v[keep] for k, v in D.items() if torch.is_tensor(v) and v.shape[0] == len(D['mi'])}
    out.update({'y': D['y'], 'n': torch.ceil(D['n'] / every), 'M': D['M'], 'league': D['league']})
    return out


def odds_l1(D, th, curve=False):
    mult = torch.exp(interp(D['left'], th) if curve else th[0])
    return baseline_odds(D, mult)


def odds_skew(D, th):
    """L2a: Edgeworth-corrected normal with spread x exp(th0) and player skewness th1"""
    sd = D['sd'] * torch.exp(th[0])
    z = D['diff'] / sd.clamp(min=0.01)
    s = th[1] * D['k3'] * torch.exp(th[0]) ** 3 / sd.clamp(min=0.01) ** 3
    p = phi(z) + torch.exp(-0.5 * z * z) / math.sqrt(2 * math.pi) * s / 6 * (z * z - 1)
    return torch.where(sd > 0.01, p.clamp(0, 1), baseline_odds(D))


def odds_weight(D, th):
    """L2b: the projected rest-of-week margin weighted by th1, spread x exp(th0)"""
    mu = D['cur'] + th[1] * (D['diff'] - D['cur'])
    sd = D['sd'] * torch.exp(th[0])
    return torch.where(sd > 0.01, phi(mu / sd.clamp(min=0.01)), baseline_odds(D))


def odds_both(D, th):
    mu = D['cur'] + th[2] * (D['diff'] - D['cur'])
    sd = D['sd'] * torch.exp(th[0])
    z = mu / sd.clamp(min=0.01)
    s = th[1] * D['k3'] * torch.exp(th[0]) ** 3 / sd.clamp(min=0.01) ** 3
    p = phi(z) + torch.exp(-0.5 * z * z) / math.sqrt(2 * math.pi) * s / 6 * (z * z - 1)
    return torch.where(sd > 0.01, p.clamp(0, 1), baseline_odds(D))


def fit(train, odds, init):
    """Parameters minimising the primary score on these seasons (thinned samples)"""
    theta = torch.tensor(init, device=DEV, dtype=torch.float32, requires_grad=True)
    total = sum(D['M'] for D in train)
    opt = torch.optim.LBFGS([theta], max_iter=100, line_search_fn='strong_wolfe', tolerance_grad=1e-8, tolerance_change=1e-10)
    def closure():
        opt.zero_grad()
        loss = sum(per_matchup(D, odds(D, theta)).sum() for D in train) / total
        loss.backward()
        return loss
    opt.step(closure)
    return theta.detach()


def loso(data, thinned, ref, variant, name, show=lambda th: ' '.join(f'{v:.3f}' for v in th.tolist())):
    """Leave one season out: both models fitted on the other seasons, scored on the held-out one"""
    print(f'\n{name}: fitted leaving each season out, scored on it (negative = better than the reference)')
    print('season   reference  variant   change     95% (leagues)          fitted (variant)')
    wins = 0
    for s, D in data.items():
        train = [thinned[o] for o in data if o != s]
        a = per_matchup(D, ref[0](D, fit(train, *ref))).cpu().numpy()
        th = fit(train, *variant)
        b = per_matchup(D, variant[0](D, th)).cpu().numpy()
        d = b - a
        lo, hi = league_interval(D['league'], d)
        ok = d.mean() <= -MIN_GAIN and hi < 0
        wins += ok
        print(f'{s}    {a.mean():.4f}    {b.mean():.4f}   {d.mean():+.4f}   ({lo:+.4f}, {hi:+.4f})  {"meets" if ok else "     "}  {show(th)}', flush=True)
    print(f'{name}: meets the bar in {wins} of {len(data)} seasons -> {"PASSES" if wins >= 6 else "fails"}', flush=True)
    return wins


L1A = (odds_l1, [0.0])


def student_cdf(z, nu, nodes=24):
    """Student-t CDF by Gauss-Legendre quadrature of the density from 0 to |z| (differentiable in nu
    on the GPU; within 1e-6 of scipy for nu 3-30)"""
    nodes, weights = np.polynomial.legendre.leggauss(nodes)
    x = torch.tensor(nodes, device=DEV, dtype=torch.float32); w = torch.tensor(weights, device=DEV, dtype=torch.float32)
    a = z.abs().clamp(max=60).unsqueeze(-1)
    u = a / 2 * (x + 1)
    logc = torch.lgamma((nu + 1) / 2) - torch.lgamma(nu / 2) - 0.5 * torch.log(nu * math.pi)
    dens = torch.exp(logc - (nu + 1) / 2 * torch.log1p(u * u / nu))
    half = (dens * w).sum(-1) * a.squeeze(-1) / 2
    return torch.where(z >= 0, 0.5 + half, 0.5 - half)


def odds_t(D, th):
    sd = D['sd'] * torch.exp(th[0])
    nu = 2 + torch.exp(th[1])
    out = torch.empty_like(sd)
    for i in range(0, len(sd), 1 << 24):
        sl = slice(i, i + (1 << 24))
        out[sl] = student_cdf(D['diff'][sl] / sd[sl].clamp(min=0.01), nu)
    return torch.where(sd > 0.01, out, baseline_odds(D))
ALPHAS = (0.6, 0.7, 0.8, 0.9, 1.0, 1.1)


def alpha_dir(a):
    return os.path.join(LR.HERE, 'cache', 'live_replay' + (f'_a{a:g}' if a != 1 else ''))


def rung3():
    """L3: each fold picks alpha by its training seasons' fitted loss (L1a's multiplier refit at each),
    then the held-out season is scored at that alpha against L1a at alpha 1"""
    fits = {}  # (alpha, held-out season) -> (theta, training loss)
    for a in ALPHAS:
        thinned = {s: thin(to_dev(flat(s, alpha_dir(a)))) for s in SEASONS}
        for s in SEASONS:
            train = [thinned[o] for o in SEASONS if o != s]
            th = fit(train, *L1A)
            loss = sum(per_matchup(D, odds_l1(D, th)).sum().item() for D in train) / sum(D['M'] for D in train)
            fits[(a, s)] = (th, loss)
        print(f'alpha {a}: training loss by fold ' + ' '.join(f'{fits[(a, s)][1]:.4f}' for s in SEASONS), flush=True)
        del thinned; torch.cuda.empty_cache()
    print('\nL3: production curve r^alpha (alpha chosen on the training seasons) vs L1a')
    print('season   L1a      variant   change     95% (leagues)          alpha  multiplier')
    wins = 0
    for s in SEASONS:
        a = min(ALPHAS, key=lambda x: fits[(x, s)][1])
        ref = to_dev(flat(s)); base = per_matchup(ref, odds_l1(ref, fits[(1.0, s)][0])).cpu().numpy(); del ref
        D = to_dev(flat(s, alpha_dir(a))); th = fits[(a, s)][0]
        new = per_matchup(D, odds_l1(D, th)).cpu().numpy()
        d = new - base
        lo, hi = league_interval(D['league'], d)
        ok = d.mean() <= -MIN_GAIN and hi < 0
        wins += ok
        print(f'{s}    {base.mean():.4f}   {new.mean():.4f}   {d.mean():+.4f}   ({lo:+.4f}, {hi:+.4f})  {"meets" if ok else "     "}  {a:.1f}    x{math.exp(th[0]):.2f}', flush=True)
        del D; torch.cuda.empty_cache()
    print(f'L3: meets the bar in {wins} of {len(SEASONS)} seasons -> {"PASSES" if wins >= 6 else "fails"}')


VAR_DIR = os.path.join(LR.HERE, 'cache', 'live_var')
VAR_POS = ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')


def fit_variances():
    """L3b, per fold: each position's variance a + b x projection, least squares of starters' squared
    miss on their projection over the training seasons (regular season, projected above 0)"""
    import pyarrow.parquet as pq, json
    t = pq.read_table(os.path.join(LR.HERE, 'cache', 'player_weeks.parquet'), columns=['season', 'started', 'proj', 'points', 'playoff', 'position'],
                      filters=[('started', '=', True), ('playoff', '=', False)]).to_pandas()
    t = t[t.proj.notna() & t.points.notna() & (t.proj > 0)]
    t['position'] = t.position.astype(str)
    os.makedirs(VAR_DIR, exist_ok=True)
    for s in SEASONS:
        tr = t[t.season != int(s)]
        out = {}
        for pos in VAR_POS:
            g = tr[tr.position == pos]
            X = np.stack([np.ones(len(g)), g.proj.to_numpy(dtype=float)], 1)
            a, b = np.linalg.lstsq(X, (g.points - g.proj).to_numpy(dtype=float) ** 2, rcond=None)[0]
            out[pos] = [max(a, 0.0), max(b, 0.0)]
        json.dump(out, open(os.path.join(VAR_DIR, f'{s}.json'), 'w'))
        print(f'fold {s}: ' + '  '.join(f'{p} {v[0]:.1f}+{v[1]:.2f}p' for p, v in out.items()))


def rung3b():
    """L3b against L1a: each fold's replay uses the variances fitted without its held-out season"""
    print('\nL3b: player variance a + b x projection vs L1a')
    print('season   L1a      variant   change     95% (leagues)          multiplier')
    wins = 0
    for s in SEASONS:
        vdir = os.path.join(LR.HERE, 'cache', f'live_replay_v{s}')
        base_tr = [thin(to_dev(flat(o))) for o in SEASONS if o != s]
        th0 = fit(base_tr, *L1A); del base_tr
        var_tr = [thin(to_dev(flat(o, vdir))) for o in SEASONS if o != s]
        th1 = fit(var_tr, *L1A); del var_tr
        ref = to_dev(flat(s)); base = per_matchup(ref, odds_l1(ref, th0)).cpu().numpy(); del ref
        D = to_dev(flat(s, vdir)); new = per_matchup(D, odds_l1(D, th1)).cpu().numpy()
        d = new - base
        lo, hi = league_interval(D['league'], d)
        ok = d.mean() <= -MIN_GAIN and hi < 0
        wins += ok
        print(f'{s}    {base.mean():.4f}   {new.mean():.4f}   {d.mean():+.4f}   ({lo:+.4f}, {hi:+.4f})  {"meets" if ok else "     "}  x{math.exp(th1[0]):.2f} (L1a x{math.exp(th0[0]):.2f})', flush=True)
        del D; torch.cuda.empty_cache()
    print(f'L3b: meets the bar in {wins} of {len(SEASONS)} seasons -> {"PASSES" if wins >= 6 else "fails"}')


def rung_dirs(name, dir_for, ceiling=False):
    """A variant replayed per fold (dir_for(held-out season) holds that fold's replay of every season),
    L1a's multiplier refit on it, against L1a on the current model"""
    print(f'\n{name} vs L1a' + (' (a ceiling: uses what happened later)' if ceiling else ''))
    print('season   L1a      variant   change     95% (leagues)          multiplier')
    wins = 0
    for s in SEASONS:
        base_tr = [thin(to_dev(flat(o))) for o in SEASONS if o != s]
        th0 = fit(base_tr, *L1A); del base_tr
        var_tr = [thin(to_dev(flat(o, dir_for(s)))) for o in SEASONS if o != s]
        th1 = fit(var_tr, *L1A); del var_tr
        ref = to_dev(flat(s)); base = per_matchup(ref, odds_l1(ref, th0)).cpu().numpy(); del ref
        D = to_dev(flat(s, dir_for(s))); new = per_matchup(D, odds_l1(D, th1)).cpu().numpy()
        d = new - base
        lo, hi = league_interval(D['league'], d)
        ok = d.mean() <= -MIN_GAIN and hi < 0
        wins += ok
        print(f'{s}    {base.mean():.4f}   {new.mean():.4f}   {d.mean():+.4f}   ({lo:+.4f}, {hi:+.4f})  {"meets" if ok else "     "}  x{math.exp(th1[0]):.2f} (L1a x{math.exp(th0[0]):.2f})', flush=True)
        del D; torch.cuda.empty_cache()
    print(f'{name}: meets the bar in {wins} of {len(SEASONS)} seasons -> {"PASSES" if wins >= 6 else "fails"}', flush=True)


def rung45():
    d = lambda tag: (lambda s: os.path.join(LR.HERE, 'cache', f'live_replay_{tag}'))
    f = lambda tag: (lambda s: os.path.join(LR.HERE, 'cache', f'live_replay_{tag}{s}'))
    rung_dirs('Oracle: each NFL team\'s actual remaining points', d('oracle_team'), ceiling=True)
    rung_dirs('Oracle: each team-position\'s actual remaining points', d('oracle_group'), ceiling=True)
    rung_dirs('L4: game state (margin, quarter, drive EP)', f('state'))
    rung_dirs('L5: same-game correlations', f('corr'))
    rung_dirs('L4+L5', f('statecorr'))


LATE = 0.05


def late_score(D, odds):
    """The addendum's late-game target: log loss over samples with under 5% of the kickoff variance
    left, each matchup's averaged, over matchups that reach it"""
    y = D['y'][D['mi']]
    p = odds.clamp(EPS, 1 - EPS)
    ll = -(y * torch.log(p) + (1 - y) * torch.log(1 - p))
    m = (D['left'] < LATE).float()
    num = torch.zeros(D['M'], device=DEV).index_add_(0, D['mi'], ll * m)
    den = torch.zeros(D['M'], device=DEV).index_add_(0, D['mi'], m)
    keep = den > 0
    return (num[keep] / den[keep]).cpu().numpy(), keep.cpu().numpy()


def late_look():
    """Exploratory: the late-game score of variants already tested, each fitted leaving the season out"""
    data = {s: to_dev(flat(s)) for s in SEASONS}
    thinned = {s: thin(D) for s, D in data.items()}
    thinner = {s: thin(D, 8) for s, D in data.items()}
    variants = {'L1a one multiplier': (odds_l1, [0.0], thinned), 'L1b multiplier by variance left': (lambda D, th: odds_l1(D, th, curve=True), [0.0] * len(KNOTS), thinned),
                'L1c Student-t': (odds_t, [0.4, 2.0], thinner)}
    print('late-game log loss (under 5% of the kickoff variance left), each season fitted on the others:')
    print('season   ' + '   '.join(f'{k:>32}' for k in variants))
    for s, D in data.items():
        vals = []
        for name, (fn, init, th_data) in variants.items():
            th = fit([th_data[o] for o in SEASONS if o != s], fn, init)
            v, _ = late_score(D, fn(D, th)); vals.append(v.mean())
        print(f'{s}     ' + '   '.join(f'{v:32.4f}' for v in vals), flush=True)


def injuries_vegas():
    d = lambda tag: (lambda s: os.path.join(LR.HERE, 'cache', f'live_replay_{tag}'))
    f = lambda tag: (lambda s: os.path.join(LR.HERE, 'cache', f'live_replay_{tag}{s}'))
    rung_dirs('Injuries, oracle: an injured player who never records another stat is zeroed', d('injoracle'), ceiling=True)
    rung_dirs('Injuries, model: chance he returns by minutes since with no stat', f('injmodel'))
    rung_dirs('Vegas: projection + beta x team implied points', f('vegas'))


def main():
    if '--injuries' in sys.argv: return injuries_vegas()
    if '--late' in sys.argv: return late_look()
    if '--l4' in sys.argv: return rung45()
    if '--l3' in sys.argv: return rung3()
    if '--l3b-fit' in sys.argv: return fit_variances()
    if '--l3b' in sys.argv: return rung3b()
    data = {s: to_dev(flat(s)) for s in SEASONS}
    thinned = {s: thin(D) for s, D in data.items()}
    if '--l1' in sys.argv:
        report_baseline(data)
        base = (lambda D, th: baseline_odds(D), [0.0])
        loso(data, thinned, base, L1A, 'L1a: one spread multiplier vs the current model', lambda th: f'x{math.exp(th[0]):.2f}')
        loso(data, thinned, L1A, (lambda D, th: odds_l1(D, th, curve=True), [0.0] * len(KNOTS)), 'L1b: multiplier by variance left vs L1a',
             lambda th: ' '.join(f'{v:.2f}' for v in torch.exp(th).tolist()))
    elif '--l1c' in sys.argv:
        thinner = {k: thin(D, 8) for k, D in data.items()}  # the quadrature's memory: fit on every 8th sample
        loso(data, thinner, L1A, (odds_t, [0.4, 2.0]), 'L1c: Student-t link vs L1a', lambda th: f'x{math.exp(th[0]):.2f} nu {2 + math.exp(th[1]):.1f}')
    elif '--l2' in sys.argv:
        a = loso(data, thinned, L1A, (odds_skew, [0.4, 0.0]), 'L2a: skew vs L1a', lambda th: f'x{math.exp(th[0]):.2f} skew {th[1]:.2f}')
        b = loso(data, thinned, L1A, (odds_weight, [0.4, 1.0]), 'L2b: projection weight vs L1a', lambda th: f'x{math.exp(th[0]):.2f} weight {th[1]:.2f}')
        if a >= 6 and b >= 6:
            loso(data, thinned, L1A, (odds_both, [0.4, 0.0, 1.0]), 'L2c: both vs L1a')
    else:
        report_baseline(data)


if __name__ == '__main__':
    main()
