"""Rank, wins, playoff and bye odds under our league's rules, scored without schedule luck.

Our rules, applied to every crawled league (whatever its own settings): head-to-head wins only
(no median game), ties broken by points for, top 6 make the playoffs, top 2 get byes. Each
league keeps its own teams, weekly scores and regular-season length. --rules ours adds our
divisions (12-team leagues only): 3 random divisions of 4, division winners seeded 1-3 by
record, then the rest; development schedules in our format (our 2024-2025 schedules as
templates, teams shuffled into the slots and weeks into random order: division rivals twice,
the other 8 once). --weekly scores a snapshot every week from 3 to the end of the regular
season; the preregistered primary score is --weekly --rules ours, final check.

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
METRICS = ['playoff Brier', 'bye Brier', 'rank RPS', 'wins CRPS', 'own-size playoff']
# The models compared ('site' is the deployed model: lineup weight 0.75)
NAMES = ['coin flip', 'site (0.75)', 'lineup 0.3', 'fitted lineup+ppg', 'fitted + tau', 'perfect strength']
COMPARE = [('fitted + tau', 'lineup 0.3'), ('fitted + tau', 'site (0.75)'), ('fitted + tau', 'fitted lineup+ppg'),
           ('lineup 0.3', 'coin flip')]


def models(P):
    """Names, offsets (M, B, T), persistent sd (M, B) and weekly sd (M, B), fitted leaving the
    snapshot's season out where fitted (gpu_sim.offsets)"""
    off5, tau5 = G.offsets(P)  # coin flip, lineup 0.3, fitted lineup+ppg, fitted + tau, perfect strength
    B, T = P['y'].shape; M = len(NAMES)
    off = np.zeros((M, B, T)); tau = np.zeros((M, B)); sd = np.repeat(P['sd'][None], M, 0)
    for i, j in ((0, 0), (2, 1), (3, 2), (4, 3), (5, 4)): off[i], tau[i] = off5[j], tau5[j]
    off[1] = 0.75 * P['X'][:, :, 0]
    return NAMES, off * P['teams'], tau, sd


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



def our_templates():
    """Our league's real schedules (2024, 2025: 3 divisions of 4, division rivals twice and the
    other 8 once, 14 weeks) as slot tables: opp (templates, 14, 12) and the slots' divisions"""
    import gzip, json, os
    from common import ARCHIVE
    opps, divs = [], []
    for season_ in ('2024', '2025'):
        R = json.load(gzip.open(os.path.join(ARCHIVE, season_, 'rosters.json.gz'), 'rt'))
        div = {r['roster_id']: (r.get('settings') or {}).get('division') for r in R}
        if len(R) != 12 or len(set(div.values())) != 3: continue
        slot = {rid: i for i, rid in enumerate(sorted(div, key=lambda r: (div[r], r)))}
        O = np.zeros((14, 12), np.int64)
        for w in range(1, 15):
            by = {}
            for m in json.load(gzip.open(os.path.join(ARCHIVE, season_, 'matchups', f'{w}.json.gz'), 'rt')):
                by.setdefault(m['matchup_id'], []).append(slot[m['roster_id']])
            for a_, b_ in by.values(): O[w - 1, a_] = b_; O[w - 1, b_] = a_
        opps.append(O); divs.append(np.array([div[r] for r in sorted(slot, key=slot.get)]) - 1)
    return np.stack(opps), np.stack(divs)


TEMPLATES = None


def our_schedule(gen, sims, b, weeks=18):
    """Random schedules in our format: a template, teams shuffled into its slots (so divisions are
    random), its 14 weeks in random order (repeating if a season runs longer). Opponents
    (sims, b, weeks, 12) and divisions (sims, b, 12)"""
    global TEMPLATES
    if TEMPLATES is None: TEMPLATES = tuple(t(x, torch.int64) for x in our_templates())
    O, D = TEMPLATES
    k = torch.randint(len(O), (sims, b), device=DEV, generator=gen)
    pos = torch.rand((sims, b, 12), device=DEV, generator=gen).argsort(-1); inv = pos.argsort(-1)
    order = torch.rand((sims, b, 14), device=DEV, generator=gen).argsort(-1)
    opp = torch.stack([inv.gather(-1, O[k, order[..., (w - 1) % 14]].gather(-1, pos)) for w in range(1, weeks + 1)], 2)
    return opp, D[k].gather(-1, pos)


