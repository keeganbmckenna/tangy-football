"""What it takes to win a FAAB claim: the chance a bid beats every other team's, fitted on the
crawled auctions (faab_auctions.py) and checked out of sample.

Target: H, the highest bid by another team on the player in that processing, as a share of the
budget (-1 when nobody else bid). The model gives G(c) = P(H <= c) on a grid of bid levels, one
L2-regularized logistic regression per level, made monotone. A bid b wins if H < b, and half
the time if H = b (Sleeper breaks ties by waiver order, which isn't modeled):

    P(win at b) = P(H < b) + 0.5 * P(H = b)

Split fixed before the run (2026-11-19): fit on 2018-2023, test on 2024-2025. Scores on the
test bids: log loss and Brier of the actual outcome (won) at the actual bid, the mean Brier of
1[H <= c] over the grid, calibration of P(win) by decile. Baselines, both fitted on the same
training seasons:
  position   the share of training bids at each level, by position x week (2-5, 6-9, 10+) x
             value fifth
  league     the league's own earlier bids this season (same position group), shrunk to the
             position baseline with 20 pseudo-bids
SHIP if the model's log loss and grid Brier beat both baselines with league-resampled 95%
intervals below 0, in both test seasons.

    ../../.venv/bin/python faab_model.py [--export ../../web/lib/analyze/faabModel.json]
"""
import argparse, json, os
import numpy as np
import pandas as pd
from scipy.optimize import minimize

HERE = os.path.dirname(os.path.abspath(__file__))
GRID = [-1.0, 0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.07, 0.10, 0.13, 0.17, 0.22, 0.30, 0.40, 0.55, 0.75]
POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
TRAIN, TEST = range(2018, 2024), (2024, 2025)
L2 = 1.0
SHRINK = 20


ROLE = True
CROWD = False
TREND24 = False


def features(df):
    """Model inputs, all computable on the site from the trade data and the league's transactions"""
    f = {}
    lv = np.log1p(df.val.clip(lower=0))
    for p in POS:
        on = (df.pos == p).astype(float)
        f[f'pos_{p}'] = on
        f[f'lval_{p}'] = on * lv
    f['val'] = df.val
    f['val_now'] = df.val_now
    f['lrank'] = np.log(df.fa_rank)
    f['top3'] = (df.fa_rank <= 3).astype(float)
    f['last'] = np.log1p(df.last_pts.clip(lower=0))
    f['surprise'] = (df.last_pts - df.val).clip(-10, 30) / 10
    f['weeks_left'] = np.log(df.end - df.leg + 1)
    f['spent'] = df.spent_share
    has = df.n_prev >= 5
    f['lprice'] = np.where(has, np.log(df.med_price.fillna(0.02) + 0.005), np.log(0.025))
    f['no_prev'] = (~has).astype(float)
    f['max_rem'] = df.max_rem
    f['max_rem_need'] = df.max_rem_need
    f['n_need'] = np.log1p(df.n_need)
    f['n_big'] = np.log1p(df.n_big)
    f['lgain'] = np.log1p(df.max_gain.clip(lower=0))
    f['lbudget'] = np.log(df.budget / 100)
    if ROLE:
        g = lambda c: df[c].fillna(0)
        f['snap'] = g('snap')
        f['lopps'] = np.log1p(g('opps'))
        f['opps_jump'] = (g('opps') - g('opps_avg')).clip(-10, 15) / 5
        f['proj'] = g('proj')
        f['proj_jump'] = (g('proj') - g('proj_prev')).clip(-10, 15) / 5
        f['mate_out'] = g('mate_out') / 10
    if CROWD == 'trend':  # what Sleeper's trending endpoint shows: rank (top 100) and count vs the top player
        f['trend_lrank'] = np.log(df.trend_rank)
        f['trend_top'] = (df.trend_rank <= 100).astype(float)
        f['trend_rel'] = np.sqrt(df.trend_rel.clip(0, 1))
        f['trend_x_val'] = f['trend_rel'] * np.log1p(df.val.clip(lower=0))
        if TREND24 and 'trend_rank24' in df:  # the last 24 hours too, and whether adds are speeding up
            f['trend24_lrank'] = np.log(df.trend_rank24)
            f['trend24_rel'] = np.sqrt(df.trend_rel24.clip(0, 1))
            f['trend_accel'] = np.log((df.trend_rel24 + 0.01) / (df.trend_rel + 0.01))
    elif CROWD == 'early':  # adds in other leagues before the bids were due (what trending shows)
        f['early'] = np.log(df.early + 0.001)
        f['early24'] = np.log(df.early24 + 0.001)
        f['early_x_val'] = f['early'] * np.log1p(df.val.clip(lower=0))
        # the player's place among that week's most-added (trending is a ranking too)
        pct = df.groupby(['season', 'leg']).early.rank(pct=True)
        f['early_pct'] = pct
        f['early_top'] = (pct >= 0.95).astype(float)
    elif CROWD == 'levels':  # what a manager could say: quiet / some buzz / everyone wants him
        f['buzz1'] = ((df.crowd >= 0.03) & (df.crowd < 0.15)).astype(float)
        f['buzz2'] = (df.crowd >= 0.15).astype(float)
    elif CROWD:
        f['crowd'] = np.log(df.crowd + 0.002)
        f['crowd_price'] = np.log(df.crowd_price.fillna(0) + 0.005)
    return pd.DataFrame(f)


