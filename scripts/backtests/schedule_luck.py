"""How much does the schedule decide, and does knowing it help? (round robins, GPU)

1. Are the crawled leagues' real schedules round robins (everyone once before anyone twice)?
2. Whole season: each league's actual weekly scores replayed under 1,000 random round robins
   (rank_odds.random_round_robin): how often would the playoff teams change?
3. Forecast: fitted + tau simulated on the real remaining schedule vs on random round robins
   (the schedule treated as unknown), out of sample, playoff Brier.

    python schedule_luck.py
"""
import math
from collections import Counter
import numpy as np, torch
import gpu_sim as G, leagues_fit as LF, rank_odds as R

data = G.S.collect(); DEV = G.DEV
t = R.t
gen = torch.Generator(device=DEV).manual_seed(2)

# 1. are real schedules round robins?
rr = Counter()
for r in data:
    if r['e'] != 4: continue
    n = len(r['ids']); seen = [set() for _ in range(n)]; ok = True
    for w in range(1, min(r['end'], n - 1) + 1):
        for a, b in r['games'][w]:
            if b in seen[a]: ok = False
            seen[a].add(b); seen[b].add(a)
    rr['round robin' if ok else 'repeats an opponent early'] += 1
print('1. real schedules (first n-1 weeks, one per league-season):', dict(rr))

# 2. whole season, actual scores, random round robins
leagues = [r for r in data if r['e'] == 4]
sims = 1000; res = []
for n in (10, 12, 14):
    grp = [r for r in leagues if len(r['ids']) == n]
    if not grp: continue
    E = max(r['end'] for r in grp)
    pts = np.zeros((len(grp), E, n)); has = np.zeros((len(grp), E), bool)
    made = np.zeros((len(grp), n)); n_po = np.array([r['n_po'] for r in grp])
    for i, r in enumerate(grp):
        for w in range(1, r['end'] + 1): pts[i, w - 1] = [r['pts'][w][j] for j in r['ids']]; has[i, w - 1] = True
        Wf, PFf = G.record(r, r['end']); made[i, np.lexsort((-PFf, -Wf))[:r['n_po']]] = 1
    for s in range(0, len(grp), 512):
        sl = slice(s, min(s + 512, len(grp))); b = sl.stop - sl.start
        p, h = t(pts[sl]), t(has[sl]); opp = R.random_round_robin(gen, sims, b, n, E)
        W = torch.zeros((sims, b, n), device=DEV)
        for k in range(E):
            pk = p[:, k][None].expand(sims, b, n); po = pk.gather(-1, opp[:, :, k])
            W += ((pk > po).float() + 0.5 * (pk == po).float()) * h[:, k][None, :, None]
        PF = (p * h[..., None]).sum(1)
        key = W + PF / (PF.max(-1, keepdim=True).values + 1)
        prob = (key.argsort(-1, descending=True).argsort(-1) < t(n_po[sl], torch.int64)[None, :, None]).float().mean(0).cpu().numpy()
        for i in range(b): res.append((n, prob[i], made[sl][i]))
pr = np.concatenate([x[1] for x in res]); md = np.concatenate([x[2] for x in res])
print(f'\n2. whole season, every weekly score known, schedule a random round robin ({len(res)} league-seasons):')
print(f'   Brier {np.mean((pr - md) ** 2):.4f}; teams whose playoff fate the schedule could change (5-95%): {np.mean(np.minimum(pr, 1 - pr) > 0.05):.1%}')
mid = (pr > 0.05) & (pr < 0.95)
print(f'   made it on the real schedule though under 50% on random ones: {np.mean((md == 1) & (pr < 0.5)):.1%} of teams; missed though over 50%: {np.mean((md == 0) & (pr > 0.5)):.1%}')
for n in (10, 12, 14):
    k = np.concatenate([np.full(len(x[1]), x[0] == n) for x in res])
    print(f'   {n} teams: Brier {np.mean((pr[k] - md[k]) ** 2):.4f}')

# 3. forecast: real remaining schedule vs random round robins (schedule treated as unknown)
P = G.pack(data); B, K, T = P['opp'].shape
off, tau = G.offsets(P); off, tau = off[3], tau[3]
sims = 2000; out = {'real': np.zeros((B, T)), 'random round robin': np.zeros((B, T))}
nteams = P['teams'].sum(1)
for n in (10, 12, 14):
    idx = np.where(nteams == n)[0]
    for s in range(0, len(idx), 512):
        ii = idx[s:s + 512]; b = len(ii)
        weeks = t(P['weeks'][ii]); n_po = t(P['n_po'][ii], torch.int64); lg, sd = t(P['lg'][ii]), t(P['sd'][ii])
        e = P['e'][ii]; assert len(set(e)) >= 1
        team = torch.randn((sims, b, n), device=DEV, generator=gen)
        base = lg[None, :, None] + t(off[ii, :n])[None] + t(tau[ii])[None, :, None] * team
        # random round robin for the whole season; use its remaining weeks (each snapshot's own e)
        rro = R.random_round_robin(gen, sims, b, n)
        W = {m: t(P['W0'][ii, :n]).expand(sims, b, n).clone() for m in out}; PF = t(P['PF0'][ii, :n]).expand(sims, b, n).clone()
        oreal = t(P['opp'][ii, :, :n], torch.int64)
        for k in range(K):
            if not bool(weeks[:, k].any()): break
            sc = base + sd[None, :, None] * torch.randn((sims, b, n), device=DEV, generator=gen)
            o = oreal[:, k][None].expand(sims, b, n)
            W['real'] += (sc > sc.gather(-1, o.clamp(min=0))).float() * (o >= 0)
            week_of_season = t(np.minimum(e + k - 1, 17), torch.int64)  # week e+k -> position e+k-1 (padded weeks clamped, masked below)
            orr = rro.gather(2, week_of_season[None, :, None, None].expand(sims, b, 1, n)).squeeze(2)
            W['random round robin'] += (sc > sc.gather(-1, orr)).float() * weeks[:, k][None, :, None]
            PF += sc * weeks[:, k][None, :, None]
        for m in out:
            key = W[m] + PF / (PF.max(-1, keepdim=True).values + 1)
            out[m][ii, :n] = (key.argsort(-1, descending=True).argsort(-1) < n_po[None, :, None]).float().mean(0).cpu().numpy()
tm = P['teams']
br = {m: ((p - P['made']) ** 2 * tm).sum(1) / tm.sum(1) for m, p in out.items()}
d = br['random round robin'] - br['real']
print(f'\n3. forecast (fitted + tau, out of sample, {sims} simulated seasons): value of knowing the real remaining schedule')
for e in list(LF.SNAPSHOTS) + ['all']:
    sel = (P['e'] == e) if e != 'all' else np.ones(B, bool)
    m, lo, hi = G.interval(P, d, sel)
    print(f"   week {str(e):>3}: real {br['real'][sel].mean():.4f}, random round robin {br['random round robin'][sel].mean():.4f}; cost of ignoring the schedule {m:+.4f} [{lo:+.4f}, {hi:+.4f}]")
print(f"   real schedule better in {sum(d[P['season'] == s].mean() > 0 for s in np.unique(P['season']))} of 8 seasons")
