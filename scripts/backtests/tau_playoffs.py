"""Strength uncertainty (tau) late in the season, measured over the weeks it's used for.

The shipped model's tau(e) (strength_model.tau_for) is the excess variance of each team's
rest-of-REGULAR-season average over weekly noise. At snapshot week 14 that average is one game,
so the estimate clamps to 0 (fitted: 8.7 at week 3, 5.2 at 12, 2.1 at 13, 0.0 at 14). But the
simulation applies tau in the three playoff weeks too, so late-season title and last-place odds
ignore strength uncertainty, and the Power Rankings' ranges collapse.

Here, set before the run:
  new tau   the same excess variance over every remaining week INCLUDING the three playoff
            weeks (weeks a team scored 0 left out: abandoned consolation lineups), per team
            with its own count of weeks; then tau^2(e) = a / (e + b) fitted across snapshot
            weeks by least squares, so no week's noisy estimate sets it. Fitted leaving each
            season out, like the means.
Scored against the shipped tau on every 12-team snapshot with all three playoff weeks, our
rules (title_odds.py's harness): playoff, title and last-place Brier. Adoption: the season
addendum's rule (>= 0.0005 Brier, 95% interval resampling leagues excluding 0, >= 5 of 8
seasons) on playoff or title Brier.

    python tau_playoffs.py [--sims 4000]
"""
import argparse, math
import numpy as np
import torch
from scipy.optimize import curve_fit

import gpu_sim as G
import rank_odds as R
import title_odds as TO


def excess(P, pp, rows, b):
    """Per snapshot: mean over teams of (residual^2 - noise variance), target = every remaining week incl. playoffs"""
    out = np.zeros(len(rows))
    for k, i in enumerate(rows):
        n = int(P['teams'][i].sum()); rem = int(P['rem'][i])
        reg = P['pts'][i, :rem, :n]                      # (rem, n)
        po = pp[i][:, :n]                                # (3, n)
        allw = np.vstack([reg, po]); mask = allw > 0
        cnt = mask.sum(0).clip(min=1)
        mean = (allw * mask).sum(0) / cnt
        y = mean - mean.mean()
        res = y - P['X'][i, :n][:, [0, 1]] @ b
        out[k] = np.mean(res ** 2 - P['sd'][i] ** 2 / cnt)
    return out


def curve(P, pp, train):
    """tau^2(e) = a / (e + c), least squares over the snapshot weeks, from the train snapshots;
    returns (a, c, raw tau by week)"""
    raw = {}
    for e in np.unique(P['e']):
        rows = np.flatnonzero(train & (P['e'] == e))
        if len(rows) < 500: continue
        b = G.fit(P, rows, [0, 1])
        raw[e] = max(excess(P, pp, rows, b).mean(), 0.0)
    es = np.array(list(raw), float); v = np.array([raw[e] for e in raw])
    (a, c), _ = curve_fit(lambda e, a, c: a / (e + c), es, v, p0=(400.0, 5.0), bounds=([0, -2.9], [1e5, 100]))
    return a, c, {int(e): math.sqrt(raw[e]) for e in raw}


def new_taus(P, pp):
    """tau per snapshot, fitted leaving its season out: raw per week, then tau^2 = a / (e + c)"""
    tau = np.zeros(len(P['e'])); curves = {}
    for s in np.unique(P['season']):
        a, c, raw = curve(P, pp, P['season'] != s)
        curves[int(s)] = (a, c, raw)
        test = P['season'] == s
        tau[test] = np.sqrt(a / (P['e'][test] + c))
    return tau, curves


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--sims', type=int, default=4000); a = ap.parse_args()
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12]
    pp, ok = TO.playoff_points(data)
    data = [r for r, k in zip(data, ok) if k]; pp = pp[ok]
    P = G.pack(data); B = len(data)
    off5, tau5 = G.offsets(P)
    tau_new, curves = new_taus(P, pp)
    print('tau by snapshot week (one fold, 2025 held out): shipped / raw incl. playoffs / smoothed')
    a_, c_, raw = curves[2025]
    for e in sorted(raw):
        sel = (P['e'] == e) & (P['season'] == 2025)
        print(f'  week {e:2d}: {tau5[3][sel].mean() if sel.any() else float("nan"):5.2f} / {raw[e]:5.2f} / {math.sqrt(a_ / (e + c_)):5.2f}')
    names = ['fitted + tau (shipped)', 'fitted + tau incl. playoffs']
    off = np.stack([off5[3], off5[3]]); tau = np.stack([tau5[3], tau_new]); sd = np.repeat(P['sd'][None], 2, 0)
    implied = np.stack([R.schedule_divisions(r) for r in data])
    gen = torch.Generator(device=G.DEV).manual_seed(0); gdiv = torch.Generator(device=G.DEV).manual_seed(1)
    res = {k: np.zeros((2, B)) for k in ('playoff Brier', 'title Brier', 'last Brier')}
    chunk = max(1, int(1.2e8 // (2 * a.sims * 12)))
    for s0 in range(0, B, chunk):
        ii = np.arange(s0, min(s0 + chunk, B))
        div = torch.where(R.t(implied[ii] >= 0, torch.bool), R.t(implied[ii], torch.int64), R.random_divisions(gdiv, len(ii)))
        real_r, _, real_c, real_l = R.season(P, ii, 12, 1, gen, 'real', div=div, bracket=pp[ii])
        Fr, _, Fc, Fl = R.season(P, ii, 12, a.sims, gen, 'real', (off[:, ii], tau[:, ii], sd[:, ii]), div=div, bracket=True)
        res['playoff Brier'][:, ii] = ((Fr.cumsum(-1)[..., 5] - real_r.cumsum(-1)[..., 5]) ** 2).mean(-1).cpu().numpy()
        res['title Brier'][:, ii] = ((Fc - real_c[0]) ** 2).mean(-1).cpu().numpy()
        res['last Brier'][:, ii] = ((Fl - real_l[0]) ** 2).mean(-1).cpu().numpy()
    print(f'\n{B} snapshots, {len(set(P["league"]))} league-seasons, {a.sims} simulated seasons each')
    seasons = np.unique(P['season'])
    for k, v in res.items():
        d = v[1] - v[0]
        for label, sel in (('all weeks', np.ones(B, bool)), ('weeks 12-14', P['e'] >= 12)):
            m, lo, hi = G.interval(P, d, sel)
            per = [d[sel & (P['season'] == s)].mean() for s in seasons]
            meets = sum(x <= -0.0005 for x in per)
            print(f'  {k:13s} {label:11s}: {v[0][sel].mean():.4f} -> {v[1][sel].mean():.4f}  {m:+.5f} [{lo:+.5f}, {hi:+.5f}]  '
                  f'better in {sum(x < 0 for x in per)} of 8, >= 0.0005 in {meets}')


if __name__ == '__main__':
    main()
