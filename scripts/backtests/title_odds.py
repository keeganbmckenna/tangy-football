"""Title and last-place odds under our rules: is the shipped model right about the playoffs too?

The site's fitted model (shipped 2026-10-22) carries each team's persistent offset into the
playoff weeks, so it moves the title and toilet-bowl odds as well, which nothing had tested.
Every crawled 12-team league-season, every snapshot week, our rules (divisions from the
schedule where it implies them; 6-team bracket, 3 v 6 and 4 v 5, then 1 and 2 host, then the
final; the other 6 play the lower-score-advances toilet bowl): the champion and last place
are rebuilt from the league's actual playoff-week points (the crawl keeps three playoff weeks),
and each model's odds are scored against them (Brier, log loss; intervals resample leagues).

Check first: on our own league, replaying the real regular seasons and playoff weeks through the
same bracket must give our real champions (data/sleeper winners_bracket).

    python title_odds.py [--sims 4000]
"""
import argparse, glob, gzip, json, os
import numpy as np
import torch
import gpu_sim as G
import own_league as OL
import rank_odds as R
from common import ARCHIVE

HERE = os.path.dirname(os.path.abspath(__file__))


def playoff_points(data):
    """Actual points in the three playoff weeks per snapshot (B, 3, 12), and which snapshots have them"""
    by = {}
    for f in glob.glob(os.path.join(HERE, 'cache', 'leagues', '*', '*.json.gz')):
        lid = os.path.basename(f)[:-8]
        by[lid] = f
    cache, out, ok = {}, np.zeros((len(data), 3, 12)), np.zeros(len(data), bool)
    for i, r in enumerate(data):
        lid = r['league']
        if lid not in cache:
            d = json.load(gzip.open(by[lid], 'rt')); M = d['matchups']
            weeks = [str(r['end'] + k) for k in (1, 2, 3)]
            cache[lid] = None if any(w not in M for w in weeks) else [{m['roster_id']: m.get('points') for m in M[w]} for w in weeks]
        pw = cache[lid]
        if pw and all(pw[k].get(j) is not None for k in range(3) for j in r['ids']):
            out[i] = [[pw[k][j] for j in r['ids']] for k in range(3)]; ok[i] = True
    return out, ok


def check_own_league():
    rows, divs, _ = OL.own_snapshots(); gen = torch.Generator(device=G.DEV).manual_seed(0)
    for s in OL.SEASONS:
        L = json.load(gzip.open(os.path.join(ARCHIVE, s, 'league.json.gz'), 'rt')); end = L['settings']['playoff_week_start'] - 1
        r = [x for x in rows if x['season'] == s][-1]  # the last snapshot; replay it to the end
        P = G.pack([r])
        pw = [{m['roster_id']: m.get('points') or 0 for m in json.load(gzip.open(os.path.join(ARCHIVE, s, 'matchups', f'{w}.json.gz'), 'rt'))} for w in (end + 1, end + 2, end + 3)]
        bracket = np.array([[[pw[k][j] for j in r['ids']] for k in range(3)]])
        div = R.t(divs[s][None], torch.int64) if divs[s] is not None else None
        *_, champ, last = R.season(P, np.array([0]), 12, 1, gen, 'real', div=div, bracket=bracket)
        mine = r['ids'][int(champ[0, 0].argmax())]
        wb = json.load(gzip.open(os.path.join(ARCHIVE, s, 'winners_bracket.json.gz'), 'rt'))
        real = next((g['w'] for g in wb if g.get('p') == 1), None)
        print(f'  {s}: rebuilt champion roster {mine}, real {real} -> {"match" if mine == real else "DIFFER"}')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--sims', type=int, default=4000); a = ap.parse_args()
    print('check: our league, real seasons replayed through the bracket')
    check_own_league()
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12]
    pp, ok = playoff_points(data)
    data = [r for r, k in zip(data, ok) if k]; pp = pp[ok]
    P = G.pack(data); B = len(data)
    off5, tau5 = G.offsets(P)  # coin flip, lineup 0.3, fitted lineup+ppg, fitted + tau, perfect strength
    names = ['coin flip', 'site (0.75)', 'fitted, no tau', 'fitted + tau (shipped)']
    off = np.stack([off5[0], 0.75 * P['X'][:, :, 0] * P['teams'], off5[2], off5[3]]); tau = np.stack([tau5[0], tau5[0], tau5[2], tau5[3]])
    sd = np.repeat(P['sd'][None], 4, 0)
    implied = np.stack([R.schedule_divisions(r) for r in data])
    gen = torch.Generator(device=G.DEV).manual_seed(0); gdiv = torch.Generator(device=G.DEV).manual_seed(1)
    res = {k: np.zeros((4, B)) for k in ('title Brier', 'title log loss', 'last Brier', 'playoff Brier')}
    chunk = max(1, int(1.2e8 // (4 * a.sims * 12)))
    for s0 in range(0, B, chunk):
        ii = np.arange(s0, min(s0 + chunk, B))
        div = torch.where(R.t(implied[ii] >= 0, torch.bool), R.t(implied[ii], torch.int64), R.random_divisions(gdiv, len(ii)))
        real_r, _, real_c, real_l = R.season(P, ii, 12, 1, gen, 'real', div=div, bracket=pp[ii])
        Fr, _, Fc, Fl = R.season(P, ii, 12, a.sims, gen, 'real', (off[:, ii], tau[:, ii], sd[:, ii]), div=div, bracket=True)
        yc, yl = real_c[0], real_l[0]
        res['title Brier'][:, ii] = ((Fc - yc) ** 2).mean(-1).cpu().numpy()
        res['title log loss'][:, ii] = -(torch.log(Fc.clamp(1 / a.sims, 1)) * yc).sum(-1).cpu().numpy()
        res['last Brier'][:, ii] = ((Fl - yl) ** 2).mean(-1).cpu().numpy()
        res['playoff Brier'][:, ii] = ((Fr.cumsum(-1)[..., 5] - real_r.cumsum(-1)[..., 5]) ** 2).mean(-1).cpu().numpy()
    print(f'\n{B} snapshots ({len(set(P["league"]))} 12-team league-seasons with all three playoff weeks), weeks 3-14, {a.sims} simulated seasons')
    print(f"{'':>24}" + ''.join(f'{k:>16}' for k in res))
    for m in range(4): print(f'{names[m]:>24}' + ''.join(f'{v[m].mean():16.4f}' for v in res.values()))
    print('\nby snapshot week, title Brier (coin flip / site / fitted no tau / fitted + tau):')
    for e in np.unique(P['e']):
        sel = P['e'] == e
        print(f'  week {e:2d}: ' + ' / '.join(f'{res["title Brier"][m, sel].mean():.4f}' for m in range(4)))
    seasons = np.unique(P['season']); everything = np.ones(B, bool)
    print('\ndifferences, 95% interval resampling leagues (seasons better of 8):')
    for i, j in ((3, 1), (3, 0), (3, 2)):
        for k, v in res.items():
            d = v[i] - v[j]; mm, lo, hi = G.interval(P, d, everything)
            print(f'  {names[i]} - {names[j]}, {k:>14}: {mm:+.5f} [{lo:+.5f}, {hi:+.5f}] ({sum(d[P["season"] == s].mean() < 0 for s in seasons)})')


if __name__ == '__main__':
    main()
