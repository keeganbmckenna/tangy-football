"""Per-fold fits for the live addendum's tests 1-2 (PREREGISTRATION_2026.md, 2026-10-26):

  injuries  P(an injured fantasy player records any later stat in the game | none for s minutes
            since the injury), by position (QB, RB, WR/TE, K) and minutes since (bins 0-3-6-10-15-25+),
            from the play text's "was injured during the play" (live_components.py)
  vegas     beta[position] in miss on the Sleeper projection = a + b x projection + beta x the team's
            implied points (nflverse closing lines, centred by week), half-PPR starters

    python live_injury.py     # writes cache/live_inj_fit/{held-out season}.json and reports rates

The replay (live_replay.py, LIVE_USE=inj_oracle | inj_model | vegas) reads them.
"""
import json, os
from collections import defaultdict

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

import leagues_fit as LF
import live_components as LC

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'cache', 'live_inj_fit')
BINS = (0, 3, 6, 10, 15, 25)
GROUP = {'QB': 'QB', 'RB': 'RB', 'WR': 'WRTE', 'TE': 'WRTE', 'K': 'K'}
TEAM = {'LA': 'LAR', 'OAK': 'LV', 'SD': 'LAC', 'STL': 'LAR'}
RETURN_AFTER = 30  # seconds after the injury play: a stat on the same play doesn't count as back


def injury_records():
    """(season, group, minutes until his next stat or inf) for every flagged fantasy-player injury"""
    out = []
    for s in LC.SEASONS:
        comps = LC.load(s)
        for w, wk in comps.items():
            proj = {r['player_id']: (r.get('player') or {}).get('position') for r in LF.arch(s, f'projections/{w}')}
            ix = {p: i for i, p in enumerate(wk['ids'])}
            ev = wk['ev']
            for t, pid in wk['injured']:
                g = GROUP.get(proj.get(pid))
                if not g: continue
                end = next((sn[-1, 0] for _, _, sn, _ in wk['games'] if sn[0, 0] <= t <= sn[-1, 0]), t + 3600)
                e = ix.get(pid)
                later = ev['t'][(ev['who'] == e) & (ev['t'] > t + RETURN_AFTER) & (ev['t'] <= end)] if e is not None else []
                out.append((int(s), g, (later.min() - t) / 60 if len(later) else np.inf, (end - t) / 60))
    return pd.DataFrame(out, columns=['season', 'group', 'back', 'left'])


def return_table(df):
    """group -> bin -> P(any later stat | none by the bin's start), at risk while the game had that long left"""
    out = {}
    for g, d in df.groupby('group'):
        out[g] = {}
        for b in BINS:
            risk = d[(d.back > b) & (d.left > b)]
            out[g][str(b)] = float(np.isfinite(risk.back).mean()) if len(risk) >= 10 else None
    return out


def implied():
    g = pd.read_csv(os.path.join(HERE, '..', 'cache', 'nflverse', 'games.csv'))
    g = g[(g.game_type == 'REG') & g.season.between(2018, 2025)]
    rows = []
    for r in g.itertuples():
        h, a = TEAM.get(r.home_team, r.home_team), TEAM.get(r.away_team, r.away_team)
        rows += [(r.season, r.week, h, (r.total_line + r.spread_line) / 2), (r.season, r.week, a, (r.total_line - r.spread_line) / 2)]
    d = pd.DataFrame(rows, columns=['season', 'week', 'team', 'implied'])
    d['centred'] = d.implied - d.groupby(['season', 'week']).implied.transform('mean')
    return d


def vegas_betas(train_seasons, imp):
    t = pq.read_table(os.path.join(HERE, 'cache', 'player_weeks.parquet'), columns=['season', 'week', 'player_id', 'started', 'position', 'nfl_team', 'proj', 'points', 'ppr', 'playoff'],
                      filters=[('started', '=', True), ('playoff', '=', False), ('ppr', '=', 0.5)]).to_pandas()
    for c in ('player_id', 'position', 'nfl_team'): t[c] = t[c].astype(str)
    t = t[t.season.isin(train_seasons)].dropna(subset=['proj', 'points']).drop_duplicates(['season', 'week', 'player_id'])
    t = t.merge(imp, left_on=['season', 'week', 'nfl_team'], right_on=['season', 'week', 'team'])
    out = {}
    for pos, d in t.groupby('position'):
        if pos not in GROUP: continue
        X = np.column_stack([np.ones(len(d)), d.proj, d.centred])
        out[pos] = float(np.linalg.lstsq(X, (d.points - d.proj).to_numpy(), rcond=None)[0][2])
    return out


def main():
    df = injury_records()
    print(f'{len(df)} flagged fantasy-player injuries; came back to record a stat: {np.isfinite(df.back).mean():.0%}')
    full = return_table(df)
    for g, row in full.items():
        print(f'  {g:4s} n={int((df.group == g).sum()):4d}  ' + '  '.join(f'{b}+ min {v:.2f}' if v is not None else f'{b}+ min  -  ' for b, v in row.items()))
    imp = implied()
    os.makedirs(OUT, exist_ok=True)
    for s in LC.SEASONS:
        train = [int(x) for x in LC.SEASONS if x != s]
        json.dump({'bins': BINS, 'returns': return_table(df[df.season != int(s)]), 'vegas': vegas_betas(train, imp)},
                  open(os.path.join(OUT, f'{s}.json'), 'w'))
    print('fold fits written to', OUT)


if __name__ == '__main__':
    main()