def add_crowd(df):
    """Diagnostic only (not available live): how many other crawled leagues bid on the player
    that week, and their median winning bid"""
    leagues = df.groupby('season').league.nunique()
    per = df.groupby(['season', 'leg', 'player', 'league']).agg(price=('bid', lambda b: np.nan), n=('bid', 'size')).reset_index()
    wins = df[df.won].groupby(['season', 'leg', 'player', 'league']).bid.max().rename('win').reset_index()
    per = per.drop(columns='price').merge(wins, how='left')
    tot = per.groupby(['season', 'leg', 'player']).agg(k=('league', 'size'), wsum=('win', 'sum'), wn=('win', 'count')).reset_index()
    per = per.merge(tot)
    per['crowd'] = (per.k - 1) / per.season.map(leagues)
    per['crowd_price'] = (per.wsum - per.win.fillna(0)) / (per.wn - per.win.notna()).replace(0, np.nan)
    return df.merge(per[['season', 'leg', 'player', 'league', 'crowd', 'crowd_price']], how='left')


def fit_logit(X, y, l2=L2):
    n, k = X.shape

    def loss(w):
        z = X @ w[1:] + w[0]
        ll = np.logaddexp(0, z) - y * z
        g = 1 / (1 + np.exp(-z)) - y
        return ll.sum() / n + 0.5 * l2 / n * (w[1:] @ w[1:]), np.concatenate([[g.sum()], X.T @ g]) / n + np.concatenate([[0], l2 / n * w[1:]])

    r = minimize(loss, np.zeros(k + 1), jac=True, method='L-BFGS-B', options={'maxiter': 500})
    return r.x


class Model:
    def fit(self, df):
        F = features(df); self.cols = list(F.columns)
        self.mu = F.mean().values; self.sd = F.std().values + 1e-9
        X = (F.values - self.mu) / self.sd
        self.w = [fit_logit(X, (df.H.values <= c + 1e-9).astype(float)) for c in GRID]
        return self

    def cdf(self, df):
        X = (features(df)[self.cols].values - self.mu) / self.sd
        G = np.column_stack([1 / (1 + np.exp(-(X @ w[1:] + w[0]))) for w in self.w])
        return np.maximum.accumulate(G, axis=1)

    def export(self):
        return {'grid': GRID, 'features': self.cols, 'mean': self.mu.tolist(), 'sd': self.sd.tolist(),
                'weights': [[round(float(x), 6) for x in w] for w in self.w]}


def week_bin(leg):
    return np.where(leg <= 5, 0, np.where(leg <= 9, 1, 2))


