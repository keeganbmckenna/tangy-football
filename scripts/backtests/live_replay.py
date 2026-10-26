"""The Live tab's win odds replayed through every regular-season week of the crawled 12-team
leagues, 2018-2025, on the GPU: the data for testing improvements to the live model under the
preregistration's live addendum (PREREGISTRATION_2026.md).

For each NFL week, the league-independent part is built once: every NFL game's clock, score
and share left (gameRemaining) at each sample time (every 3 minutes while any game is on, as
web/scripts/build-win-history.ts samples), and every player's and defense's stats so far
(live_components.py). Each league then scores those stats with its own settings (a batched
tensor product), each starter ending exactly at his official points as the site's replay
does (what the play-by-play misses is spread over his game), and the site's model
(live_model.py, checked against the site's code) gives every matchup's odds at every sample.

Inputs as the Live tab would have had them: Sleeper's pre-game projection in the league's
scoring (projected stats x settings; defenses split into points allowed and the rest),
each player's boom-or-bust ratio from his earlier weeks, the league's weekly spread from its
earlier weeks, and (2022 on) the final NFL injury report; earlier seasons have no injury
reports, so nobody is discounted.

Leagues: 12 teams, played (leagues_fit.played), no IDP slots (their defenders' points can't be
replayed), this league left out; regular-season weeks before the league's playoffs.

    python live_replay.py [2018 ...]   # writes cache/live_replay/{season}.npz
    LIVE_ALPHA=0.8 python live_replay.py   # rung 3's production curve: cache/live_replay_a0.8/
    LIVE_VAR=v.json LIVE_TAG=_v python live_replay.py   # rung 3b's player variances: cache/live_replay_v/

Per matchup: season, week, league, whether a won (ties dropped later), and at each sample a's
projected final minus b's (diff), the score margin so far (cur), the model's spread (sd), the
share of the kickoff variance still to come (left), and a's third cumulant minus b's at unit
player skewness (k3). Scoring is in live_eval.py.
"""
import glob, gzip, json, math, os, sys, time
from collections import defaultdict

import numpy as np
import torch

import leagues_fit as LF
import live_components as LC
import live_model as LM
import player_weeks as PW

