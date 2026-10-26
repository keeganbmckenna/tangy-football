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
    LIVE_FIT=cache/live_state_fit/2025.json LIVE_USE=state,corr LIVE_TAG=_sc2025 python live_replay.py   # rungs 4-5

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
# LIVE_FIT + LIVE_USE (rungs 4-5): a fold's tables from live_state.py --fit, and which to use: state (game
# state on players' remaining points), corr (same-game correlations in the margin's variance),
# oracle_team / oracle_group (ceilings: each NFL team's, or team-position's, actual remaining points)
FIT = json.load(open(os.environ['LIVE_FIT'])) if os.environ.get('LIVE_FIT') else None
USE = set(filter(None, os.environ.get('LIVE_USE', '').split(',')))
HALF = {'pass_yd': 0.04, 'pass_td': 4, 'pass_int': -1, 'pass_2pt': 2, 'rec': 0.5, 'rec_yd': 0.1, 'rec_td': 6, 'rec_2pt': 2,
        'rush_yd': 0.1, 'rush_td': 6, 'rush_2pt': 2, 'fum_lost': -2, 'xpm': 1, 'xpmiss': -1, 'fgm_0_19': 3, 'fgm_20_29': 3,
        'fgm_30_39': 3, 'fgm_40_49': 4, 'fgm_50p': 5, 'fgmiss': -1}
SKILL = ('QB', 'RB', 'WR', 'TE', 'K')
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
    spans = [(int(g[2][0, 0]), int(g[2][-1, 0])) for g in games]
    times = {min(a for a, _ in spans) - 60}
    for a, b in spans:
        times.update(round(t / STEP) * STEP for t in range(a, b, STEP)); times.add(b)
    return np.array(sorted(times), dtype=np.int64)


def game_states(games, times):
    """team -> (state, remaining, own score, opponent score, drive EP from its side, game index), on the device"""
    out = {}
    T = len(times)
    for gid, (home, away, s, situ) in enumerate(games):
        first, last = s[0, 0], s[-1, 0]
        i = np.searchsorted(s[:, 0], times, side='right') - 1  # last snap at or before t
        snap = s[np.clip(i, 0, None)]
        state = np.where(times < first, LM.PRE, np.where(times >= last, LM.POST, LM.IN))
        sit = situ[np.clip(i, 0, None)]
        for team, mine, theirs, sign in ((home, 3, 4, 1.0), (away, 4, 3, -1.0)):
            own = np.where(state == LM.PRE, 0, snap[:, mine]); opp = np.where(state == LM.PRE, 0, snap[:, theirs])
            ball = sit[:, 0] * sign
            ep = np.where(state == LM.IN, np.where(ball > 0, sit[:, 2], np.where(ball < 0, -sit[:, 2], 0.0)), 0.0)
            # This team's chance the half's next score is its touchdown / field goal (nflfastR)
            td = np.where(state == LM.IN, np.where(ball > 0, sit[:, 3], np.where(ball < 0, sit[:, 5], 0.0)), 0.0)
            fg = np.where(state == LM.IN, np.where(ball > 0, sit[:, 4], np.where(ball < 0, sit[:, 6], 0.0)), 0.0)
            t = lambda a, dt=DT: torch.tensor(a, dtype=dt, device=DEV)
            rem = LM.game_remaining(t(state, torch.long), t(snap[:, 1]), t(snap[:, 2]), t(own - opp))
            rem = torch.where(t(state, torch.long) == LM.PRE, torch.ones(T, dtype=DT, device=DEV), rem)
            out[canon(team)] = (t(state, torch.long), rem, t(own), t(opp), t(ep), gid, t(snap[:, 1]), t(snap[:, 2]), t(td), t(fg))
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
    # Each player's half-PPR projection and his share of his NFL team's (for the drive EP term)
    half = {p: (st.get('pts_half_ppr') or 0.0) for p, (pos, _, st) in P.items() if pos in SKILL}
    team_half = defaultdict(float)
    for p, v in half.items(): team_half[P[p][1]] += v
    oracle = {}
    if USE & {'oracle_team', 'oracle_group'}:
        wh = torch.tensor([HALF.get(k, 0.0) for k in LC.COMPONENTS], device=DEV)
        cum = C @ wh  # [E, T]
        E_, A_ = defaultdict(lambda: torch.zeros(T, dtype=DT, device=DEV)), defaultdict(lambda: torch.zeros(T, dtype=DT, device=DEV))
        for p, v in half.items():
            team = P[p][1]
            if team not in games: continue
            key = (team, 'ALL' if 'oracle_team' in USE else P[p][0])
            E_[key] += v * games[team][1]
            if p in rows: A_[key] += (cum[rows[p], -1] - cum[rows[p]]).to(DT)
        oracle = {k: torch.where(E_[k] > 0.5, A_[k] / E_[k].clamp(min=0.5), torch.ones_like(E_[k])) for k in E_}
    extra = {'half': half, 'team_half': team_half, 'oracle': oracle, 'inj': injury_scale(week, times, rows, P), 'implied': IMPLIED.get((int(season), w), {}),
             'props': props_remaining(season, w, week, times, C, rows)}
    out = []
    for c0 in range(0, len(lgs), CHUNK):
        chunk = [lg for lg in lgs[c0:c0 + CHUNK] if w in lg['weeks']]
        if chunk: out.append(replay_chunk(chunk, w, T, times, games, C, rows, P, prow, PM, keys, ratio, reports, extra))
    return out