def schedule_divisions(r):
    """Divisions a 12-team league's own schedule implies: in 96% of crawled 12-team, 14-week
    leagues each team's twice-played opponents form 3 groups of 4, exactly our division
    schedule. Group index per team, or -1s when the schedule doesn't split that way."""
    from collections import Counter
    n = len(r['ids']); meet = Counter()
    for w in range(1, r['end'] + 1):
        for a_, b_ in r['games'][w]: meet[(min(a_, b_), max(a_, b_))] += 1
    twice = {i: {j for (a_, b_), c in meet.items() if c >= 2 for i2, j in ((a_, b_), (b_, a_)) if i2 == i} for i in range(n)}
    groups = {frozenset(twice[i] | {i}) for i in range(n)}
    if n != 12 or len(groups) != 3 or any(len(g) != 4 for g in groups) or any(len(twice[i]) != 3 for i in range(n)):
        return np.full(n, -1)
    out = np.zeros(n, np.int64)
    for k, g in enumerate(sorted(groups, key=min)):
        for i in g: out[i] = k
    return out


def random_divisions(gen, b, n=12, k=3):
    """One random assignment of n teams to k equal divisions per snapshot (b, n)"""
    return (torch.rand((b, n), device=DEV, generator=gen).argsort(-1).argsort(-1) % k)