HERE = os.path.dirname(os.path.abspath(__file__))
LEAGUES = os.path.join(HERE, 'cache', 'leagues')
# LIVE_ALPHA (rung 3): a player's points still to come as (share of his game left)^alpha
ALPHA = float(os.environ.get('LIVE_ALPHA', 1))
# LIVE_VAR (rung 3b): a JSON file of {position: [a, b]}, each player's variance a + b x projection
VAR = json.load(open(os.environ['LIVE_VAR'])) if os.environ.get('LIVE_VAR') else None
OUT = os.path.join(HERE, 'cache', 'live_replay' + (f'_a{ALPHA:g}' if ALPHA != 1 else '') + os.environ.get('LIVE_TAG', ''))
STEP = 180
CANON = {'LA': 'LAR', 'OAK': 'LV', 'SD': 'LAC', 'STL': 'LAR', 'WSH': 'WAS', 'JAC': 'JAX'}
IDP = {'DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'DT', 'CB', 'S'}
POSITIONS = ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
DEV = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
DT = torch.float64
# Leagues per GPU batch: a whole season fits in about 20 GB
CHUNK = int(os.environ.get('LIVE_CHUNK', 1200))


def canon(t):
    return CANON.get(t, t) if t else t


def leagues(season):
    """The season's usable leagues: scoring and each regular-season week's matchups"""
    out = []
    for path in sorted(glob.glob(os.path.join(LEAGUES, season, '*.json.gz'))):
        d = json.load(gzip.open(path, 'rt'))
        L = d['league']
        if L['league_id'] in LF.OURS or len(d.get('rosters') or []) != 12: continue
        if IDP & set(L.get('roster_positions') or []): continue
        M = {int(w): m for w, m in d['matchups'].items()}
        end = min((L['settings'].get('playoff_week_start') or 15) - 1, 18)
        if any(w not in M for w in range(1, end + 1)): continue
        ids = sorted(m['roster_id'] for m in M[1])
        pts = {w: {m['roster_id']: (m.get('points') or 0) for m in M[w]} for w in range(1, end + 1)}
        if len(ids) != 12 or not LF.played(pts, ids, end): continue
        out.append({'id': L['league_id'], 'scoring': L.get('scoring_settings') or {}, 'end': end,
                    'weeks': {w: M[w] for w in range(1, end + 1)}, 'pts': pts})
    return out


def score_spread(pts, week):
    """scoreSpread: pooled within-team sd of nonzero scores over weeks before this one"""
    by = defaultdict(list)
    for w in range(1, week):
        for r, v in pts[w].items(): by[r].append(v)
    sq = n = 0
    for s in by.values():
        s = [v for v in s if v > 0]
        if len(s) < 2: continue
        m = sum(s) / len(s)
        sq += sum((v - m) ** 2 for v in s); n += len(s) - 1
    return max(math.sqrt(sq / n), 15) if n > 0 else 25


def sample_times(games):
    spans = [(int(s[0, 0]), int(s[-1, 0])) for _, _, s in games]
    times = {min(a for a, _ in spans) - 60}
    for a, b in spans:
        times.update(round(t / STEP) * STEP for t in range(a, b, STEP)); times.add(b)
    return np.array(sorted(times), dtype=np.int64)


def game_states(games, times):
    """team -> (state, remaining, own score, opponent score), each [T], on the device"""
    out = {}
    T = len(times)
    for home, away, s in games:
        first, last = s[0, 0], s[-1, 0]
        i = np.searchsorted(s[:, 0], times, side='right') - 1  # last snap at or before t
        snap = s[np.clip(i, 0, None)]
        state = np.where(times < first, LM.PRE, np.where(times >= last, LM.POST, LM.IN))
        for team, mine, theirs in ((home, 3, 4), (away, 4, 3)):
            own = np.where(state == LM.PRE, 0, snap[:, mine]); opp = np.where(state == LM.PRE, 0, snap[:, theirs])
            t = lambda a, dt=DT: torch.tensor(a, dtype=dt, device=DEV)
            rem = LM.game_remaining(t(state, torch.long), t(snap[:, 1]), t(snap[:, 2]), t(own - opp))
            rem = torch.where(t(state, torch.long) == LM.PRE, torch.ones(T, dtype=DT, device=DEV), rem)
            out[canon(team)] = (t(state, torch.long), rem, t(own), t(opp))
    return out


def stats_so_far(week, times):
    """[E, T, K] each player's or defense's stats so far at each sample, and entity -> row"""
    ev = week['ev']
    E, T, K = len(week['ids']), len(times), len(LC.COMPONENTS)
    D = torch.zeros(E, T, K, dtype=torch.float32, device=DEV)
    ti = np.searchsorted(times, ev['t'], side='left')  # counts from the first sample at or after it
    keep = ti < T
    idx = (torch.tensor(ev['who'][keep], device=DEV).long() * T + torch.tensor(ti[keep], device=DEV)) * K + torch.tensor(ev['k'][keep], device=DEV).long()
    D.view(-1).index_add_(0, idx, torch.tensor(ev['v'][keep], device=DEV))
    rows = {canon(w) if w.isalpha() else w: i for i, w in enumerate(week['ids'])}
    return D.cumsum(1), rows


def season_inputs(season):
    """Per week: projections (position, team, stats), each player's earlier half-PPR scores, injuries"""
    proj, hist = {}, defaultdict(list)
    history = {}
    for w in range(1, 19):
        history[w] = {p: list(v) for p, v in hist.items()}
        try: rows = LF.arch(season, f'projections/{w}')
        except FileNotFoundError: rows = []
        proj[w] = {}
        for r in rows:
            pos = (r.get('player') or {}).get('position')
            if pos not in POSITIONS: continue
            proj[w][r['player_id']] = (pos, canon(r.get('team') or (r.get('player') or {}).get('team')), r.get('stats') or {})
        try: stats = LF.arch(season, f'stats/{w}')
        except FileNotFoundError: stats = {}
        for p, s in stats.items():
            if s.get('gp'): hist[p].append(s.get('pts_half_ppr') or 0.0)
    pl = os.path.join(LF.ARCHIVE, season, 'players.json.gz')
    inj = PW.injury_reports(season, LF.arch(season, 'players')) if os.path.exists(pl) else None
    return proj, history, inj


def replay_week(season, w, week, lgs, proj, history, inj, keys):
    times = sample_times(week['games'])
    T = len(times)
    games = game_states(week['games'], times)
    C, rows = stats_so_far(week, times)
    ratio_cache = {}
    def ratio(pid, pos):
        if pid not in ratio_cache: ratio_cache[pid] = LM.player_spread_ratio(pos, history[w].get(pid, []))
        return ratio_cache[pid]
    reports = (inj or {}).get(w, {})
    # Projected stats as a matrix over every scoring key, for each league's projection at once
    P = proj[w]
    prow = {p: i for i, p in enumerate(P)}
    PM = np.zeros((len(P) + 1, len(keys)))
    kix = {k: i for i, k in enumerate(keys)}
    for p, (_, _, st) in P.items():
        for k, v in st.items():
            if k in kix and isinstance(v, (int, float)): PM[prow[p], kix[k]] = v
    out = []
    for c0 in range(0, len(lgs), CHUNK):
        chunk = [lg for lg in lgs[c0:c0 + CHUNK] if w in lg['weeks']]
        if chunk: out.append(replay_chunk(chunk, w, T, times, games, C, rows, P, prow, PM, keys, ratio, reports))
    return out


def replay_chunk(chunk, w, T, times, games, C, rows, P, prow, PM, keys, ratio, reports):
    # League scoring: on the components (for points so far) and on the projection keys
    W = torch.tensor([[lg['scoring'].get(k, 0.0) for k in LC.COMPONENTS] for lg in chunk], dtype=torch.float32, device=DEV)
    WP = np.array([[lg['scoring'].get(k, 0.0) for k in keys] for lg in chunk])
    WO = WP * np.array([0.0 if k.startswith('pts_allow') else 1.0 for k in keys])
    BR = [LM.brackets({k: v for k, v in lg['scoring'].items() if k.startswith('pts_allow_')}) for lg in chunk]
    pa_col = keys.index('pts_allow') if 'pts_allow' in keys else None

    slot = defaultdict(list)
    sides, groups, pairs, outcome, spreads = [], [], [], [], []
    for li, lg in enumerate(chunk):
        spreads.append(score_spread(lg['pts'], w))
        by = defaultdict(list)
        ms = lg['weeks'][w]
        for m in ms:
            if m.get('matchup_id') is not None: by[m['matchup_id']].append(m)
        ordered = [p for _, p in sorted(by.items()) if len(p) == 2]
        rest = [m for m in ms if m.get('matchup_id') is None or len(by[m['matchup_id']]) != 2]
        base = len(sides)
        for pair in ordered:
            pairs.append((len(sides), len(sides) + 1, lg['id']))
            pa, pb = pair[0].get('points') or 0.0, pair[1].get('points') or 0.0
            outcome.append(1.0 if pa > pb else 0.0 if pa < pb else 0.5)
            sides.extend(pair)
        sides.extend(rest)
        groups.extend([li] * (len(sides) - base))
        for si in range(base, len(sides)):
            m = sides[si]
            pp = m.get('players_points') or {}
            for pid in m.get('starters') or []:
                if pid in ('0', '', None): continue
                is_def = pid.isalpha()
                pr = P.get(pid)
                team = pr[1] if pr else (canon(pid) if is_def else None)
                slot['side'].append(si); slot['league'].append(li)
                slot['entity'].append(rows.get(canon(pid) if is_def else pid, -1))
                slot['team'].append(team if team in games else None)
                slot['final'].append(pp.get(pid, 0.0) or 0.0)
                slot['is_def'].append(is_def)
                slot['proj_row'].append(prow.get(pid, -1) if pr else -1)
                slot['ratio'].append(ratio(pid, pr[0]) if pr else 0.0)
                slot['pos'].append(pr[0] if pr else ('DEF' if is_def else ''))
                slot['status'].append(reports.get(pid, (None,))[0])
    n_sides = len(sides)
    S = len(slot['side'])
    L = len(chunk)
    t = lambda a, dt=DT: torch.tensor(a, dtype=dt, device=DEV)
    side, league = t(slot['side'], torch.long), t(slot['league'], torch.long)

    # Game state per slot: [S, T]; no game this week: never starts, nothing left
    teams = sorted(games)
    tix = {tm: i for i, tm in enumerate(teams)}
    G_state = torch.stack([games[tm][0] for tm in teams] + [torch.full((T,), -1, device=DEV, dtype=torch.long)])
    G_rem = torch.stack([games[tm][1] for tm in teams] + [torch.zeros(T, dtype=DT, device=DEV)])
    G_opp = torch.stack([games[tm][3] for tm in teams] + [torch.zeros(T, dtype=DT, device=DEV)])
    gi = t([tix.get(tm, len(teams)) if tm else len(teams) for tm in slot['team']], torch.long)
    has_game = gi < len(teams)
    state, rem, opp = G_state[gi], G_rem[gi], G_opp[gi]
    started = (state == LM.IN) | (state == LM.POST)
    played = torch.where(state == LM.PRE, 0.0, torch.where(state == LM.POST, 1.0, (1 - rem).clamp(0, 1))).to(DT)
    played = torch.where(state < 0, torch.zeros_like(played), played)
    # Research (rung 3): points still to come follow the game clock as r^ALPHA (1: the site's model)
    if ALPHA != 1: rem = rem.clamp(min=0) ** ALPHA

    # Defenses: brackets, points allowed so far (only defense slots carry the bracket tensors)
    is_def = t(slot['is_def'], torch.bool)
    dix = torch.nonzero(is_def & has_game).squeeze(1)
    lo, hi, bv = (t([b[i] for b in BR])[league[dix]].unsqueeze(1) for i in range(3))  # [D, 1, B]
    allowed_now = torch.zeros(S, T, dtype=DT, device=DEV)
    allowed_now[dix] = torch.where(started[dix], opp[dix], torch.zeros_like(opp[dix]))
    allowed_pts = torch.zeros(S, T, dtype=DT, device=DEV)
    allowed_pts[dix] = torch.where(started[dix], LM.allowed_points(allowed_now[dix], lo, hi, bv), torch.zeros_like(opp[dix]))

    # Stats so far in each league's scoring
    ent = t(slot['entity'], torch.long)
    pts = torch.zeros(S, T, dtype=DT, device=DEV)
    known = ent >= 0
    if known.any():
        e, lg_ = ent[known], league[known]
        # Per league in the chunk: its scoring over the entities' stats, then gathered per slot
        scored = torch.einsum('etk,lk->let', C, W)  # [L, E, T]
        pts[known] = scored[lg_, e].to(DT)
    end_allowed = torch.zeros(S, dtype=DT, device=DEV)
    end_allowed[dix] = LM.allowed_points(opp[dix, -1:], lo, hi, bv).squeeze(1)
    gap = t(slot['final']) - pts[:, -1] - end_allowed
    points = pts + allowed_pts + gap.unsqueeze(1) * played

    # Projections in the league's scoring, as the live tab has them at each moment
    prow_ = np.array(slot['proj_row'])
    has_proj = prow_ >= 0
    lg_np = np.array(slot['league'])
    full = np.where(has_proj, np.round((PM[prow_] * WP[lg_np]).sum(1), 2), 0.0)
    other = np.where(has_proj, np.round((PM[prow_] * WO[lg_np]).sum(1), 2), 0.0)
    allowed_proj = PM[prow_, pa_col] if pa_col is not None else np.zeros(S)
    status = slot['status']
    pre_share = np.array([LM.injury_adjusted(1.0, s, False) for s in status])
    post_share = np.array([LM.injury_adjusted(1.0, s, True) for s in status])
    is_def_np = np.array(slot['is_def'])
    def_proj = np.zeros(S)
    dm = is_def_np & has_proj
    if dm.any():
        # Before kickoff, from the league's brackets (a defense on bye included)
        BRt = [t([b[i] for b in BR]) for i in range(3)]
        dl = t(lg_np[dm], torch.long)
        z = torch.zeros(int(dm.sum()), dtype=DT, device=DEV)
        def_proj[dm] = LM.defense_expected(z, torch.zeros_like(z, dtype=torch.bool), z, t(allowed_proj[dm]), t(other[dm]),
                                           torch.ones_like(z), BRt[0][dl], BRt[1][dl], BRt[2][dl]).cpu().numpy()
    proj_pre = np.where(is_def_np, def_proj, full * pre_share)
    proj_post = np.where(is_def_np, def_proj, full * post_share)
    proj_t = torch.where(started, t(proj_post).unsqueeze(1), t(proj_pre).unsqueeze(1))

    # Expected points still to come: defenses by bracket, everyone else projection x share left
    add = proj_t * rem
    hp = t(has_proj, torch.bool)[dix]
    if hp.any():
        k = dix[hp]
        pa = t(allowed_proj)[k].unsqueeze(1).expand(-1, T); po = t(other)[k].unsqueeze(1).expand(-1, T)
        add[k] = LM.defense_expected(points[k], started[k], allowed_now[k], pa, po, rem[k], lo[hp], hi[hp], bv[hp]) - points[k]

    score = torch.zeros(n_sides, T, dtype=DT, device=DEV).index_add_(0, side, points)
    m = t(has_proj, torch.bool)
    pa_, pb_ = t([p[0] for p in pairs], torch.long), t([p[1] for p in pairs], torch.long)
    pvar = None
    if VAR:
        ab = np.array([VAR.get(p, [0.0, 0.0]) for p in slot['pos']])
        pvar = ((t(ab[:, 0]).unsqueeze(1) + t(ab[:, 1]).unsqueeze(1) * proj_t) * (proj_t > 0))[m]
    odds, sd, fa, fb, scale = LM.win_odds(side[m], n_sides, t(groups, torch.long), t(spreads), proj_t[m], t(slot['ratio'])[m],
                                          rem[m], add[m], score, pa_, pb_, extras=True, pvar=pvar)
    # For skew: each side's third cumulant if a player's points still to come have skewness 1
    # (cumulants of points accrued over time grow with the time left, like the variance)
    sm = side[m]
    k3 = torch.zeros(n_sides, T, dtype=DT, device=DEV).index_add_(
        0, sm, (t(slot['ratio'])[m].unsqueeze(1) * proj_t[m]).abs() ** 3 * scale[sm] ** 1.5 * rem[m])
    # Share of each matchup's kickoff variance still to come
    left = (sd / sd[:, :1].clamp(min=1e-9)) ** 2
    return {'league': np.array([p[2] for p in pairs], dtype=np.int64), 'outcome': np.array(outcome),
            'diff': (fa - fb).float().cpu().numpy(), 'sd': sd.float().cpu().numpy(), 'left': left.float().cpu().numpy(),
            'odds': odds.float().cpu().numpy(), 'final_diff': (score[pa_, -1] - score[pb_, -1]).cpu().numpy(),
            'cur': (score[pa_] - score[pb_]).float().cpu().numpy(), 'k3': (k3[pa_] - k3[pb_]).float().cpu().numpy()}


def replay_season(season):
    t0 = time.time()
    lgs = leagues(season)
    comps = LC.load(season)
    proj, history, inj = season_inputs(season)
    keys = sorted({k for lg in lgs for k in lg['scoring']} | {'pts_allow'})
    weeks, check = [], []
    for w in sorted(comps):
        if not any(w in lg['weeks'] for lg in lgs): continue
        parts = replay_week(season, w, comps[w], lgs, proj, history, inj, keys)
        if not parts: continue
        r = {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}
        # The replay ends at the official finals: the last sample's margin is the real one
        real = np.array([o for o in r['outcome']])
        check.append(np.mean(np.sign(r['final_diff']) == np.sign(real - 0.5) * (real != 0.5) + 0 * real) if len(real) else 1)
        r['week'] = np.full(len(r['league']), w, dtype=np.int8)
        weeks.append(r)
        print(f'{season} week {w}: {len(r["league"]):,} matchups x {r["diff"].shape[1]} samples', flush=True)
    os.makedirs(OUT, exist_ok=True)
    flat = {f'{k}_{i}': r[k] for i, r in enumerate(weeks) for k in r}
    np.savez(os.path.join(OUT, f'{season}.npz'), n=len(weeks), **flat)
    print(f'{season}: {len(lgs)} leagues, {sum(len(r["league"]) for r in weeks):,} matchups, finals agree with results in '
          f'{np.mean(check):.2%} of weeks on average, {time.time() - t0:.0f}s', flush=True)


def load(season, out=None):
    z = np.load(os.path.join(out or OUT, f'{season}.npz'))
    return [{k: z[f'{k}_{i}'] for k in ('league', 'outcome', 'diff', 'sd', 'left', 'odds', 'week', 'final_diff', 'cur', 'k3')} for i in range(int(z['n']))]


if __name__ == '__main__':
    for s in [a for a in sys.argv[1:] if a.isdigit()] or LC.SEASONS:
        replay_season(s)