def injury_scale(week, times, rows, P):
    """[E, T] multiplier on each player's remaining projection after a flagged in-game injury
    (addendum test 1): the oracle zeroes it if he never records another stat in the game; the
    model scales it by the fitted chance he will, given the minutes since with no stat"""
    if not USE & {'inj_oracle', 'inj_model'} or not week.get('injured'): return None
    import live_injury as LI
    T = len(times)
    out = torch.ones(len(week['ids']), T, dtype=DT, device=DEV)
    ev = week['ev']
    for t_i, pid in week['injured']:
        e = rows.get(pid)
        group = LI.GROUP.get((P.get(pid) or (None,))[0])
        if e is None or not group: continue
        end = next((sn[-1, 0] for _, _, sn, _ in week['games'] if sn[0, 0] <= t_i <= sn[-1, 0]), t_i + 3600)
        later = ev['t'][(ev['who'] == e) & (ev['t'] > t_i + LI.RETURN_AFTER) & (ev['t'] <= end)]
        back = later.min() if len(later) else np.inf
        for j in np.flatnonzero((times >= t_i) & (times < back)):
            if 'inj_oracle' in USE:
                f = 0.0 if not np.isfinite(back) else 1.0
            else:
                mins = (times[j] - t_i) / 60
                b = max(x for x in LI.BINS if x <= mins)
                f = (FIT['returns'].get(group) or {}).get(str(b))
                f = 1.0 if f is None else f
            out[e, j] = min(out[e, j].item(), f)
    return out


def implied_points():
    """(season, week) -> team -> implied points minus the week's average (nflverse closing lines)"""
    if 'vegas' not in USE: return {}
    import live_injury as LI
    d = LI.implied()
    out = defaultdict(dict)
    for r in d.itertuples(): out[(int(r.season), int(r.week))][canon(r.team)] = r.centred
    return out


IMPLIED = implied_points()
# LIVE_USE=props (addendum test 5): blend weight on the Kalshi props' expected remaining stats
PROPS_W = float(os.environ.get('LIVE_PROPS_W', 0.5))
PROP_STATS = ('pass_yd', 'rush_yd', 'rec_yd', 'rec', 'pass_td', 'td')
PROPS = None