def season(P, idx, n, sims, gen, schedule, model=None, div=None, bracket=None):
    """Final rank and wins distributions, (M, b, n, n) and (M, b, n, NW), for snapshots idx (all
    with n teams). model=(off (M, b, n), tau (M, b), sd (M, b)) simulates the remaining scores as
    gpu_sim.simulate does; None replays the actual scores. schedule: 'real', 'random' (round
    robins) or 'ours' (our format, with its divisions). div (b, n): divisions on the real schedule
    (our seeding: division winners first, by record, then the rest); None and not 'ours': none.
    bracket: also play our playoffs (6 teams: 3 v 6 and 4 v 5, then 1 and 2 host, then the final,
    higher score advancing) and toilet bowl (the other 6, worst first, lower score advancing) as
    playoffOdds.ts does, and return title and last-place probabilities (M, b, n) as well: True
    simulates the three playoff weeks with the model; with model None, the actual playoff-week
    points (b, 3, n)."""
    b = len(idx); K = P['opp'].shape[1]
    weeks = t(P['weeks'][idx])
    if model:
        off, tau, sdm = t(model[0]), t(model[1]), t(model[2]); M = off.shape[0]
        df = t(model[3]) if len(model) > 3 and model[3] is not None else None  # weekly noise: Student t (unit variance) per model
        lg = t(P['lg'][idx])
        team = torch.randn((sims, b, n), device=DEV, generator=gen)
        tau_ = tau[:, None, :, None] if tau.dim() == 2 else tau[:, None]  # per snapshot (M, b) or per team (M, b, n)
        base = (lg[:, None] + off)[:, None] + tau_ * team[None]
    else:
        M = 1; pts = t(P['pts'][idx][:, :, :n])
    W = t(P['W0'][idx][:, :n]).expand(M, sims, b, n).clone(); PF = t(P['PF0'][idx][:, :n]).expand(M, sims, b, n).clone()
    if schedule in ('random', 'ours'):
        e = t(P['e'][idx], torch.int64)
        if schedule == 'random': rr = random_round_robin(gen, sims, b, n)
        else: rr, div = our_schedule(gen, sims, b)
    else:
        opp = t(P['opp'][idx][:, :, :n], torch.int64)
    for k in range(K):
        if not bool(weeks[:, k].any()): break
        if model:
            z = torch.randn((sims, b, n), device=DEV, generator=gen)[None].expand(M, sims, b, n)
            if df is not None:  # t = z / sqrt(chi2_df / df), scaled to unit variance; models with df 0 stay normal
                d_ = df.clamp(min=2.5)[:, None, None, None]
                g = torch._standard_gamma((d_ / 2).expand(M, sims, b, n).contiguous(), generator=gen) * 2 / d_
                z = torch.where(df[:, None, None, None] > 0, z / g.sqrt() * torch.sqrt((d_ - 2) / d_), z)
            sc = base + sdm[:, None, :, None] * z
        else:
            sc = pts[:, k][None, None].expand(M, sims, b, n)
        if schedule in ('random', 'ours'):
            o = rr.gather(2, (e + k - 1).clamp(max=rr.shape[2] - 1)[None, :, None, None].expand(sims, b, 1, n)).squeeze(2)
            o = o[None].expand(M, sims, b, n); has = (weeks[:, k] > 0)[None, None, :, None]
        else:
            o = opp[:, k][None, None].expand(M, sims, b, n); has = o >= 0
        theirs = sc.gather(-1, o.clamp(min=0))
        W += ((sc > theirs).float() + 0.5 * (sc == theirs).float()) * has
        PF += sc * weeks[:, k][None, None, :, None]
    key = W + PF / (PF.max(-1, keepdim=True).values + 1)
    if div is not None:
        dv = (div if div.dim() == 3 else div[None].expand(sims, b, n))[None].expand(M, sims, b, n)
        for d in range(int(dv.max()) + 1):
            top = key.masked_fill(dv != d, -math.inf).argmax(-1, keepdim=True)
            key = key.scatter_add(-1, top, torch.full_like(top, 1000, dtype=key.dtype))
    rank = key.argsort(-1, descending=True).argsort(-1)
    tid = torch.arange(n, device=DEV)
    def hist(v, size):
        flat = (tid * size + v).permute(0, 2, 1, 3).reshape(M, b, sims * n)
        c = torch.zeros((M, b, n * size), device=DEV).scatter_add_(-1, flat, torch.ones_like(flat, dtype=torch.float32))
        return c.view(M, b, n, size) / sims
    out = (hist(rank, n), hist((2 * W).round().long().clamp(0, NW - 1), NW))
    if bracket is None: return out
    rounds = [base + sdm[:, None, :, None] * torch.randn((sims, b, n), device=DEV, generator=gen)[None] if model
              else t(bracket)[:, r][None, None].expand(M, sims, b, n) for r in range(3)]
    best, worst = key.argsort(-1, descending=True), key.argsort(-1)
    at = lambda order, i: order[..., i:i + 1]
    def play(r, a_, c_, higher):
        sa, sc_ = rounds[r].gather(-1, a_), rounds[r].gather(-1, c_)
        return torch.where(sa > sc_ if higher else sa < sc_, a_, c_)
    def bowl(order, higher):  # seeds 1-6 of the order: 4 v 5 and 3 v 6, then 1 and 2 host, then the final
        x, y = play(0, at(order, 3), at(order, 4), higher), play(0, at(order, 2), at(order, 5), higher)
        return play(2, play(1, at(order, 0), x, higher), play(1, at(order, 1), y, higher), higher)
    onehot = lambda w: torch.zeros((M, sims, b, n), device=DEV).scatter_(-1, w, 1.0).mean(1)
    return out + (onehot(bowl(best, True)), onehot(bowl(worst, False)))