class PositionBaseline:
    def fit(self, df):
        self.q = np.quantile(df.val, [0.2, 0.4, 0.6, 0.8])
        key = self.key(df); Y = np.column_stack([(df.H.values <= c + 1e-9) for c in GRID]).astype(float)
        self.table = pd.DataFrame(Y).groupby(key).mean()
        self.all = Y.mean(0)
        return self

    def key(self, df):
        return df.pos.values + '|' + week_bin(df.leg.values).astype(str) + '|' + np.searchsorted(self.q, df.val.values).astype(str)

    def cdf(self, df):
        V = self.table.reindex(self.key(df)).values
        miss = np.isnan(V).any(1); V[miss] = self.all
        return V


def league_baseline(df, prior):
    """Each league's earlier bids this season (same position), shrunk to the position baseline"""
    out = prior.copy()
    Y = np.column_stack([(df.H.values <= c + 1e-9) for c in GRID]).astype(float)
    grp = np.where(df.pos.isin(['K', 'DEF']), 'KD', 'X').astype(object)
    order = np.lexsort((df['when'].values, grp, df.league.values))
    sums, cnt, last = {}, {}, None
    i = 0
    idx = order
    while i < len(idx):
        j = i
        r = idx[i]; key = (df.league.values[r], grp[r]); t = df['when'].values[r]
        while j < len(idx) and (df.league.values[idx[j]], grp[idx[j]]) == key and df['when'].values[idx[j]] == t: j += 1
        s = sums.get(key, np.zeros(len(GRID))); n = cnt.get(key, 0)
        for r2 in idx[i:j]:
            out[r2] = (s + SHRINK * prior[r2]) / (n + SHRINK)
        sums[key] = s + Y[idx[i:j]].sum(0); cnt[key] = n + (j - i)
        i = j
    return out


def win_prob(G, bid, budget, tie=0.5):
    """P(H < b) + tie x P(H = b), with G interpolated linearly between grid levels; tie is the
    chance of winning a tie (Sleeper: waiver order), 0.5 unless known"""
    grid = np.array(GRID)

    def at(c):
        c = np.asarray(c, float)
        out = np.empty(len(c))
        for i in range(len(c)):
            out[i] = np.interp(c[i], grid, G[i], left=0.0, right=1.0) if c[i] >= -1 else 0.0
        return out
    step = 1.0 / budget
    below = at(bid - step + 1e-9)  # P(H <= b - $1) = P(H < b)
    upto = at(bid + 1e-9)
    return below + tie * (upto - below)


def scores(df, G, tie=0.5):
    p = np.clip(win_prob(G, df.bid.values, df.budget.values, tie), 1e-4, 1 - 1e-4)
    y = df.won.values.astype(float)
    ll = -(y * np.log(p) + (1 - y) * np.log(1 - p))
    br = (p - y) ** 2
    Y = np.column_stack([(df.H.values <= c + 1e-9) for c in GRID]).astype(float)
    gb = ((G - Y) ** 2).mean(1)
    return p, ll, br, gb


def boot(diff, league, n=2000, seed=0):
    rng = np.random.default_rng(seed)
    codes, inv = np.unique(league, return_inverse=True)
    sums = np.bincount(inv, diff); cnt = np.bincount(inv)
    bs = []
    for _ in range(n):
        k = rng.integers(0, len(codes), len(codes)); bs.append(sums[k].sum() / cnt[k].sum())
    return diff.mean(), *np.percentile(bs, [2.5, 97.5])


