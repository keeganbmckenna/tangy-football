"""The Live tab's win-odds model (web/lib/analyze/live.ts) in PyTorch, for replaying thousands
of crawled leagues at once on the GPU (live_replay.py).

Each function mirrors one in live.ts and works elementwise on tensors of any shape, so a
whole NFL week (every starter of every league, every 3-minute sample) runs as a few large
tensor operations. Game states are coded 0 pre, 1 in, 2 post. Points-allowed brackets are
padded tensors (lo, hi, value) along the last dimension, in the league's key order.

    python live_model.py    # parity: every case in live_odds_fixture.json, exported from the
                            # site's own code by web/scripts/export-live-fixture.ts
"""
import json, math, os, re

import torch

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, 'live_odds_fixture.json')

FULL_GAME_MARGIN_SD = 13.5
TIE_BAND = 1.9
OT_MINUTES_LEFT = [6.46, 5.55, 4.72, 3.96, 3.22, 2.55, 1.97, 1.61, 1.39, 0.93, 0]
POINTS_ALLOWED_SD = 8.9
# The site's scale (1.0 since 2026-10-26; the replays scored in LOG.md used 0.7, and the
# multipliers fitted there are relative to it)
LIVE_SPREAD_SCALE = 1.0
POSITION_SPREAD_RATIO = {'QB': 0.45, 'RB': 0.6, 'WR': 0.6, 'TE': 0.65, 'K': 0.55, 'DEF': 0.6}
SPREAD_PRIOR_GAMES = 4
RULED_OUT = {'Out', 'IR', 'PUP', 'Sus', 'NA', 'DNR', 'COV'}
PRE, IN, POST = 0, 1, 2


def normal_cdf(z):
    """live.ts's normalCdf (trade.ts): Abramowitz and Stegun's erf approximation, not the exact one"""
    x = z.abs() / math.sqrt(2)
    t = 1 / (1 + 0.3275911 * x)
    erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * torch.exp(-x * x)
    return torch.where(z >= 0, 0.5 * (1 + erf), 0.5 * (1 - erf))


def overtime_remaining(clock):
    played = ((600 - clock) / 60).clamp(0, 10)
    i = played.floor().clamp(max=9).long()
    table = torch.tensor(OT_MINUTES_LEFT, dtype=clock.dtype, device=clock.device)
    left = table[i] + (table[i + 1] - table[i]) * (played - i)
    return torch.minimum(left, clock / 60) / 60


def game_remaining(state, period, clock, margin):
    """Share of an NFL game still to play, overtime chance included (gameRemaining)"""
    clock, margin = clock.to(torch.float64) if not clock.is_floating_point() else clock, margin.to(clock.dtype) if not margin.is_floating_point() else margin
    ot = overtime_remaining(clock.clamp(min=0))
    regulation = torch.where(state == PRE, torch.ones_like(clock), (((4 - period) * 900 + clock) / 3600).clamp(0, 1))
    sd = FULL_GAME_MARGIN_SD * regulation.sqrt()
    safe = sd.clamp(min=0.5)
    tie = torch.where(sd > 0.5, (TIE_BAND * torch.exp(-0.5 * (margin / safe) ** 2) / (safe * math.sqrt(2 * math.pi))).clamp(max=0.9),
                      (margin == 0).to(clock.dtype))
    full_ot = overtime_remaining(torch.full_like(clock, 600.0))
    out = torch.where(period > 4, ot, regulation + tie * full_ot)
    return torch.where(state == POST, torch.zeros_like(out), out)


def brackets(scoring, width=10):
    """A league's points-allowed brackets as (lo, hi, value) lists in key order, padded to width"""
    lo, hi, v = [], [], []
    for k, val in scoring.items():
        m = re.fullmatch(r'pts_allow_(\d+)(?:_(\d+)|(p))?', k)
        if not m: continue
        a = int(m.group(1))
        lo.append(a); hi.append(math.inf if m.group(3) else int(m.group(2)) if m.group(2) is not None else a); v.append(float(val))
    pad = width - len(lo)
    return lo + [math.inf] * pad, hi + [math.inf] * pad, v + [0.0] * pad


def allowed_points(allowed, lo, hi, v):
    """The points of the first bracket (in key order) holding this many allowed (allowedPoints).
    allowed [...]; lo, hi, v [..., B]"""
    a = allowed.unsqueeze(-1)
    hit = (a >= lo) & (a <= hi)
    first = hit & (hit.cumsum(-1) == 1)
    return (first * v).sum(-1)


