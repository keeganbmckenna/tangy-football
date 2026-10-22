"""Single-game win odds (the trade tools' weekly odds): the earlier model vs the fitted one.

The trade tools still give each game's win odds from the earlier model (trade.ts
weeklyWinProbability): expected scores = league average + 0.75 x that week's lineup gap, and
P(win) = Phi(difference / (s x spread x sqrt 2)) with s = 0.8 next week and 2 after. Candidates:

  A  earlier (today)       as above
  B  fitted (shipped)      the playoff model's expected scores (fittedStrength: lineup averaged
                           over the remaining weeks, points per game), P(win) =
                           Phi(difference / sqrt(2 (spread^2 + tau^2))): weekly noise plus each
                           team's persistent uncertainty
  C  fitted, week lineup   B with that week's own lineup in place of the average (byes and
                           injuries count in their week): offset + lineup weight x (week gap -
                           average gap)
  D  C, scale fitted       C with one spread multiplier per horizon (next week / later), fitted
                           by maximum likelihood leaving the season out
  E  single-week fit       fixed after the first run (A won next week, C later): fitted for the
                           target itself. For each horizon and snapshot week, a team's score
                           that week (centred on the league's) regressed on that week's lineup
                           gap and its points-per-game gap, leaving the season out; P(win) =
                           Phi(difference / sqrt(2 x residual variance)). Must beat A next week
                           (the rule above) and 2-4 weeks ahead.

Every crawled 12-team league-season, every snapshot week from 3 (fitted leaving the season
out), each game in the next 4 weeks: next week (h = 1) and later (h = 2-4) separately. Rule set
before the run: replace A only with a Brier gain of at least 0.0005 on next week's games, 95%
interval resampling leagues excluding zero, better in at least 5 of 8 seasons.

    python single_games.py [--workers 8]
"""
import argparse, glob, gzip, json, math, os
from multiprocessing import Pool
import numpy as np
import torch
import gpu_sim as G
import leagues_fit as LF

HERE = os.path.dirname(os.path.abspath(__file__))
H = 4


def week_lineups(path):
    """(league_id, e) -> site-value lineup per team for weeks e .. e+H-1 (H x 12)"""
    d = json.load(gzip.open(path, 'rt')); L = d['league']; M = {int(w): m for w, m in d['matchups'].items()}
    if len(d['rosters']) != 12 or L['league_id'] in LF.OURS: return {}
    end = (L['settings'].get('playoff_week_start') or 15) - 1
    if any(w not in M for w in range(1, end + 1)): return {}
    ids = sorted(m['roster_id'] for m in M[1]); slots = L['roster_positions']; ppr = L['scoring_settings'].get('rec')
    out = {}
    for e in range(3, end + 1):
        vals = LF.table(L['season'], e, ppr); rosters = {m['roster_id']: (m.get('players') or []) for m in M[e]}
        out[(L['league_id'], e)] = np.array([[LF.lineup(rosters.get(r, []), vals, slots, w, 0) if w <= end else np.nan for r in ids]
                                             for w in range(e, e + H)])
    return out


def Phi(x): return 0.5 * (1 + torch.erf(x / math.sqrt(2)))


def load_lineups(data, workers=8):
    """Per-week lineups (B, H, 12) for the snapshots, computed once and cached"""
    cache = os.path.join(HERE, 'cache', 'single_games_lineups.npz')
    if os.path.exists(cache):
        z = np.load(cache, allow_pickle=True); lineups = dict(zip(map(tuple, z['keys']), z['vals']))
    else:
        files = sorted(glob.glob(os.path.join(HERE, 'cache', 'leagues', '*', '*.json.gz'))); lineups = {}
        with Pool(workers) as pool:
            for part in pool.imap_unordered(week_lineups, files, chunksize=8): lineups.update(part)
        keys = list(lineups); np.savez(cache, keys=np.array(keys, dtype=object), vals=np.array([lineups[k] for k in keys]))
    return np.stack([lineups[(r['league'], r['e'])] for r in data])


def week_scores(data, T=12):
    """Each team's score in weeks e .. e+H-1, centred on the league's that week (B, H, T)"""
    Y = np.full((len(data), H, T), np.nan)
    for b, r in enumerate(data):
        for hh in range(H):
            w = r['e'] + hh
            if w <= r['end']:
                v = np.array([r['pts'][w][i] for i in r['ids']]); Y[b, hh, :len(v)] = v - v.mean()
    return Y


