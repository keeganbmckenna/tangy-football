"""Beyond correlation: which manager decisions show a real effect, on the crawled leagues where
every team stayed active (like ours). Reads cache/manager_decisions.parquet (manager_decisions.py
--rebuild). Tests fixed before they were scored:

A. Start/sit overrides. Each week a manager either starts the lineup its projections recommend
   or overrides it (all starters projected to play, the lineup projected 1+ point lower), or
   neglects it (starts someone projected at 0: on bye or out). For an override, its projected
   cost is known before kickoff and its result after, against the same roster's projection-best
   lineup: the decision's effect, not a correlation. Reported: how often each happens, what an
   override returns against what projections said it would cost (edge = result + projected
   cost), and whether a manager's override edge, override rate and neglect repeat the next
   season (same owner, consecutive seasons, overrides weighted, bootstrap over owners).

B. Adds, within the manager. Does the same manager do better in seasons they add more than their
   own usual? All-play and adds as deviations from each owner's own mean (owners with 2+
   seasons): stable traits (engaged people) drop out. Adds split into forced (without them the
   roster couldn't fill its lineup with players projected to play) and chosen (it could).
   Compared with the same regression across managers. Bootstrap over owners.

    python manager_causes.py
"""
import os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))


def boot(fn, owners, n=1000, seed=0):
    rng = np.random.default_rng(seed)
    ids = np.unique(owners)
    pos = {o: np.flatnonzero(owners == o) for o in ids}
    out = []
    for _ in range(n):
        pick = np.concatenate([pos[o] for o in rng.choice(ids, len(ids))])
        out.append(fn(pick))
    return np.percentile(out, [2.5, 97.5], axis=0)


def main():
    df = pd.read_parquet(os.path.join(HERE, 'cache', 'manager_decisions.parquet'))
    df = df[df.groupby(['season', 'league']).adds.transform('min') >= 0.5]
    df = df[(df.owner != 'None') & (df.owner != 'nan')].copy()
    df['allplay'] = df.allplay - 0.5
    df['edge'] = df.judg_gain + df.judg_proj_cost
    df['judg_n'] = df.judg_rate * 14
    print(f'Active leagues: {len(df):,} team-seasons, {df.owner.nunique():,} owners, {df.season.min()}-{df.season.max()}\n')

    print('A. Start/sit overrides')
    print(f'  weeks overriding the projection-best lineup: {df.judg_rate.mean():.1%}; neglecting (starter projected at 0): {df.neglect_rate.mean():.1%}')
    w = df.judg_n.to_numpy(); ok = ~np.isnan(df.edge.to_numpy())
    cost = np.average(df.judg_proj_cost[ok], weights=w[ok]); gain = np.average(df.judg_gain[ok], weights=w[ok])
    print(f'  an override: projected to cost {cost:.2f} pts, actually returned {gain:+.2f} vs the projection-best lineup (edge {gain + cost:+.2f})')
    q = df[ok].assign(qe=pd.qcut(df.edge[ok], 5, labels=False))
    print('  managers by their season override edge (quintiles): edge, all-play', ', '.join(f'{g.edge.mean():+.1f} / {g.allplay.mean():+.3f}' for _, g in q.groupby('qe')))
    # One row per owner and season (an owner in several leagues: overrides-weighted means), then consecutive seasons
    def per_owner(g):
        w = g.judg_n.to_numpy()
        out = {c: g[c].mean() for c in ['judg_rate', 'neglect_rate']}
        ok = ~g.edge.isna().to_numpy() & (w > 0)
        out['judg_n'] = w.sum()
        for c in ['judg_proj_cost', 'edge']:
            out[c] = np.average(g[c][ok], weights=w[ok]) if ok.any() else np.nan
        return pd.Series(out)
    os_ = df.groupby(['owner', 'season']).apply(per_owner).reset_index()
    pairs = os_.merge(os_.assign(season=os_.season - 1), on=['owner', 'season'], suffixes=('', '_next'))
    print(f'  same owner, next season ({len(pairs):,} pairs):')
    for c in ['judg_rate', 'neglect_rate', 'judg_proj_cost', 'edge']:
        p = pairs.dropna(subset=[c, c + '_next'])
        x, y = p[c].to_numpy(), p[c + '_next'].to_numpy()
        wt = np.minimum(p.judg_n, p.judg_n_next).to_numpy() if c in ('edge', 'judg_proj_cost') else np.ones(len(p))
        corr = lambda i: np.cov(x[i], y[i], aweights=wt[i])[0, 1] / np.sqrt(np.cov(x[i], aweights=wt[i]) * np.cov(y[i], aweights=wt[i]))
        lo, hi = boot(corr, p.owner.to_numpy())
        print(f'    {c:15s} r {corr(np.arange(len(p))):+.3f} ({lo:+.3f}, {hi:+.3f})')

    print('\nB. Adds within the manager (deviations from their own mean; owners with 2+ seasons)')
    multi = df[df.groupby('owner').season.transform('nunique') >= 2].copy()
    cols = ['forced_adds', 'chosen_adds']
    for c in cols + ['allplay', 'adds']:
        multi[c + '_dm'] = multi[c] - multi.groupby('owner')[c].transform('mean')
    print(f'  {len(multi):,} team-seasons, {multi.owner.nunique():,} owners')

    def ols(frame, xcols, ycol):
        def fit(i):
            X = np.column_stack([np.ones(len(i)), frame[xcols].to_numpy()[i]])
            b, *_ = np.linalg.lstsq(X, frame[ycol].to_numpy()[i], rcond=None)
            return b[1:]
        b = fit(np.arange(len(frame)))
        lo, hi = boot(fit, frame.owner.to_numpy())
        return b, lo, hi

    for label, frame, xs, y in [
        ('across managers', multi, ['adds'], 'allplay'),
        ('within a manager', multi, ['adds_dm'], 'allplay_dm'),
        ('across managers', multi, cols, 'allplay'),
        ('within a manager', multi, [c + '_dm' for c in cols], 'allplay_dm'),
    ]:
        b, lo, hi = ols(frame, xs, y)
        print(f'  {label:17s} ' + ', '.join(f'{x.replace("_dm", "")} {bi * 14:+.3f} ({l * 14:+.3f}, {h * 14:+.3f})' for x, bi, l, h in zip(xs, b, lo, hi))
              + '  wins per 14 games per add a week')


if __name__ == '__main__':
    main()
