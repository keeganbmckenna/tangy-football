/**
 * A player's box score line for a week, from Sleeper's weekly stats, covering every stat
 * the league scores: passing, rushing and receiving for every player (each left out when
 * he has none, led by his position's: passing for QBs, rushing for RBs, receiving for
 * receivers), two-point conversions, fumbles lost and fumble-recovery touchdowns; field
 * goals by distance for kickers (Sleeper counts field goals by distance range and the
 * longest, not each kick's length); and takeaways, touchdowns, return yards and points
 * allowed for defenses (not yards allowed, which the league doesn't score). Short labels,
 * like a box score: "26/34, 374 yd, 4 TD · 7 car, 25 yd" (completions/attempts unlabeled,
 * receptions/targets as "rec").
 */

/** The stats a box score line uses: the routes send only these, to keep responses small */
export const STAT_KEYS = [
  'pass_cmp', 'pass_att', 'pass_yd', 'pass_td', 'pass_int', 'pass_2pt',
  'rush_att', 'rush_yd', 'rush_td', 'rush_2pt',
  'rec', 'rec_tgt', 'rec_yd', 'rec_td', 'rec_2pt',
  'fum_lost', 'fum_rec_td',
  'fgm', 'fga', 'fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50_59', 'fgm_60p', 'fgm_50p', 'fgm_lng', 'xpm', 'xpa',
  'sack', 'int', 'fum_rec', 'def_td', 'def_st_td', 'def_2pt', 'safe', 'blk_kick', 'def_kr_yd', 'def_pr_yd', 'pts_allow',
] as const;

export type StatLine = Partial<Record<(typeof STAT_KEYS)[number], number>>;

/** Just the box score stats from a player's full stat line (nothing if he has none) */
export function pickStats(stats: Record<string, number> | undefined): StatLine | null {
  if (!stats) return null;
  const out: StatLine = {};
  // Zeros are left out, except a defense's points allowed (a shutout is news)
  for (const k of STAT_KEYS) if (stats[k] || (k === 'pts_allow' && stats[k] === 0)) out[k] = stats[k];
  return Object.keys(out).length ? out : null;
}

const join = (parts: Array<string | false | 0 | undefined>) => parts.filter(Boolean).join(', ');

function passing(s: StatLine): string {
  if (!s.pass_att) return '';
  return join([`${s.pass_cmp ?? 0}/${s.pass_att}`, `${s.pass_yd ?? 0} yd`, s.pass_td && `${s.pass_td} TD`, s.pass_int && `${s.pass_int} INT`]);
}
function rushing(s: StatLine): string {
  if (!s.rush_att) return '';
  return join([`${s.rush_att} car`, `${s.rush_yd ?? 0} yd`, s.rush_td && `${s.rush_td} TD`]);
}
function receiving(s: StatLine): string {
  if (!s.rec && !s.rec_tgt) return '';
  return join([`${s.rec ?? 0}/${s.rec_tgt ?? s.rec ?? 0} rec`, `${s.rec_yd ?? 0} yd`, s.rec_td && `${s.rec_td} TD`]);
}
function extras(s: StatLine): string {
  const twoPt = (s.pass_2pt ?? 0) + (s.rush_2pt ?? 0) + (s.rec_2pt ?? 0);
  return join([twoPt > 0 && `${twoPt} 2PT`, s.fum_lost && `${s.fum_lost} FL`, s.fum_rec_td && `${s.fum_rec_td} FR TD`]);
}

function kicking(s: StatLine): string {
  if (!s.fga && !s.xpa) return '';
  const ranges: Array<[string, number | undefined]> = [
    ['<20', s.fgm_0_19],
    ['20s', s.fgm_20_29],
    ['30s', s.fgm_30_39],
    ['40s', s.fgm_40_49],
    // 50s and 60+ when Sleeper splits them, else 50+
    ...(s.fgm_50_59 !== undefined || s.fgm_60p !== undefined
      ? ([['50s', s.fgm_50_59], ['60+', s.fgm_60p]] as Array<[string, number | undefined]>)
      : ([['50+', s.fgm_50p]] as Array<[string, number | undefined]>)),
  ];
  const made = ranges.filter(([, n]) => n).map(([r, n]) => `${r} ×${n}`);
  const fg = s.fga ? `FG ${s.fgm ?? 0}/${s.fga}${made.length ? ` (${made.join(', ')})` : ''}${s.fgm_lng ? `, lng ${s.fgm_lng}` : ''}` : '';
  const xp = s.xpa ? `XP ${s.xpm ?? 0}/${s.xpa}` : '';
  return [fg, xp].filter(Boolean).join(' · ');
}

function defense(s: StatLine): string {
  const plays = join([
    s.sack && `${s.sack} sk`,
    s.int && `${s.int} INT`,
    s.fum_rec && `${s.fum_rec} FR`,
    ((s.def_td ?? 0) + (s.def_st_td ?? 0)) > 0 && `${(s.def_td ?? 0) + (s.def_st_td ?? 0)} TD`,
    s.safe && `${s.safe} SF`,
    s.blk_kick && `${s.blk_kick} blk`,
    s.def_2pt && `${s.def_2pt} 2PT ret`,
    ((s.def_kr_yd ?? 0) + (s.def_pr_yd ?? 0)) > 0 && `${(s.def_kr_yd ?? 0) + (s.def_pr_yd ?? 0)} ret yd`,
  ]);
  const allowed = s.pts_allow !== undefined ? `${s.pts_allow} PA` : '';
  return [plays, allowed].filter(Boolean).join(' · ');
}

/** The week's box score line for a player at this position ('' if he has no stats) */
export function formatStatLine(position: string, s: StatLine | null | undefined): string {
  if (!s) return '';
  if (position === 'K') return kicking(s);
  if (position === 'DEF') return defense(s);
  // All three for everyone (each only when he has some), his position's first
  const parts =
    position === 'QB'
      ? [passing(s), rushing(s), receiving(s)]
      : position === 'RB'
        ? [rushing(s), receiving(s), passing(s)]
        : [receiving(s), rushing(s), passing(s)];
  return [...parts, extras(s)].filter(Boolean).join(' · ');
}
