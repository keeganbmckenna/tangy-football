"""The one-piece price model (faab_model.py --trend) with what the team-by-team data adds, as
inputs: summaries of the bidder's rivals (no model), and the rival model's own forecast
(faab_rivals.py, shared effect sigma 1.5 / lam 0.25 as tuned there), cross-fitted so no
training bid sees a rival model fitted on its own season.

  summaries  rivals with need (lineup gain 1+) and 10%+ of the budget left; the most money any
             rival could credibly bid (min of its remaining budget and its shrunk largest bid so
             far); the most such money among rivals with need; rivals' shrunk mean bid (largest,
             among those with need); the sum of rivals' claims per processing
  stacked    the rival model's logit P(highest rival bid <= c) at c = -1 (nobody), 0, 5%, 20%

Rule set before the run (2026-11-19): as faab_rivals.py, against faab_model --trend, fit
2018-2023, test 2024-2025, log loss and grid Brier intervals below 0 in both test seasons.
Ablation: summaries only.

    ../../.venv/bin/python faab_stack.py [--summaries-only] [--export PATH]
"""
import argparse, json, os
import numpy as np
import pandas as pd
import faab_model as FM
import faab_rivals as FR

AUCTION = FR.AUCTION
STACK_AT = [-1.0, 0.0, 0.05, 0.22]
EXTRA = []


def summaries(t):
    """Per team row: summaries of the other teams in its auction"""
    n = t.claims
    shr = lambda col, prior: (t[col].fillna(prior) * n + prior * FR.PRIOR) / (n + FR.PRIOR)
    need = (t.gain >= 1.0)
    credible = np.minimum(t.rem.clip(lower=0), shr('max_bid', 0.15))
    d = pd.DataFrame({'k': t.groupby(AUCTION, observed=True).ngroup().values,
                      'live_need': (need & (t.rem >= 0.1)).astype(float), 'cred': credible, 'cred_need': np.where(need, credible, 0.0),
                      'mb': shr('mean_bid', 0.05), 'mb_need': np.where(need, shr('mean_bid', 0.05), 0.0), 'rate': t.claim_rate.clip(0, 3)})
    out = {}
    g = d.groupby('k')
    # waiver order stand-in: the share of the other teams with a better record (ties count half)
    wp = t.win_pct.values
    better = pd.Series(wp).groupby(d.k.values).rank(method='average', ascending=False).values  # 1 = best record
    out['r_better'] = (better - 1) / (g['k'].transform('size').values - 1).clip(min=1)
    for c in ('live_need', 'rate'):
        out['r_' + c] = (g[c].transform('sum') - d[c]).values  # sum over the others
    for c in ('cred', 'cred_need', 'mb', 'mb_need'):
        out['r_' + c] = others_max(d.k.values, d[c].values)
    return pd.DataFrame(out, index=t.index)


def others_max(k, v):
    """For each row, the max of v over the other rows of its group (0 if none)"""
    order = np.lexsort((-v, k))
    ks = k[order]; first = np.r_[True, ks[1:] != ks[:-1]]
    rank = np.zeros(len(k), int); start = np.maximum.accumulate(np.where(first, np.arange(len(k)), 0))
    rank[order] = np.arange(len(k)) - start
    top = np.zeros(k.max() + 1); sec = np.zeros(k.max() + 1)
    top[ks[first]] = v[order][first]
    second = np.r_[False, (~first[1:]) & first[:-1]]  # the row right after each group's first
    sec[ks[second]] = v[order][second]
    return np.where(rank == 0, sec[k], top[k])


SPLINES = False
KNOTS = {  # fixed knots (so train and test share them): raw column -> knots
    'val': [3, 6, 9, 12], 'val_now': [3, 6, 9, 12], 'trend_rel': [0.05, 0.15, 0.35, 0.6], 'trend_rank': [3, 10, 30, 80],
    'last_pts': [3, 8, 15, 22], 'weeks_left_raw': [2, 5, 8, 11], 'r_cred': [0.1, 0.25, 0.45, 0.7], 'med_price': [0.01, 0.02, 0.04, 0.08],
}