def score(F, G_, Fw, Gw, n, playoff, own):
    """Expected scores per model and snapshot (M, b, metric), averaged over the snapshot's teams;
    the target G_ (1, b, n, n) and Gw may be distributions (schedule-averaged) or one-hot (real).
    playoff: our cutoff; own (b,): each league's own number of playoff teams"""
    cF, cG = F.cumsum(-1), G_.cumsum(-1); wF, wG = Fw.cumsum(-1), Gw.cumsum(-1)
    b2 = lambda p, q: (p - q) ** 2 + q * (1 - q)
    at = lambda c, k: c.gather(-1, t(k - 1, torch.int64)[None, :, None, None].expand(c.shape[0], -1, n, 1)).squeeze(-1)
    out = [b2(cF[..., playoff - 1], cG[..., playoff - 1]), b2(cF[..., BYE - 1], cG[..., BYE - 1]),
           b2(cF[..., :-1], cG[..., :-1]).sum(-1) / (n - 1), 0.5 * b2(wF[..., :-1], wG[..., :-1]).sum(-1),
           b2(at(cF, own), at(cG, own))]
    return torch.stack([o.mean(-1) for o in out], -1).cpu().numpy()


def main(model_set=models, compare=COMPARE):
    """model_set(P) -> (names, offsets, persistent sd, weekly sd); compare: name pairs to difference"""
    ap = argparse.ArgumentParser()
    ap.add_argument('--sims', type=int, default=4000); ap.add_argument('--target-sims', type=int, default=2000)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--cutoff', choices=['6', 'half'], default='6', help="playoff teams: our 6 in every league, or half the league (our 6 of 12)")
    ap.add_argument('--rules', choices=['plain', 'ours'], default='plain', help="ours: 12-team leagues only, with our 3 divisions (random), our schedule format and division-winner seeding")
    ap.add_argument('--save', help='save per-snapshot scores to this .npz (cache/ is git-ignored)')
    ap.add_argument('--weekly', action='store_true', help='a snapshot every week from 3 to the end of the regular season (strength_model.collect(weekly=True))')
    a = ap.parse_args(); t0 = time.time()
    data = G.S.collect(weekly=a.weekly)
    if a.rules == 'ours': data = [r for r in data if len(r['ids']) == 12]
    P = G.pack(data); B = len(P['e']); ours = a.rules == 'ours'
    implied = np.stack([schedule_divisions(r) for r in data]) if ours else None
    if ours: print(f"divisions: {np.mean(implied[:, 0] >= 0):.0%} of snapshots from the league's own schedule (twice-played groups of 4), the rest random")
    gen_div = torch.Generator(device=DEV).manual_seed(a.seed + 1)
    ms = model_set(P); names, off, tau, sd = ms[:4]; df = ms[4] if len(ms) > 4 else None
    M = len(names); ix = {n: i for i, n in enumerate(names)}
    gen = torch.Generator(device=DEV).manual_seed(a.seed)
    res = {ev: np.zeros((M, B, len(METRICS))) for ev in ('development', 'final check')}
    nteams = P['teams'].sum(1); mismatch = 0
    for n in sorted(set(nteams)):
        ids = np.where(nteams == n)[0]; chunk = max(1, int(1.5e8 // (M * a.sims * n)))
        for s in range(0, len(ids), chunk):
            ii = ids[s:s + chunk]; model = (off[:, ii, :n], tau[:, ii] if tau.ndim == 2 else tau[:, ii, :n], sd[:, ii], df)
            div = (torch.where(t(implied[ii] >= 0, torch.bool), t(implied[ii], torch.int64), random_divisions(gen_div, len(ii))) if ours else None)
            if ours:
                real_r, real_w = season(P, ii, n, 1, gen, 'real', div=div)
            else:
                real_r, real_w = season(P, ii, n, 1, gen, 'real')
                # the real schedule and actual scores must reproduce who made it (the league's own cutoff)
                own = (real_r[0].cumsum(-1).gather(-1, t(P['n_po'][ii] - 1, torch.int64)[:, None, None].expand(len(ii), n, 1)).squeeze(-1)).cpu().numpy()
                mismatch += int((own != P['made'][ii][:, :n]).any(1).sum())
            sched = 'ours' if ours else 'random'
            avg_r, avg_w = season(P, ii, n, a.target_sims, gen, sched)
            po = PLAYOFF if a.cutoff == '6' else n // 2
            Fr, Fw = season(P, ii, n, a.sims, gen, sched, model)
            res['development'][:, ii] = score(Fr, avg_r, Fw, avg_w, n, po, P['n_po'][ii])
            Fr, Fw = season(P, ii, n, a.sims, gen, 'real', model, div=div)
            res['final check'][:, ii] = score(Fr, real_r, Fw, real_w, n, po, P['n_po'][ii])
    weeks = np.unique(P['e']); seasons = np.unique(P['season']); everything = np.ones(B, bool); twelve = nteams == 12
    if a.save:
        np.savez(a.save, names=np.array(names), metrics=np.array(METRICS), development=res['development'], final=res['final check'],
                 league=P['league'], season=P['season'], e=P['e'], teams=nteams)
    print(f"playoff cutoff: {'top 6 in every league' if a.cutoff == '6' else 'top half of each league'}; 'own-size playoff' uses each league's own number"
          + ("; OUR RULES: 12-team leagues, 3 random divisions, division winners seeded first, development on our schedule format" if ours else ''))
    print(f'{B} snapshots (weeks {weeks.min()}-{weeks.max()}); '
          + ('' if ours else f'real schedules reproduce the actual outcome in all but {mismatch}; ')
          + f'{a.sims} simulated seasons per forecast, {a.target_sims} random schedules per target, {time.time() - t0:.0f}s')
    for ev, r in res.items():
        print(f'\n{ev}' + (' (schedule-averaged target, forecasts without the schedule)' if ev == 'development' else ' (real schedule, real outcome)')
              + (', pooled over every snapshot week' if a.weekly else ''))
        print(f"{'':>21}" + ''.join(f'{m:>17}' for m in METRICS) + f"{'12-team playoff':>17}")
        for m in range(M): print(f'{names[m]:>21}' + ''.join(f'{r[m, :, j].mean():17.4f}' for j in range(len(METRICS))) + f'{r[m, twelve, 0].mean():17.4f}')
    r = res['final check']
    print('\nplayoff Brier by snapshot week (final check, our cutoff):')
    print(f"{'week':>5} {'snapshots':>9}" + ''.join(f'{n[:14]:>15}' for n in names))
    for e in weeks:
        sel = P['e'] == e
        print(f'{e:5d} {sel.sum():9d}' + ''.join(f'{r[m, sel, 0].mean():15.4f}' for m in range(M)))
    print('\ndifferences, 95% interval resampling leagues (seasons better of 8); interval width, final check / development:')
    for i, j in ((ix[a], ix[b]) for a, b in compare):
        for k, met in enumerate(METRICS):
            line = f'  {names[i]} - {names[j]}, {met:>16}:'; widths = []
            for ev in ('development', 'final check'):
                d = res[ev][i, :, k] - res[ev][j, :, k]; m, lo, hi = G.interval(P, d, everything); widths.append(hi - lo)
                line += f'  {ev[:5]} {m:+.5f} [{lo:+.5f}, {hi:+.5f}] ({sum(d[P["season"] == s].mean() < 0 for s in seasons)})'
            print(line + f'  width x{widths[1] / widths[0]:.1f}')
    print('\nby league size, final check, 95% interval resampling leagues (seasons better of 8):')
    for a_, b_ in compare:
        print(f'  {a_} - {b_}')
        for n in sorted(set(nteams)):
            sel = nteams == n
            parts = []
            for k in range(len(METRICS)):
                d = r[ix[a_], :, k] - r[ix[b_], :, k]; q = G.interval(P, d, sel)
                won = sum(d[sel & (P['season'] == s_)].mean() < 0 for s_ in seasons)
                parts.append(f'{METRICS[k]} {q[0]:+.5f} [{q[1]:+.5f}, {q[2]:+.5f}] ({won})')
            print(f'    {n} teams ({len(np.unique(P["league"][sel]))} leagues): ' + '  '.join(parts))

if __name__ == '__main__':
    main()
