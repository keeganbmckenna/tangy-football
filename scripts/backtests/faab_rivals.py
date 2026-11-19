"""The highest rival bid built team by team: each other team bids with some chance and, if it
does, some amount (never more than its remaining budget), and the highest of those is the bid
to beat. Against faab_model.py's one-piece model (with the trending rank), on the same bids.

  participation  P(team j bids on the player): logistic on the player (faab_model.features
                 with the trending rank), j's need (lineup gain, its rank in the league), its
                 money, its habits so far this season (claims per processing, mean / largest
                 bid, share at $0, share won; shrunk to the league-wide average with 5 pseudo-
                 claims), its record. Weighted as the rivals of a bidder: a row counts once for
                 every other team in the auction that bid (the bidder is the one asking)
  amount         P(j's bid <= c | it bids) for each grid level: logistic per level on the same
                 inputs; 1 at and above j's remaining budget
  combined       P(highest rival bid <= c) = product over rivals j of (1 - p_j + p_j F_j(c)),
                 rivals taken as independent given these inputs

Split and rule set before the run (2026-11-19): fit 2018-2023, test 2024-2025; ADOPT if log
loss of the outcome at the actual bid and grid Brier beat faab_model --trend with league-
resampled 95% intervals below 0 in both test seasons. Ablation: without the habits.

    ../../.venv/bin/python faab_rivals.py [--no-habits] [--export PATH]
"""
import argparse, json, os
import numpy as np
import pandas as pd
import faab_model as FM

HERE = os.path.dirname(os.path.abspath(__file__))
PRIOR = 5
LEVELS = FM.GRID[1:]
AUCTION = ['league', 'when', 'player']


def team_features(t, habits=True):
    f = {}
    f['rem'] = t.rem; f['srem'] = np.sqrt(t.rem.clip(lower=0))
    f['tgain'] = np.log1p(t.gain.clip(lower=0)); f['neg_gain'] = (t.gain < 0.05).astype(float)
    f['lgrank'] = np.log(t.gain_rank); f['top_need'] = (t.gain_rank == 1).astype(float)
    f['open'] = t.open.clip(0, 3)
    f['win_pct'] = t.win_pct
    if habits:
        n = t.claims
        sh = lambda col, prior: (t[col].fillna(prior) * n + prior * PRIOR) / (n + PRIOR)
        f['lclaims'] = np.log1p(n); f['claim_rate'] = t.claim_rate.clip(0, 3)
        f['mean_bid'] = np.log(sh('mean_bid', 0.05) + 0.005)
        f['max_bid'] = np.sqrt(sh('max_bid', 0.15))
        f['zero_share'] = sh('zero_share', 0.35)
        f['won_share'] = sh('won_share', 0.6)
    return pd.DataFrame(f)


def design(t, habits):
    t = t.assign(max_rem=0.0, max_rem_need=0.0, n_need=0, n_big=0, max_gain=0.0)
    # the player and league inputs; the one-piece model's summaries of the rivals are replaced
    # by each team's own
    A = FM.features(t).drop(columns=['max_rem', 'max_rem_need', 'n_need', 'n_big', 'lgain']).reset_index(drop=True)
    T = team_features(t, habits).reset_index(drop=True)
    X = pd.concat([A, T], axis=1)
    lv = np.log1p(t.val.clip(lower=0).values)
    X['tgain_x_val'] = X.tgain * lv
    X['tgain_x_trend'] = X.tgain * X.trend_rel
    X['rem_x_trend'] = X.srem * X.trend_rel
    if habits:
        X['mean_bid_x_val'] = X.mean_bid * lv
        X['claim_rate_x_gain'] = X.claim_rate * X.tgain
    return X


def fit_logit_w(X, y, w, l2=FM.L2):
    from scipy.optimize import minimize
    n = w.sum(); k = X.shape[1]

    def loss(b):
        z = X @ b[1:] + b[0]
        ll = np.logaddexp(0, z) - y * z
        g = (1 / (1 + np.exp(-z)) - y) * w
        return (w * ll).sum() / n + 0.5 * l2 / n * (b[1:] @ b[1:]), np.concatenate([[g.sum()], X.T @ g]) / n + np.concatenate([[0], l2 / n * b[1:]])

    return minimize(loss, np.zeros(k + 1), jac=True, method='L-BFGS-B', options={'maxiter': 500}).x