def spline_terms(df):
    """Cubic truncated-power terms at fixed knots, and the interactions that plausibly matter"""
    x = {c: df[c].fillna(0).astype(float).values for c in KNOTS if c in df}
    x['weeks_left_raw'] = (df.end - df.leg + 1).astype(float).values
    x['trend_rank'] = np.log(df.trend_rank.values); x['med_price'] = df.med_price.fillna(0.02).values
    f = {}
    for c, ks in KNOTS.items():
        v = x[c]; ks = np.log(ks) if c == 'trend_rank' else np.array(ks, float)
        for i, k in enumerate(ks): f[f'sp_{c}_{i}'] = np.clip(v - k, 0, None) ** 3 / (ks[-1] - ks[0]) ** 3
    tr, wl, v = np.sqrt(x['trend_rel'].clip(0, 1)), np.log(x['weeks_left_raw']), np.log1p(x['val'].clip(0))
    f['ix_trend_weeks'] = tr * wl; f['ix_val_weeks'] = v * wl; f['ix_cred_trend'] = np.sqrt(x['r_cred'].clip(0)) * tr
    f['ix_price_val'] = np.log(x['med_price'] + 0.005) * v; f['ix_trend_last'] = tr * np.log1p(x['last_pts'].clip(0))
    return pd.DataFrame(f, index=df.index)


def features(df):
    f = BASE_FEATURES(df)
    if SPLINES: f = pd.concat([f, spline_terms(df).set_index(f.index)], axis=1)
    if 'r_live_need' in df:
        f['r_live_need'] = np.log1p(df.r_live_need.values)
        f['r_cred'] = np.sqrt(df.r_cred.values); f['r_cred_need'] = np.sqrt(df.r_cred_need.values)
        f['r_mb'] = np.log(df.r_mb.values + 0.005); f['r_mb_need'] = np.log(df.r_mb_need.values + 0.005)
        f['r_rate'] = np.log1p(df.r_rate.values)
    for c in STACK_AT:
        col = f'stk_{c}'
        if col in df: f[col] = np.log(df[col].clip(1e-4, 1 - 1e-4) / (1 - df[col].clip(1e-4, 1 - 1e-4)))
    return f


BASE_FEATURES = FM.features


