"""How likely an injured player is to play his team's next game, by games missed in a row.

The odds model scales an out player's later weeks by these chances (RETURN_RATE in
web/lib/analyze/availability.ts). They were first measured in a scratch run that wasn't kept;
this rebuilds them reproducibly. Every QB/RB/WR/TE who'd been playing and mattered (Sleeper
projected him 5+ half-PPR points the week before his absence), 2018-2025: each game his team
played after he missed one or more in a row, did he play it? A season's last game ends the
record there (censored). Byes don't count as games.

Two populations, as before:
  all       every absence
  ended     absences that ended with him playing again that season, the closer match for the
            players the model applies it to (Sleeper projects them back next week, which leaves
            out season-ending injuries). Conditioning on a later return biases it up a little;
            the archive can't recreate the model's gate (its projections are the final
            pre-game ones, which already know who played), so the truth is between the two.

    python returns.py
"""
import gzip, json, os
from collections import defaultdict

from statsmodels.stats.proportion import proportion_confint

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE = os.path.join(HERE, '..', '..', 'data', 'sleeper')
MIN_PROJECTION = 5.0
MAX_STREAK = 4  # 4 means 4 or more


def arch(season, name):
    return json.load(gzip.open(os.path.join(ARCHIVE, season, f'{name}.json.gz'), 'rt'))


def season_counts(season, counts):
    plays = defaultdict(set)
    for g in arch(season, 'schedule'): plays[g['week']].update((g['home'], g['away']))
    weeks = sorted(plays)
    stats = {w: arch(season, f'stats/{w}') for w in weeks}
    proj = {}
    for w in weeks:
        for r in arch(season, f'projections/{w}'):
            pos = (r.get('player') or {}).get('position')
            if pos in ('QB', 'RB', 'WR', 'TE'):
                proj.setdefault(r['player_id'], {})[w] = (r.get('team'), (r.get('stats') or {}).get('pts_half_ppr') or 0.0)
    for pid, by_week in proj.items():
        # His team's games, in order: (played?, his projection that week)
        seq = []
        for w in weeks:
            known = [k for k in by_week if k <= w]
            team = by_week[w][0] if w in by_week else (by_week[max(known)][0] if known else None)
            if not team or team not in plays[w]: continue
            seq.append((bool((stats[w].get(pid) or {}).get('gp')), by_week.get(w, (None, 0.0))[1]))
        i = 1
        while i < len(seq):
            if seq[i][0] or not seq[i - 1][0] or seq[i - 1][1] < MIN_PROJECTION:
                i += 1
                continue
            j = i
            while j < len(seq) and not seq[j][0]: j += 1
            run, ended = j - i, j < len(seq)
            # After missing k in a row (k = 1..run), is the next game played? Censored past the last game
            for k in range(1, run + 1):
                if i + k >= len(seq): break
                played = k == run and ended
                for key in ('all',) + (('ended',) if ended else ()):
                    c = counts[key][min(k, MAX_STREAK)]
                    c[0] += played; c[1] += 1
            i = j


def main():
    counts = {'all': defaultdict(lambda: [0, 0]), 'ended': defaultdict(lambda: [0, 0])}
    for s in range(2018, 2026): season_counts(str(s), counts)
    for key, c in counts.items():
        print(f'{key}: QB/RB/WR/TE projected {MIN_PROJECTION:g}+ the week before, 2018-2025')
        for m in range(1, MAX_STREAK + 1):
            k, n = c[m]
            lo, hi = proportion_confint(k, n, method='wilson')
            print(f'  missed {m}{"+" if m == MAX_STREAK else " "}: played next {k / n:.2f} [{lo:.2f}, {hi:.2f}]  ({k} of {n})')


if __name__ == '__main__':
    main()