class Rivals:
    def __init__(self, habits=True): self.habits = habits

    def fit(self, t):
        X = design(t, self.habits); self.cols = list(X.columns)
        self.mu = X.mean().values; self.sd = X.std().values + 1e-9
        Z = (X.values - self.mu) / self.sd
        bid = t.bid.notna().values
        nb = t.groupby(AUCTION, observed=True).bid.transform('count').values
        w = (nb - bid).astype(float)  # rivals of each bidder
        keep = w > 0
        self.wp = fit_logit_w(Z[keep], bid[keep].astype(float), w[keep])
        Zb = Z[bid]; b = t.bid.values[bid]
        self.wa = [FM.fit_logit(Zb, (b <= c + 1e-9).astype(float)) for c in LEVELS]
        return self

    sigma, lam = 0.0, 0.0

    def logits(self, t):
        Z = (design(t, self.habits)[self.cols].values - self.mu) / self.sd
        zp = Z @ self.wp[1:] + self.wp[0]
        za = np.column_stack([Z @ w[1:] + w[0] for w in self.wa])
        return zp, za

    def rival_cdf(self, t, sigma=None, lam=None, lg=None):
        """For every row of t (all teams of each auction): G(c) = P(highest bid by the others <= c).
        A shared auction effect u ~ N(0, sigma^2) (how much the league wants him) raises every team's
        chance of bidding (logit + u) and its bid (amount logits - lam u); the logistic fits are
        population-averaged, so the conditional participation slope is scaled up to match"""
        sigma = self.sigma if sigma is None else sigma; lam = self.lam if lam is None else lam
        zp, za = lg if lg is not None else self.logits(t)
        key = t.groupby(AUCTION, observed=True).ngroup().values
        cap = np.array(LEVELS)[None, :] >= t.rem.values[:, None] - 1e-9
        nodes, wts = np.polynomial.hermite_e.hermegauss(11 if sigma > 0 else 1)
        wts = wts / wts.sum()
        scale = np.sqrt(1 + 0.346 * sigma ** 2)
        G = 0.0
        for u, wt in zip(nodes * sigma, wts):
            p = 1 / (1 + np.exp(-(zp * scale + u)))
            F = 1 / (1 + np.exp(-(za - lam * u)))
            F = np.maximum.accumulate(F, axis=1); F[cap] = 1.0
            A = np.column_stack([1 - p, 1 - p[:, None] + p[:, None] * F])
            logA = np.log(np.clip(A, 1e-12, None))
            tot = np.zeros((key.max() + 1, logA.shape[1])); np.add.at(tot, key, logA)
            G = G + wt * np.exp(tot[key] - logA)
        return G

    def tune(self, t):
        """sigma and lam by grid Brier of the bidders' rival bids, on a sample of training auctions"""
        keys = t[AUCTION].drop_duplicates().sample(40000, random_state=0)
        s = t.merge(keys, on=AUCTION).reset_index(drop=True)
        lg = self.logits(s); bid = s.bid.notna().values
        # highest bid by the others, for each bidder: the auction's top bid, or its second for the top bidder
        k = s.groupby(AUCTION, observed=True).ngroup().values
        b = s.bid.fillna(-1).values
        top = np.full(k.max() + 1, -1.0); np.maximum.at(top, k, b)
        order = np.lexsort((-b, k))
        sec = np.full(k.max() + 1, -1.0); rank = np.zeros(len(k), int)
        prev = -1; r = 0
        for j in order:
            r = 0 if k[j] != prev else r + 1; prev = k[j]; rank[j] = r
            if r == 1: sec[k[j]] = b[j]
        others = np.where(rank == 0, sec[k], top[k])
        Y = np.column_stack([(others <= c + 1e-9) for c in FM.GRID]).astype(float)[bid]
        best = None
        for sg in (0.0, 0.5, 1.0, 1.5, 2.0, 2.5):
            for lm in (0.0, 0.25, 0.5, 1.0):
                if sg == 0 and lm > 0: continue
                G = self.rival_cdf(s, sg, lm, lg)[bid]
                sc = ((G - Y) ** 2).mean()
                print(f'    sigma {sg:.1f} lam {lm:.2f}: grid Brier {sc:.5f}', flush=True)
                if best is None or sc < best[0]: best = (sc, sg, lm)
        _, self.sigma, self.lam = best
        print(f'  tuned: sigma {self.sigma}, lam {self.lam}')
        return self