def main():
    global ROLE, CROWD
    ap = argparse.ArgumentParser(); ap.add_argument('--export'); ap.add_argument('--no-role', action='store_true')
    ap.add_argument('--crowd', action='store_true', help='diagnostic: add other leagues\' bids that week')
    ap.add_argument('--buzz', action='store_true', help='diagnostic: only a 3-level version of it')
    ap.add_argument('--early', action='store_true', help='adds in other leagues before the bids were due (faab_trending.py)')
    ap.add_argument('--trend', action='store_true', help='only what the trending endpoint shows: rank and relative count'); a = ap.parse_args()
    ROLE, CROWD = not a.no_role, ('trend' if a.trend else 'early' if a.early else 'levels' if a.buzz else a.crowd)
    df = pd.read_parquet(os.path.join(HERE, 'cache', 'faab_auctions.parquet'))
    df = df[df.budget >= 50].reset_index(drop=True)
    if CROWD: df = add_crowd(df)
    tr = df[df.season.isin(TRAIN)].reset_index(drop=True); te = df[df.season.isin(TEST)].reset_index(drop=True)
    print(f'train {len(tr):,} bids ({tr.league.nunique():,} league-seasons), test {len(te):,} ({te.league.nunique():,})')
    print(f'test: nobody else bid {np.mean(te.H < 0):.1%}; won {te.won.mean():.1%}; median bid {te.bid.median():.1%} of budget')

    M = Model().fit(tr); PB = PositionBaseline().fit(tr)
    G = {'model': M.cdf(te), 'position': PB.cdf(te)}
    G['league'] = league_baseline(te, G['position'])
    res = {k: scores(te, g) for k, g in G.items()}
    print('\nscores on the test bids (lower is better)')
    print(f'  {"":10} {"log loss":>9} {"Brier":>7} {"grid Brier":>11}')
    for k, (p, ll, br, gb) in res.items(): print(f'  {k:10} {ll.mean():9.4f} {br.mean():7.4f} {gb.mean():11.4f}')
    ship = True
    for base in ('position', 'league'):
        for name, i in (('log loss', 1), ('grid Brier', 3)):
            for s in TEST:
                m = te.season.values == s
                d, lo, hi = boot(res['model'][i][m] - res[base][i][m], te.league.values[m])
                ok = hi < 0; ship &= ok
                print(f'  model - {base:8} {name:10} {s}: {d:+.4f} [{lo:+.4f}, {hi:+.4f}] {"ok" if ok else "FAIL"}')
    print('SHIP' if ship else 'DO NOT SHIP')

    p = res['model'][0]; y = te.won.values
    print('\ncalibration, P(win) at the actual bid (model)')
    bins = np.quantile(p, np.linspace(0, 1, 11)); b = np.clip(np.searchsorted(bins, p, side='right') - 1, 0, 9)
    for i in range(10):
        m = b == i
        print(f'  {p[m].mean():6.1%} predicted  {y[m].mean():6.1%} won  ({m.sum():,})')
    print('\nby bid: P(win) predicted vs won, P(nobody else) predicted vs actual (model)')
    cut = np.digitize(te.bid.values, [1e-9, 0.0100001, 0.0300001, 0.0600001, 0.1000001, 0.2000001])
    for i, lab in enumerate(['$0', '<=1%', '1-3%', '3-6%', '6-10%', '10-20%', '>20%']):
        m = cut == i
        print(f'  {lab:7} {p[m].mean():6.1%} {y[m].mean():6.1%}   {G["model"][m, 0].mean():6.1%} {np.mean(te.H.values[m] < 0):6.1%}  ({m.sum():,})')
    print('\ncalibration of P(H <= c) by level (model, test)')
    for k, c in enumerate(GRID):
        yk = (te.H.values <= c + 1e-9)
        print(f'  c={c:5.2f}  predicted {G["model"][:, k].mean():6.1%}  actual {yk.mean():6.1%}')
    print('\nby position: P(win) predicted vs won (model)')
    for pos in POS:
        m = te.pos.values == pos
        print(f'  {pos:4} {p[m].mean():6.1%} {y[m].mean():6.1%} ({m.sum():,})')
    hi = te.val.values >= np.quantile(te.val, 0.9)
    print(f'  top-10% value players: {p[hi].mean():.1%} predicted, {y[hi].mean():.1%} won ({hi.sum():,})')

    # fitted on every season for the site
    full = Model().fit(df)
    print('\nweights (every season, standardized), level c=0.05:')
    for c_, w in sorted(zip(full.cols, full.w[GRID.index(0.05)][1:]), key=lambda x: -abs(x[1]))[:12]: print(f'  {c_:14} {w:+.3f}')
    if a.export:
        json.dump(full.export(), open(a.export, 'w'), indent=None)
        print(f'wrote {a.export}')


if __name__ == '__main__':
    main()