def props_remaining(season, w, week, times, C, rows):
    """[E, T, 6] each player's expected remaining stats by the props (expected final minus so far),
    nan where the stat has no price then (addendum test 5)"""
    global PROPS
    if 'props' not in USE or season != '2025': return None
    if PROPS is None:
        import kalshi_props_model as KP
        PROPS = KP.load()
    E, T = len(week['ids']), len(times)
    out = torch.full((E, T, len(PROP_STATS)), float('nan'), dtype=DT, device=DEV)
    K = LC.K
    for pid, e in rows.items():
        row = PROPS.get((w, pid))
        if row is None: continue
        i = np.searchsorted(row['times'], times, side='right') - 1
        ok = i >= 0
        for j, stat in enumerate(PROP_STATS):
            if stat not in row: continue
            v = np.full(T, np.nan); v[ok] = row[stat][i[ok]]
            so_far = (C[e, :, K['rush_td']] + C[e, :, K['rec_td']]) if stat == 'td' else C[e, :, K[stat]]
            rem_ = (torch.tensor(v, dtype=DT, device=DEV) - so_far.to(DT)).clamp(min=0)
            if stat == 'td':
                # Anytime TD only prices the first one: once he has scored it says nothing more
                rem_ = torch.where(so_far >= 1, torch.full_like(rem_, float('nan')), rem_)
            out[e, :, j] = rem_
    return out