def fit_single_week(P, Lw_gap, Y, rows, hh):
    """E's weights for one horizon on the given snapshots: (lineup, ppg), residual sd"""
    m = P['teams'][rows]
    Xf = np.stack([Lw_gap[rows, hh], P['X'][rows][:, :, 1]], -1)[m]; yv = Y[rows, hh][m]; ok = np.isfinite(yv) & np.isfinite(Xf).all(1)
    bb, *_ = np.linalg.lstsq(Xf[ok], yv[ok], rcond=None)
    return bb, math.sqrt(np.mean((yv[ok] - Xf[ok] @ bb) ** 2))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--workers', type=int, default=8); a = ap.parse_args()
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12]
    cache = os.path.join(HERE, 'cache', 'single_games_lineups.npz')
    if os.path.exists(cache):
        z = np.load(cache, allow_pickle=True); lineups = dict(zip(map(tuple, z['keys']), z['vals']))
    else:
        files = sorted(glob.glob(os.path.join(HERE, 'cache', 'leagues', '*', '*.json.gz'))); lineups = {}
        with Pool(a.workers) as pool:
            for part in pool.imap_unordered(week_lineups, files, chunksize=8): lineups.update(part)
        keys = list(lineups); np.savez(cache, keys=np.array(keys, dtype=object), vals=np.array([lineups[k] for k in keys]))
    P = G.pack(data); B, T = P['y'].shape; m = P['teams']
    Lw = np.stack([lineups[(r['league'], r['e'])] for r in data])  # (B, H, 12)
    Lw_gap = Lw - np.nanmean(Lw, -1, keepdims=True)
    off5, tau5 = G.offsets(P); fit_off, fit_tau = off5[3], tau5[3]
    bL = np.zeros(B)
    for s in np.unique(P['season']):
        for e in np.unique(P['e']):
            te = (P['season'] == s) & (P['e'] == e); tr = (P['season'] != s) & (P['e'] == e)
            if te.any(): bL[te] = G.fit(P, tr, [0, 1])[0]
    # games: (snapshot, horizon, team a, team b, a won)
    rows = []
    for b, r in enumerate(data):
        for h in range(H):
            w = r['e'] + h
            if w > r['end']: break
            for x, y in r['games'][w]:
                pa, pb = r['pts'][w][r['ids'][x]], r['pts'][w][r['ids'][y]]
                if pa != pb: rows.append((b, h, x, y, float(pa > pb)))
    g = np.array(rows); bi, h, x, y, won = g[:, 0].astype(int), g[:, 1].astype(int), g[:, 2].astype(int), g[:, 3].astype(int), g[:, 4]
    sd = P['sd'][bi]; lg_gap = lambda arr: arr[bi, x] - arr[bi, y]
    dA = 0.75 * (Lw_gap[bi, h, x] - Lw_gap[bi, h, y])
    pA = 0.5 * (1 + np.vectorize(math.erf)(dA / (np.where(h == 0, 0.8, 2.0) * sd * math.sqrt(2)) / math.sqrt(2)))
    dB = lg_gap(fit_off); vB = np.sqrt(2 * (sd ** 2 + fit_tau[bi] ** 2))
    dC = dB + bL[bi] * ((Lw_gap[bi, h, x] - Lw_gap[bi, h, y]) - (P['X'][bi, x, 0] - P['X'][bi, y, 0]))
    erf = np.vectorize(math.erf)
    pB = 0.5 * (1 + erf(dB / vB / math.sqrt(2))); pC = 0.5 * (1 + erf(dC / vB / math.sqrt(2)))
    # D: one multiplier per horizon group (next week / later), fitted by likelihood leaving the season out
    season = P['season'][bi]; pD = np.zeros_like(pC); grid = np.arange(0.5, 2.51, 0.02)
    for s in np.unique(season):
        for later in (False, True):
            sel = (h > 0) if later else (h == 0)
            tr, te = sel & (season != s), sel & (season == s)
            ll = [np.mean(-(won[tr] * np.log(np.clip(0.5 * (1 + erf(dC[tr] / (k * vB[tr]) / math.sqrt(2))), 1e-6, 1)) +
                            (1 - won[tr]) * np.log(np.clip(1 - 0.5 * (1 + erf(dC[tr] / (k * vB[tr]) / math.sqrt(2))), 1e-6, 1)))) for k in grid]
            k = grid[int(np.argmin(ll))]; pD[te] = 0.5 * (1 + erf(dC[te] / (k * vB[te]) / math.sqrt(2)))
            if s == np.unique(season)[-1]: print(f'D multiplier ({"later" if later else "next week"}), held out {s}: {k:.2f}')
    # E: single-week regressions per horizon and snapshot week, leaving the season out
    ppg = P['X'][:, :, 1]; Y = np.full((B, H, T), np.nan)
    for b_, r in enumerate(data):
        for hh in range(H):
            w = r['e'] + hh
            if w <= r['end']:
                v = np.array([r['pts'][w][i] for i in r['ids']]); Y[b_, hh, :len(v)] = v - v.mean()
    pE = np.zeros_like(pC); coef = {}
    for s in np.unique(P['season']):
        for e in np.unique(P['e']):
            for hh in range(H):
                tr = (P['season'] != s) & (P['e'] == e); te_g = (season == s) & (P['e'][bi] == e) & (h == hh)
                if not te_g.any(): continue
                Xf = np.stack([Lw_gap[tr, hh], ppg[tr]], -1)[m[tr]]; yv = Y[tr, hh][m[tr]]; ok = np.isfinite(yv) & np.isfinite(Xf).all(1)
                bb, *_ = np.linalg.lstsq(Xf[ok], yv[ok], rcond=None); rv = np.mean((yv[ok] - Xf[ok] @ bb) ** 2)
                diff = bb[0] * (Lw_gap[bi[te_g], hh, x[te_g]] - Lw_gap[bi[te_g], hh, y[te_g]]) + bb[1] * (ppg[bi[te_g], x[te_g]] - ppg[bi[te_g], y[te_g]])
                pE[te_g] = 0.5 * (1 + erf(diff / np.sqrt(2 * rv) / math.sqrt(2)))
                if s == np.unique(P['season'])[-1] and e in (4, 8, 12): coef[(e, hh)] = (bb, math.sqrt(rv))
    for (e, hh), (bb, rs) in sorted(coef.items()):
        print(f'E, held out last season, week {e}, {hh + 1} week(s) ahead: lineup {bb[0]:.2f}, ppg {bb[1]:.2f}, residual sd {rs:.1f}')
    names = ['A earlier (today)', 'B fitted (shipped)', 'C fitted, week lineup', 'D C, scale fitted', 'E single-week fit']
    probs = [pA, pB, pC, pD, pE]
    league = P['league'][bi]; Pi = {'league': league}
    print(f'\n{len(g):,} games from {len(set(league))} 12-team league-seasons ({(h == 0).sum():,} next week, {(h > 0).sum():,} 2-4 weeks ahead)')
    for lab, sel in (('next week', h == 0), ('2-4 weeks ahead', h > 0)):
        print(f'\n{lab}:' + f"{'Brier':>12}{'log loss':>12}")
        br = [(p - won) ** 2 for p in probs]; lo = [-(won * np.log(np.clip(p, 1e-6, 1)) + (1 - won) * np.log(np.clip(1 - p, 1e-6, 1))) for p in probs]
        for n, b_, l_ in zip(names, br, lo): print(f'  {n:<24}{b_[sel].mean():10.4f}{l_[sel].mean():12.4f}')
        for i in (1, 2, 3, 4):
            d = br[i] - br[0]; mm, l1, h1 = G.interval(Pi, d, sel); dl = lo[i] - lo[0]; ml, l2, h2 = G.interval(Pi, dl, sel)
            won_s = sum(d[sel & (season == s)].mean() < 0 for s in np.unique(season))
            print(f'  {names[i]} - A: Brier {mm:+.5f} [{l1:+.5f}, {h1:+.5f}] ({won_s} of 8 seasons); log loss {ml:+.4f} [{l2:+.4f}, {h2:+.4f}]')
        # calibration: predicted vs actual in bins
        for i in (0, 3, 4):
            p = probs[i][sel]; yv = won[sel]; edges = [0, .2, .35, .5, .65, .8, 1.01]
            print(f'  calibration {names[i][:1]}: ' + '  '.join(f'{p[(p >= lo_) & (p < hi_)].mean():.2f}->{yv[(p >= lo_) & (p < hi_)].mean():.2f}' for lo_, hi_ in zip(edges[:-1], edges[1:]) if ((p >= lo_) & (p < hi_)).any()))


if __name__ == '__main__':
    main()
