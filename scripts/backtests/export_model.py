"""Export the fitted strength model for the site, and a parity fixture for its tests.

The model (strength_model.py, 'fitted + tau'; adopted under PREREGISTRATION_2026.md's rule,
rank_odds.py --weekly --rules ours): for a snapshot week e (the first week not yet played),
a team's expected weekly score is the league's average so far plus
    lineup(e) x (its projected best lineup, averaged over the remaining regular-season weeks,
                 minus the league's average of that)
  + ppg(e)    x (its points per game so far minus the league's),
the same in every remaining week (playoffs too), plus one random offset per team per
simulated season with sd tau(e), plus weekly noise with the league's pooled week-to-week
spread (at least 15). Fitted here on every crawled 12-team league-season (2018-2025, our
league excluded), each snapshot week separately. Weeks 1-2 have no fit (no spread to measure
yet); the site uses week 3's.

Writes web/lib/analyze/strengthModel.json. --fixture also writes
web/lib/__tests__/fixtures/fittedOdds.json: two of our league's real snapshots (2025 week 8,
2024 week 5, with divisions) with the inputs the site would compute and this reference's
playoff and bye odds (GPU simulator, rank_odds.season), for playoffOdds.test.ts to match.

    python export_model.py [--fixture]
"""
import argparse, datetime, gzip, json, os
import numpy as np
import torch
import gpu_sim as G
import leagues_fit as LF
import rank_odds as R
from common import ARCHIVE

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, '..', '..', 'web', 'lib')


def fit_all():
    data = [r for r in G.S.collect(weekly=True) if len(r['ids']) == 12]
    P = G.pack(data); weeks = {}
    for e in np.unique(P['e']):
        rows = P['e'] == e
        if rows.sum() < 500: continue
        b = G.fit(P, rows, [0, 1])
        weeks[str(int(e))] = {'lineup': round(float(b[0]), 4), 'ppg': round(float(b[1]), 4), 'tau': round(G.tau_for(P, rows, [0, 1], b), 3)}
    return weeks, len(np.unique(P['league']))


def fixture(season, e, model, sims=200000):
    L = json.load(gzip.open(os.path.join(ARCHIVE, season, 'league.json.gz'), 'rt'))
    end = L['settings']['playoff_week_start'] - 1
    M = {w: json.load(gzip.open(os.path.join(ARCHIVE, season, 'matchups', f'{w}.json.gz'), 'rt')) for w in range(1, end + 1)}
    row = next(r for r in G.S.league_snapshots(L, M, weekly=True) if r['e'] == e)
    ids = row['ids']; slots = L['roster_positions']
    rosters = json.load(gzip.open(os.path.join(ARCHIVE, season, 'rosters.json.gz'), 'rt'))
    div = {r['roster_id']: (r.get('settings') or {}).get('division') or 0 for r in rosters}
    vals = LF.table(season, e, L['scoring_settings'].get('rec'))
    players = {m['roster_id']: (m.get('players') or []) for m in M[e]}
    lineups = {w: {r: LF.lineup(players.get(r, []), vals, slots, w, 0) for r in ids} for w in range(e, end + 1)}
    W, PF = G.record(row, e - 1); T = len(ids)
    losses = np.zeros(T); ties = np.zeros(T)
    for w in range(1, e):
        for a, b in row['games'][w]:
            pa, pb = row['pts'][w][ids[a]], row['pts'][w][ids[b]]
            if pa == pb: ties[a] += 1; ties[b] += 1
            elif pa > pb: losses[b] += 1
            else: losses[a] += 1
    wins = W - ties / 2
    # Python reference odds: the fitted model on this snapshot, our seeding, the real schedule
    P = G.pack([row]); c = model[str(e)]
    off = (P['X'][:, :, 0] * c['lineup'] + P['X'][:, :, 1] * c['ppg'])[None] * P['teams']
    hasdiv = len(set(div.values())) > 1
    dv = R.t(np.array([[div[r] - 1 for r in ids]]), torch.int64) if hasdiv else None
    gen = torch.Generator(device=G.DEV).manual_seed(11)
    F, _ = R.season(P, np.array([0]), T, sims, gen, 'real', (off, np.array([[c['tau']]]), P['sd'][None]), div=dv)
    cF = F[0, 0].cumsum(-1).cpu().numpy()
    return {
        'season': season, 'snapshotWeek': e, 'regularSeasonEnd': end, 'model': c, 'sims': sims,
        'format': {'playoffTeams': 6, 'hasDivisions': hasdiv, 'byes': 2},
        'weeklyScores': {str(r): [row['pts'][w][r] for w in range(1, e)] for r in ids},
        'lineups': {str(w): {str(r): v for r, v in lw.items()} for w, lw in lineups.items()},
        'teams': [{'rosterId': r, 'division': div[r] if hasdiv else 0, 'wins': int(wins[i]), 'losses': int(losses[i]),
                   'ties': int(ties[i]), 'pointsFor': round(float(PF[i]), 2)} for i, r in enumerate(ids)],
        'remaining': [{'week': w, 'a': ids[a], 'b': ids[b]} for w in range(e, end + 1) for a, b in row['games'][w]],
        'spread': float(P['sd'][0]),
        'reference': {str(r): {'playoffs': round(float(cF[i, 5]), 4), 'bye': round(float(cF[i, 1]), 4)} for i, r in enumerate(ids)},
    }


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--fixture', action='store_true'); a = ap.parse_args()
    weeks, n = fit_all()
    out = {'model': 'fitted lineup + points per game, with persistent team uncertainty (scripts/backtests/export_model.py)',
           'fittedOn': f'{n} crawled 12-team league-seasons, 2018-2025', 'exported': datetime.date.today().isoformat(), 'weeks': weeks}
    path = os.path.join(WEB, 'analyze', 'strengthModel.json')
    json.dump(out, open(path, 'w'), indent=2); open(path, 'a').write('\n')
    print(f'{path}: weeks {min(map(int, weeks))}-{max(map(int, weeks))} from {n} league-seasons')
    for e, c in weeks.items(): print(f'  week {e:>2}: lineup {c["lineup"]:+.3f}  ppg {c["ppg"]:+.3f}  tau {c["tau"]:.2f}')
    if a.fixture:
        fx = [fixture('2025', 8, weeks), fixture('2024', 5, weeks)]
        os.makedirs(os.path.join(WEB, '__tests__', 'fixtures'), exist_ok=True)
        fp = os.path.join(WEB, '__tests__', 'fixtures', 'fittedOdds.json')
        json.dump(fx, open(fp, 'w')); print(f'{fp}: {len(fx)} snapshots, reference odds from {fx[0]["sims"]} simulated seasons')


if __name__ == '__main__':
    main()