def replay_chunk(chunk, w, T, times, games, C, rows, P, prow, PM, keys, ratio, reports, extra):
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
                slot['share'].append(extra['half'].get(pid, 0.0) / max(extra['team_half'].get(team, 0.0), 1.0))
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
    if 'vegas' in USE:
        # Addendum test 2: each player's projection moved by his team's implied points
        beta = np.array([FIT['vegas'].get(p, 0.0) for p in slot['pos']])
        imp_c = np.array([extra['implied'].get(tm, 0.0) if tm else 0.0 for tm in slot['team']])
        full = np.where(has_proj & ~is_def_np, np.maximum(full + beta * imp_c, 0.0), full)
    proj_pre = np.where(is_def_np, def_proj, full * pre_share)
    proj_post = np.where(is_def_np, def_proj, full * post_share)
    proj_t = torch.where(started, t(proj_post).unsqueeze(1), t(proj_pre).unsqueeze(1))
    if extra.get('inj') is not None:
        # Addendum test 1: an injured player's remaining projection (and so his spread) scaled
        known = (ent >= 0) & ~is_def
        proj_t = proj_t.clone()
        proj_t[known] = proj_t[known] * extra['inj'][ent[known]]

    # Expected points still to come: defenses by bracket, everyone else projection x share left
    add = proj_t * rem
    inplay = (state == LM.IN) & ~is_def.unsqueeze(1)
    if 'state' in USE:
        # Rung 4: the share left scaled by position, quarter and score margin, plus the drive's expected points
        PI = {p: i for i, p in enumerate(SKILL)}
        F = torch.ones(len(SKILL), 4, 7, dtype=DT, device=DEV)
        for k, v in FIT['F'].items():
            p_, rb, mb = k.split('|')
            if p_ in PI: F[PI[p_], int(float(rb)), int(float(mb))] = v
        G_own = torch.stack([games[tm][2] for tm in teams] + [torch.zeros(T, dtype=DT, device=DEV)])
        G_ep = torch.stack([games[tm][4] for tm in teams] + [torch.zeros(T, dtype=DT, device=DEV)])
        margin = G_own[gi] - opp
        rb = torch.bucketize(rem.contiguous(), torch.tensor([0.25, 0.5, 0.75], dtype=DT, device=DEV)).clamp(max=3)
        mb = torch.bucketize(margin.contiguous(), torch.tensor([-17, -9, -4, 3, 8, 16], dtype=DT, device=DEV))
        pi = t([PI.get(p, -1) for p in slot['pos']], torch.long)
        ok = (pi >= 0).unsqueeze(1)
        f = torch.where(ok, F[pi.clamp(min=0).unsqueeze(1), rb, mb], torch.ones_like(rem))
        beta = t([FIT['beta'].get(p, 0.0) for p in slot['pos']]).unsqueeze(1)
        add = torch.where(inplay & ok, proj_t * rem * f + beta * t(slot['share']).unsqueeze(1) * G_ep[gi], add)
    if extra.get('props') is not None:
        # Addendum test 5: for each priced stat, the props' expected remaining amount replaces the
        # model's (projected stat x share left) at the blend weight, in the league's scoring
        kix = {k: i for i, k in enumerate(keys)}
        col = lambda k: PM[prow_, kix[k]] if k in kix else np.zeros(S)
        wcol = lambda k: WP[lg_np, kix[k]] if k in kix else np.zeros(S)
        proj_stats = {'pass_yd': col('pass_yd'), 'rush_yd': col('rush_yd'), 'rec_yd': col('rec_yd'), 'rec': col('rec'),
                      'pass_td': col('pass_td'), 'td': col('rush_td') + col('rec_td')}
        weights = {'pass_yd': wcol('pass_yd'), 'rush_yd': wcol('rush_yd'), 'rec_yd': wcol('rec_yd'), 'rec': wcol('rec'),
                   'pass_td': wcol('pass_td'), 'td': (wcol('rush_td') + wcol('rec_td')) / 2}
        known = (ent >= 0) & ~is_def & t(has_proj, torch.bool)
        mk = extra['props'][ent.clamp(min=0)]  # [S, T, 6]
        delta = torch.zeros(S, T, dtype=DT, device=DEV)
        for j, stat in enumerate(PROP_STATS):
            m_rem = mk[:, :, j]
            model_rem = t(proj_stats[stat]).unsqueeze(1) * rem
            d = torch.where(torch.isfinite(m_rem), m_rem - model_rem, torch.zeros_like(rem))
            delta = delta + t(weights[stat]).unsqueeze(1) * d
        delta = torch.where(known.unsqueeze(1) & (state == LM.IN) | known.unsqueeze(1) & (state == LM.PRE), delta, torch.zeros_like(delta))
        add = add + PROPS_W * delta
    if extra['oracle']:
        # Ceilings: each player's remaining mean scaled by his team's (or team-position's) actual / expected
        key = lambda i: (slot['team'][i], 'ALL' if 'oracle_team' in USE else slot['pos'][i])
        one = torch.ones(T, dtype=DT, device=DEV)
        ratio_t = torch.stack([extra['oracle'].get(key(i), one) if slot['team'][i] else one for i in range(S)])
        add = torch.where(inplay, proj_t * rem * ratio_t, add)
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
    eg_out = None
    if USE & {'endgame', 'endgame6b'}:
        eg_out = endgame_odds(slot, S, T, m, side, n_sides, pairs, games, teams, gi, state, rem, add, proj_t, scale, fa, fb, sd, pvar,
                              P, prow_, PM, keys, WP, lg_np, full, is_def)
    if 'corr' in USE:
        # Rung 5: same-game pairs of modelled starters add 2 rho sd_i sd_j to the margin's variance
        # (+ on the same fantasy side, - on opposite sides)
        mi = torch.nonzero(m).squeeze(1)
        pv = ((t(slot['ratio'])[m].unsqueeze(1) * proj_t[m]) ** 2) if pvar is None else pvar
        sig = (pv * rem[m] * scale[side[m]]).clamp(min=0).sqrt()
        where = {}
        for k, (sa, sb, _) in enumerate(pairs): where[sa] = (k, 1.0); where[sb] = (k, -1.0)
        gid = {tm: games[tm][5] for tm in teams}
        by = defaultdict(list)
        for j, i in enumerate(mi.tolist()):
            si = slot['side'][i]
            if si in where and slot['team'][i] in gid:
                k, sg = where[si]
                by[k].append((j, sg, slot['pos'][i], slot['team'][i], gid[slot['team'][i]]))
        I, J, Kk, coef = [], [], [], []
        for k, members in by.items():
            for x in range(len(members)):
                for y in range(x + 1, len(members)):
                    a, b = members[x], members[y]
                    if a[4] != b[4]: continue
                    pa_s, pb_s = sorted((a[2], b[2]))
                    r = FIT['rho'].get(f'{pa_s}|{pb_s}|{int(a[3] == b[3])}', 0.0)
                    if r: I.append(a[0]); J.append(b[0]); Kk.append(k); coef.append(r * a[1] * b[1])
        if I:
            cov = torch.zeros(len(pairs), T, dtype=DT, device=DEV).index_add_(0, t(Kk, torch.long), t(coef).unsqueeze(1) * sig[t(I, torch.long)] * sig[t(J, torch.long)])
            sd = (sd ** 2 + 2 * cov).clamp(min=0).sqrt()
            d_ = fa - fb
            odds = torch.where(sd > 0.01, LM.normal_cdf(d_ / sd.clamp(min=0.01)), torch.where(d_ > 0, 1.0, torch.where(d_ < 0, 0.0, 0.5)).to(DT))
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
            'cur': (score[pa_] - score[pb_]).float().cpu().numpy(), 'k3': (k3[pa_] - k3[pb_]).float().cpu().numpy(),
            **(eg_out or {})}