def defense_expected(points, started, allowed_now, proj_allowed, proj_other, remaining, lo, hi, v):
    """A defense's expected final points (defenseExpected); brackets along the last dim of lo, hi, v"""
    current = torch.where(started, allowed_points(allowed_now, lo, hi, v), torch.zeros_like(points))
    other_so_far = points - current
    mu = proj_allowed * remaining
    sd = POINTS_ALLOWED_SD * remaining.sqrt()
    an, m_, s_ = allowed_now.unsqueeze(-1), mu.unsqueeze(-1), sd.unsqueeze(-1)

    def at_most(t):
        p = torch.where(s_ < 0.01, (an + m_ <= t).to(points.dtype), normal_cdf((t + 0.5 - an - m_) / s_.clamp(min=0.01)))
        return torch.where(t < an, torch.zeros_like(p), p)
    real = torch.isfinite(lo)
    top = torch.where(torch.isinf(hi), torch.ones_like(lo), at_most(torch.where(torch.isinf(hi), torch.zeros_like(hi), hi)))
    bottom = torch.where(lo == 0, torch.zeros_like(lo), at_most(torch.where(real, lo - 1, torch.zeros_like(lo))))
    p = torch.where(real, top - bottom, torch.zeros_like(lo))
    return other_so_far + proj_other * remaining + (p * v).sum(-1)


def injury_adjusted(points, status, started):
    """injuryAdjusted for one player (Python scalars)"""
    if status in RULED_OUT: return 0.0
    if status == 'Doubtful' and not started: return 0.0
    if status == 'Questionable' and not started: return points * 0.9
    return points


def player_spread_ratio(position, scores):
    prior = POSITION_SPREAD_RATIO.get(position, 0.75)
    n = len(scores)
    if n < 2: return prior
    mean = sum(scores) / n
    if mean <= 1: return prior
    sd = math.sqrt(sum((x - mean) ** 2 for x in scores) / (n - 1))
    return (n * min(sd / mean, 2) + SPREAD_PRIOR_GAMES * prior) / (n + SPREAD_PRIOR_GAMES)


def win_odds(side, n_sides, group, spread, proj, ratio, remaining, add, score, pair_a, pair_b, extras=False, pvar=None):
    """liveWinOdds for many league-weeks at once.

    side [S]       each modelled starter's (one with a projection) matchup side
    group [n_sides] each side's league-week, whose sides share the variance scale
    spread [G]     each league-week's weekly spread (scoreSpread)
    proj, ratio    each starter's projection (as the live tab has it then) and spread ratio, [S] or [S, T]
    remaining      share of his game left [S, T]; add: points he's still expected to add [S, T]
    score          each side's score [n_sides, T]; pair_a, pair_b: the sides of each matchup [M]
    Returns (a's win odds, sd, a's projected final, b's) each [M, T]; with extras, also each
    side's variance scale [n_sides, T] (for research terms built on the same scaling). pvar [S, T]
    replaces each player's unscaled variance (research).
    """
    T = remaining.shape[-1]
    dt = remaining.dtype
    if ratio.dim() < proj.dim(): ratio = ratio.unsqueeze(-1)
    # Each player's whole-game variance before scaling: the site's (ratio x projection)^2, or a
    # research variance model's (pvar)
    pv = (ratio * proj) ** 2 if pvar is None else pvar
    if pv.dim() == 1: pv = pv.unsqueeze(-1).expand(-1, T)
    lineup = torch.zeros(n_sides, T, dtype=dt, device=remaining.device).index_add_(0, side, pv)
    G = spread.shape[0]
    pos = (lineup > 0).to(dt)
    total = torch.zeros(G, T, dtype=dt, device=remaining.device).index_add_(0, group, lineup)
    count = torch.zeros(G, T, dtype=dt, device=remaining.device).index_add_(0, group, pos)
    full = (spread * LIVE_SPREAD_SCALE) ** 2
    scale = torch.where(count > 0, full.unsqueeze(-1) / (total / count.clamp(min=1)).clamp(min=1e-300), torch.ones_like(total))
    var = torch.zeros(n_sides, T, dtype=dt, device=remaining.device).index_add_(0, side, pv * remaining * scale[group][side])
    left = torch.zeros(n_sides, T, dtype=dt, device=remaining.device).index_add_(0, side, add)
    projected = score + left
    diff = projected[pair_a] - projected[pair_b]
    sd = (var[pair_a] + var[pair_b]).sqrt()
    odds = torch.where(sd > 0.01, normal_cdf(diff / sd.clamp(min=0.01)), torch.where(diff > 0, 1.0, torch.where(diff < 0, 0.0, 0.5)).to(dt))
    if extras: return odds, sd, projected[pair_a], projected[pair_b], scale[group]
    return odds, sd, projected[pair_a], projected[pair_b]


# --- Parity with the site's code -------------------------------------------------------------

STATE = {'pre': PRE, 'in': IN, 'post': POST}