def rival_forecast(fit_rows, pred_rows):
    R = FR.Rivals().fit(fit_rows); R.sigma, R.lam = 1.5, 0.25
    G = R.rival_cdf(pred_rows)
    idx = [FM.GRID.index(c) for c in STACK_AT]
    return G[:, idx]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--summaries-only', action='store_true'); ap.add_argument('--export')
    ap.add_argument('--ties', action='store_true', help='tie chance from record (waiver order stand-in) instead of 0.5')
    ap.add_argument('--splines', action='store_true', help='curves and interactions on the key inputs')
    ap.add_argument('--trend24', action='store_true', help='trending over the last 24 hours too'); a_ = ap.parse_args()
    global SPLINES
    FM.CROWD = 'trend'
    t, a = FR.load()
    t = pd.concat([t, summaries(t)], axis=1)
    if not a_.summaries_only:
        stk = np.full((len(t), len(STACK_AT)), np.nan)
        train = t.season.isin(FM.TRAIN).values
        for s in FM.TRAIN:
            fold = (t.season == s).values
            stk[fold] = rival_forecast(t[train & ~fold].reset_index(drop=True), t[fold].reset_index(drop=True))
            print(f'  cross-fitted rival forecast for {s}', flush=True)
        test = ~train
        stk[test] = rival_forecast(t[train].reset_index(drop=True), t[test].reset_index(drop=True))
        for i, c in enumerate(STACK_AT): t[f'stk_{c}'] = stk[:, i]
    keep = [c for c in t.columns if c.startswith('r_') or c.startswith('stk_')]
    bid_rows = t[t.bid.notna()][AUCTION + ['roster'] + keep]
    a = a.copy(); a['league'] = a.league.astype(str); a['player'] = a.player.astype(str)
    a = a.merge(bid_rows, on=AUCTION + ['roster'], how='inner')
    tr, te = a[a.season.isin(FM.TRAIN)].reset_index(drop=True), a[a.season.isin(FM.TEST)].reset_index(drop=True)
    print(f'bids: train {len(tr):,}, test {len(te):,}')
    base = FM.Model().fit(tr)
    FM.features = features
    SPLINES = a_.splines; FM.TREND24 = a_.trend24
    new = FM.Model().fit(tr)
    G = {'stacked': new.cdf(te)}
    FM.features = BASE_FEATURES
    G['one-piece'] = base.cdf(te)
    tie = 0.5
    if a_.ties:
        # fitted on training bids that tied the top rival bid: P(win | tie) from the record share
        at_tie = np.abs(tr.bid.values - tr.H.values) < 1e-9
        X = tr.r_better.values[at_tie][:, None]
        w = FM.fit_logit((X - 0.5) / 0.3, tr.won.values[at_tie].astype(float))
        tie = 1 / (1 + np.exp(-(w[0] + w[1] * (te.r_better.values - 0.5) / 0.3)))
        print(f'  tie model: {at_tie.sum():,} training ties; P(win tie) {tie.min():.0%} (best record) to {tie.max():.0%} (worst)')
        res = {'stacked': FM.scores(te, G['stacked'], tie), 'one-piece': FM.scores(te, G['one-piece'])}
    else:
        res = {k: FM.scores(te, g) for k, g in G.items()}
    for k, (p, ll, br, gb) in res.items(): print(f'  {k:10} log loss {ll.mean():.4f}  Brier {br.mean():.4f}  grid Brier {gb.mean():.4f}')
    adopt = True
    for name, i in (('log loss', 1), ('grid Brier', 3)):
        for s in FM.TEST:
            m = te.season.values == s
            d, lo, hi = FM.boot(res['stacked'][i][m] - res['one-piece'][i][m], te.league.values[m])
            adopt &= hi < 0
            print(f'  stacked - one-piece {name:10} {s}: {d:+.4f} [{lo:+.4f}, {hi:+.4f}] {"ok" if hi < 0 else "FAIL"}')
    print('ADOPT' if adopt else 'NOT ADOPTED')
    y = te.won.values
    cut = np.digitize(te.bid.values, [1e-9, 0.0100001, 0.0300001, 0.0600001, 0.1000001, 0.2000001])
    print('\nby bid: P(win) [stacked, one-piece] vs won; P(nobody else) [stacked, one-piece] vs actual')
    for i, lab in enumerate(['$0', '<=1%', '1-3%', '3-6%', '6-10%', '10-20%', '>20%']):
        m = cut == i
        print(f'  {lab:7} {res["stacked"][0][m].mean():6.1%} {res["one-piece"][0][m].mean():6.1%} {y[m].mean():6.1%}   '
              f'{G["stacked"][m, 0].mean():6.1%} {G["one-piece"][m, 0].mean():6.1%} {np.mean(te.H.values[m] < 0):6.1%}  ({m.sum():,})')
    print('\ncalibration of P(H <= c), stacked vs actual')
    for k, c in enumerate(FM.GRID):
        print(f'  c={c:5.2f}  {G["stacked"][:, k].mean():6.1%} {np.mean(te.H.values <= c + 1e-9):6.1%}')
    if a_.export:
        FM.features = features
        full = FM.Model().fit(a.reset_index(drop=True))
        json.dump(full.export(), open(a_.export, 'w'))
        print(f'wrote {a_.export}')


if __name__ == '__main__':
    main()