MULT = float(os.environ.get('LIVE_MULT', 1.0))
EG_STEP, EG_BINS = 0.25, 1024


def endgame_odds(slot, S, T, m, side, n_sides, pairs, games, teams, gi, state, rem, add, proj_t, scale, fa, fb, sd, pvar,
                 P, prow_, PM, keys, WP, lg_np, full, is_def):
    """Addendum test 6: in a game's last 5 minutes, each team's touchdown / field goal as a discrete
    outcome (nflfastR's next-score chances), its touchdowns given to players by their share of the
    team's projected TDs. Returns a's odds with and without it at LIVE_MULT, and where it applied."""
    dev = rem.device
    t_ = lambda a, dt=DT: torch.tensor(a, dtype=dt, device=dev)
    NT = len(teams)
    st = lambda i: torch.stack([games[tm][i] for tm in teams] + [torch.zeros(T, dtype=DT, device=dev)])
    Q, CLK, TD, FG = st(6), st(7), st(8), st(9)
    OWN, OPP = st(2), st(3)
    St = torch.stack([games[tm][0] for tm in teams] + [torch.full((T,), -1, dtype=torch.long, device=dev)])
    eg_team = (St == LM.IN) & (((Q == 4) & (CLK <= 300)) | (Q >= 5))
    if 'endgame6b' in USE:
        trail = OPP - OWN
        FG = torch.where((Q == 4) & (CLK <= 120) & (trail >= 4) & (trail <= 8), torch.zeros_like(FG), FG)
    # League scoring per slot
    kix = {k: i for i, k in enumerate(keys)}
    col = lambda k: PM[prow_, kix[k]] if k in kix else np.zeros(S)
    wcol = lambda k: WP[lg_np, kix[k]] if k in kix else np.zeros(S)
    rush_td, rec_td, pass_td = col('rush_td'), col('rec_td'), col('pass_td')
    w_rush, w_rec, w_pass, w_xp = wcol('rush_td'), wcol('rec_td'), wcol('pass_td'), wcol('xpm')
    w_fg = np.where(wcol('fgm_30_39') > 0, wcol('fgm_30_39'), 3.0)
    pos = np.array(slot['pos'])
    is_k, is_qb = pos == 'K', pos == 'QB'
    td_pts = w_rush * rush_td + w_rec * rec_td + w_pass * pass_td
    frac = np.where(is_k, 1.0, np.clip(np.where(full > 0, td_pts / np.maximum(full, 1e-9), 0.0), 0, 1))
    # Each NFL team's projected rushing + receiving TDs (all its projected players), for the shares
    team_td, team_rush = defaultdict(float), defaultdict(float)
    for pid, (p_pos, tm, stt) in P.items():
        if p_pos in ('QB', 'RB', 'WR', 'TE'):
            team_td[tm] += (stt.get('rush_td') or 0) + (stt.get('rec_td') or 0); team_rush[tm] += stt.get('rush_td') or 0
    rush_share_team = torch.tensor([team_rush[tm] / team_td[tm] if team_td.get(tm) else 0.45 for tm in teams] + [0.45], dtype=DT, device=dev)
    tot = np.array([max(team_td.get(tm, 0.0), 1e-6) if tm else 1e-6 for tm in slot['team']])
    sh_rush, sh_rec = np.where(is_k, 0, rush_td / tot), np.where(is_k, 0, rec_td / tot)
    # Sides -> matchup and sign
    M_ = len(pairs)
    mk = np.full(n_sides, -1); sg = np.zeros(n_sides)
    for k, (sa, sb, _) in enumerate(pairs): mk[sa], sg[sa], mk[sb], sg[sb] = k, 1.0, k, -1.0
    sl_side = np.array(slot['side'])
    s_k, s_sign = mk[sl_side], sg[sl_side]
    # Per-slot variance as win_odds has it (unscaled by the multiplier)
    ratio = t_(slot['ratio']).unsqueeze(1)
    pv = (ratio * proj_t) ** 2 if pvar is None else None
    var_i = torch.zeros(S, T, dtype=DT, device=dev)
    msk = t_(np.array(slot['proj_row']) >= 0, torch.bool)
    if pv is not None: var_i[msk] = pv[msk] * rem[msk] * scale[side[msk]]
    usable = msk & ~is_def & t_(s_k >= 0, torch.bool)
    eg_slot = eg_team[gi] & usable.unsqueeze(1)                       # [S, T]
    sign_t, f_t = t_(s_sign), t_(frac)
    k_t = t_(np.maximum(s_k, 0), torch.long)
    # The smooth part keeps only its non-TD share
    mu_adj = torch.zeros(M_, T, dtype=DT, device=dev).index_add_(0, k_t, torch.where(eg_slot, sign_t.unsqueeze(1) * add * f_t.unsqueeze(1), torch.zeros_like(add)))
    dvar = torch.zeros(M_, T, dtype=DT, device=dev).index_add_(0, k_t, torch.where(eg_slot, var_i * (1 - (1 - f_t.unsqueeze(1)) ** 2), torch.zeros_like(var_i)))
    diff = fa - fb
    mu = diff - mu_adj
    s2 = (MULT * sd) ** 2 - MULT ** 2 * dvar
    s_new = s2.clamp(min=1e-4).sqrt()
    base = torch.where(sd > 0.01, LM.normal_cdf(diff / (MULT * sd).clamp(min=0.01)), torch.where(diff > 0, 1.0, torch.where(diff < 0, 0.0, 0.5)).to(DT))
    odds = base.clone()
    flag = torch.zeros(M_, T, dtype=DT, device=dev).index_add_(0, k_t, eg_slot.to(DT)) > 0
    grid = torch.arange(EG_BINS, device=dev, dtype=DT)
    grid = torch.where(grid < EG_BINS // 2, grid, grid - EG_BINS) * EG_STEP
    bin_of = lambda v: torch.round(v / EG_STEP).long() % EG_BINS
    sl_team = gi
    for ti in torch.nonzero(flag.any(0)).squeeze(1).tolist():
        idx = torch.nonzero(eg_slot[:, ti]).squeeze(1)
        if not len(idx): continue
        kk, tt = k_t[idx], sl_team[idx]
        key = kk * (NT + 1) + tt
        ukey, grp = torch.unique(key, return_inverse=True)
        G = len(ukey)
        g_k, g_team = ukey // (NT + 1), ukey % (NT + 1)
        sgn = sign_t[idx]
        # Per group: XP, FG and QB-pass jumps, and the shares its matchup players hold
        z = lambda: torch.zeros(G, dtype=DT, device=dev)
        xp = z().index_add_(0, grp, torch.where(t_(is_k, torch.bool)[idx], sgn * t_(w_xp)[idx], torch.zeros_like(sgn)))
        fgj = z().index_add_(0, grp, torch.where(t_(is_k, torch.bool)[idx], sgn * t_(w_fg)[idx], torch.zeros_like(sgn)))
        qbj = z().index_add_(0, grp, torch.where(t_(is_qb, torch.bool)[idx], sgn * t_(w_pass)[idx], torch.zeros_like(sgn)))
        srush = z().index_add_(0, grp, t_(sh_rush)[idx]); srec = z().index_add_(0, grp, t_(sh_rec)[idx])
        p_td, p_fg = TD[g_team, ti].clamp(0, 1), FG[g_team, ti].clamp(0, 1)
        p_none = (1 - p_td - p_fg).clamp(min=0)
        # The team's own split of its other TDs: rushing vs receiving, from its whole roster's projection
        other = (1 - srush - srec).clamp(min=0)
        pmf = torch.zeros(G * EG_BINS, dtype=DT, device=dev)
        def put(gidx, jump, prob):
            pmf.index_add_(0, gidx * EG_BINS + bin_of(jump), prob)
        gid = torch.arange(G, device=dev)
        put(gid, torch.zeros(G, dtype=DT, device=dev), p_none)
        put(gid, fgj, p_fg)
        rs = rush_share_team[g_team]
        put(gid, xp, p_td * other * rs)              # another player's rushing TD
        put(gid, xp + qbj, p_td * other * (1 - rs))  # another player's receiving TD (the QB's pass)
        # Each matchup player's own TD
        put(grp, xp[grp] + sgn * t_(w_rush)[idx], p_td[grp] * t_(sh_rush)[idx])
        put(grp, xp[grp] + qbj[grp] + sgn * t_(w_rec)[idx], p_td[grp] * t_(sh_rec)[idx])
        pmf = pmf.view(G, EG_BINS)
        pmf = pmf / pmf.sum(1, keepdim=True).clamp(min=1e-12)
        F = torch.fft.fft(pmf.to(torch.complex128), dim=1)
        prod = torch.ones(M_, EG_BINS, dtype=torch.complex128, device=dev)
        order = torch.argsort(g_k)
        ranks = torch.zeros(G, dtype=torch.long, device=dev)
        sk = g_k[order]
        first = torch.ones_like(sk, dtype=torch.bool); first[1:] = sk[1:] != sk[:-1]
        start = torch.cummax(torch.where(first, torch.arange(G, device=dev), torch.zeros_like(sk)), 0).values
        ranks[order] = torch.arange(G, device=dev) - start
        for r in range(int(ranks.max().item()) + 1):
            sel = ranks == r
            prod[g_k[sel]] = prod[g_k[sel]] * F[sel]
        ks = torch.unique(g_k)
        dist = torch.fft.ifft(prod[ks], dim=1).real.clamp(min=0)
        dist = dist / dist.sum(1, keepdim=True).clamp(min=1e-12)
        z_ = (mu[ks, ti].unsqueeze(1) + grid.unsqueeze(0)) / s_new[ks, ti].unsqueeze(1)
        odds[ks, ti] = (dist * LM.normal_cdf(z_)).sum(1)
    return {'odds_m': base.float().cpu().numpy(), 'odds_eg': odds.float().cpu().numpy(), 'eg': flag.cpu().numpy()}


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
    keys = ('league', 'outcome', 'diff', 'sd', 'left', 'odds', 'week', 'final_diff', 'cur', 'k3', 'odds_m', 'odds_eg', 'eg')
    return [{k: z[f'{k}_{i}'] for k in keys if f'{k}_{i}' in z.files} for i in range(int(z['n']))]


if __name__ == '__main__':
    for s in [a for a in sys.argv[1:] if a.isdigit()] or LC.SEASONS:
        replay_season(s)