def check(path=FIXTURE):
    f = json.load(open(path))
    d = torch.float64
    worst = {}

    g = f['gameRemaining']
    got = game_remaining(torch.tensor([STATE[c['state']] for c in g]), torch.tensor([c['period'] for c in g], dtype=d),
                         torch.tensor([c['clock'] for c in g], dtype=d), torch.tensor([c['margin'] for c in g], dtype=d))
    worst['gameRemaining'] = (got - torch.tensor([c['out'] for c in g], dtype=d)).abs().max().item()

    c = f['normalCdf']
    worst['normalCdf'] = (normal_cdf(torch.tensor([x['z'] for x in c], dtype=d)) - torch.tensor([x['out'] for x in c], dtype=d)).abs().max().item()

    worst['playerSpreadRatio'] = max(abs(player_spread_ratio(x['position'], x['scores']) - x['out']) for x in f['playerSpreadRatio'])

    errs = []
    for x in f['defenseExpected']:
        lo, hi, v = (torch.tensor(a, dtype=d) for a in brackets(x['scoring']))
        out = defense_expected(torch.tensor(x['points'], dtype=d), torch.tensor(x['started']), torch.tensor(float(x['allowedNow']), dtype=d),
                               torch.tensor(x['projection']['allowed'], dtype=d), torch.tensor(x['projection']['other'], dtype=d),
                               torch.tensor(x['remaining'], dtype=d), lo, hi, v)
        errs.append(abs(out.item() - x['out']))
    worst['defenseExpected'] = max(errs)

    errs = []
    for x in f['liveWinOdds']:
        got = odds_from_site_inputs(x['matchups'], x['projections'], x['games'], x['spread'], x['defense'])
        for o in x['out']:
            k = got[o['matchupId']]
            errs.append(max(abs(k[0] - o['aWinOdds']), abs(k[1] - o['sd']), abs(k[2] - o['aProjected']), abs(k[3] - o['bProjected'])))
        if set(got) != {o['matchupId'] for o in x['out']}: errs.append(math.inf)
    worst['liveWinOdds'] = max(errs)
    for k, v in worst.items(): print(f'{k:18s} largest difference {v:.2e}  {"ok" if v < 1e-9 else "MISMATCH"}')
    return all(v < 1e-9 for v in worst.values())


def odds_from_site_inputs(matchups, projections, games, spread, defense, device='cpu'):
    """liveWinOdds on the site's own data shapes (one league-week), through win_odds: the
    harness's path, checked against the fixture. matchup ID -> (odds, sd, a's projected, b's)"""
    d = torch.float64
    scoring = defense.get('allowedScoring') or {}
    lo, hi, v = brackets(scoring)
    by = {}
    for m in matchups:
        if m.get('matchup_id') is not None: by.setdefault(m['matchup_id'], []).append(m)
    pairs = sorted((mid, p) for mid, p in by.items() if len(p) == 2)
    sides = [m for _, p in pairs for m in p] + [m for m in matchups if m.get('matchup_id') is None or len(by[m['matchup_id']]) != 2]
    S = {k: [] for k in ('side', 'proj', 'ratio', 'rem', 'pts', 'def', 'started', 'allowed', 'pa', 'po')}
    for i, m in enumerate(sides):
        for pid in m.get('starters') or []:
            p = projections.get(pid)
            if pid == '0' or not p: continue
            g = games.get(p['team']) if p.get('team') else None
            S['side'].append(i); S['proj'].append(p['points']); S['ratio'].append(p['spreadRatio'])
            S['rem'].append(g['remaining'] if g else 0.0); S['pts'].append((m.get('players_points') or {}).get(pid, 0.0))
            is_def = bool(p.get('defense')) and bool(scoring) and g is not None
            S['def'].append(is_def); S['started'].append(bool(g) and g['state'] != 'pre')
            S['allowed'].append(float((defense.get('allowed') or {}).get(pid, 0)))
            S['pa'].append(p['defense']['allowed'] if p.get('defense') else 0.0); S['po'].append(p['defense']['other'] if p.get('defense') else 0.0)
    t = lambda k, dt=d: torch.tensor(S[k], dtype=dt).unsqueeze(-1)
    rem, pts = t('rem'), t('pts')
    n = rem.shape[0]
    B = lambda a: torch.tensor(a, dtype=d).expand(n, 1, -1)
    de = defense_expected(pts, t('started', torch.bool), t('allowed'), t('pa'), t('po'), rem, B(lo), B(hi), B(v)) - pts
    add = torch.where(t('def', torch.bool), de, t('proj') * rem)
    score = torch.tensor([[m.get('points') or 0.0] for m in sides], dtype=d)
    a = torch.tensor([2 * k for k in range(len(pairs))]); b = a + 1
    odds, sd, pa, pb = win_odds(torch.tensor(S['side']), len(sides), torch.zeros(len(sides), dtype=torch.long), torch.tensor([spread], dtype=d),
                                t('proj').squeeze(-1), t('ratio').squeeze(-1), rem, add, score, a, b)
    return {mid: (odds[k, 0].item(), sd[k, 0].item(), pa[k, 0].item(), pb[k, 0].item()) for k, (mid, _) in enumerate(pairs)}


if __name__ == '__main__':
    raise SystemExit(0 if check() else 1)