def load():
    t = pd.read_parquet(os.path.join(HERE, 'cache', 'faab_teams.parquet'))
    for c in ('league', 'player'): t[c] = t[c].astype(str)
    a = pd.read_parquet(os.path.join(HERE, 'cache', 'faab_auctions.parquet'))
    a = a[a.budget >= 50]
    cols = ['pos', 'val', 'val_now', 'fa_rank', 'last_pts', 'snap', 'opps', 'opps_avg', 'proj', 'proj_prev', 'mate_out',
            'spent_share', 'med_price', 'n_prev', 'leg', 'end', 'budget', 'trend_rank', 'trend_rel', 'early', 'early24']
    cols += [c for c in ('trend_rank24', 'trend_rel24') if c in a]
    auc = a.drop_duplicates(AUCTION)[AUCTION + cols]
    t = t.merge(auc, on=AUCTION, how='inner')
    # the one-piece model's rows (one per bidder), with the bidder's team to line them up
    return t, a


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--no-habits', action='store_true'); ap.add_argument('--export'); a_ = ap.parse_args()
    FM.CROWD = 'trend'
    t, a = load()
    tr_t, te_t = t[t.season.isin(FM.TRAIN)].reset_index(drop=True), t[t.season.isin(FM.TEST)].reset_index(drop=True)
    print(f'team rows: train {len(tr_t):,}, test {len(te_t):,}')
    R = Rivals(habits=not a_.no_habits).fit(tr_t).tune(tr_t)
    G_all = R.rival_cdf(te_t)
    bidders = te_t.bid.notna().values
    ev = te_t[bidders].reset_index(drop=True); G_r = G_all[bidders]
    # the one-piece model on the same bids
    base = FM.Model().fit(a[a.season.isin(FM.TRAIN)].reset_index(drop=True))
    te_a = a[a.season.isin(FM.TEST)].copy(); te_a['league'] = te_a.league.astype(str); te_a['player'] = te_a.player.astype(str)
    ev = ev.merge(te_a[AUCTION + ['roster', 'H', 'max_rem', 'max_rem_need', 'n_need', 'n_big', 'max_gain', 'my_gain', 'my_rem', 'n_bidders']],
                  on=AUCTION + ['roster'], how='left', indicator=True)
    ok = (ev._merge == 'both').values
    print(f'evaluation bids: {ok.sum():,} of {len(ev):,} matched')
    ev = ev[ok].reset_index(drop=True); G_r = G_r[ok]
    ev['bid'] = ev.bid.astype(float); ev['won'] = ev.won.astype(bool)
    G = {'rivals': G_r, 'one-piece': base.cdf(ev)}
    res = {k: FM.scores(ev, g) for k, g in G.items()}
    print('\nscores on the test bids (lower is better)')
    for k, (p, ll, br, gb) in res.items(): print(f'  {k:10} log loss {ll.mean():.4f}  Brier {br.mean():.4f}  grid Brier {gb.mean():.4f}')
    adopt = True
    for name, i in (('log loss', 1), ('grid Brier', 3)):
        for s in FM.TEST:
            m = ev.season.values == s
            d, lo, hi = FM.boot(res['rivals'][i][m] - res['one-piece'][i][m], ev.league.values[m])
            adopt &= hi < 0
            print(f'  rivals - one-piece {name:10} {s}: {d:+.4f} [{lo:+.4f}, {hi:+.4f}] {"ok" if hi < 0 else "FAIL"}')
    print('ADOPT' if adopt else 'NOT ADOPTED')
    y = ev.won.values
    cut = np.digitize(ev.bid.values, [1e-9, 0.0100001, 0.0300001, 0.0600001, 0.1000001, 0.2000001])
    print('\nby bid: P(win) predicted [rivals, one-piece] vs won; P(nobody else) [rivals, one-piece] vs actual')
    for i, lab in enumerate(['$0', '<=1%', '1-3%', '3-6%', '6-10%', '10-20%', '>20%']):
        m = cut == i
        print(f'  {lab:7} {res["rivals"][0][m].mean():6.1%} {res["one-piece"][0][m].mean():6.1%} {y[m].mean():6.1%}   '
              f'{G["rivals"][m, 0].mean():6.1%} {G["one-piece"][m, 0].mean():6.1%} {np.mean(ev.H.values[m] < 0):6.1%}  ({m.sum():,})')
    print('\ncalibration of P(H <= c), rivals vs one-piece vs actual')
    for k, c in enumerate(FM.GRID):
        if c in (-1, 0.0, 0.03, 0.05, 0.1, 0.2 if 0.2 in FM.GRID else 0.22, 0.3, 0.55):
            print(f'  c={c:5.2f}  {G["rivals"][:, k].mean():6.1%} {G["one-piece"][:, k].mean():6.1%} {np.mean(ev.H.values <= c + 1e-9):6.1%}')
    # rivals' budgets: where some rival is nearly broke, does the cap matter?
    low = ev.max_rem.values < 0.15
    print(f'\nauctions where no rival has 15%+ of the budget left ({low.sum():,} bids): log loss rivals {res["rivals"][1][low].mean():.4f}, one-piece {res["one-piece"][1][low].mean():.4f}')
    print('\nparticipation weights (standardized), largest:')
    for c_, w in sorted(zip(R.cols, R.wp[1:]), key=lambda x: -abs(x[1]))[:14]: print(f'  {c_:18} {w:+.3f}')


if __name__ == '__main__':
    main()
