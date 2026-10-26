/**
 * A week's awards, from its results and (when the season's insights are loaded) its lineups
 * and projections: high and low score, biggest blowout, closest game, unluckiest loss,
 * luckiest win, most left on the bench, biggest upset and biggest overachiever.
 */

import type { WeekMatchup } from '../types';
import type { TeamWeek } from './insights';

export interface Award {
  id: string;
  label: string;
  rosterId: number;
  /** Who it's for, e.g. "God Willing" or "God Willing over Perceive Me" */
  who: string;
  detail: string;
}

const pts = (v: number) => v.toFixed(2);

export function weekAwards(matchups: WeekMatchup[], teamWeeks?: Map<number, TeamWeek>): Award[] {
  const decided = matchups.filter((m) => m.winner && m.winner !== 'tie' && (m.team1.points > 0 || m.team2.points > 0));
  if (!decided.length) return [];
  const sides = decided.flatMap((m) => {
    const [w, l] = m.winner === 'team1' ? [m.team1, m.team2] : [m.team2, m.team1];
    return [
      { team: w, opp: l, won: true },
      { team: l, opp: w, won: false },
    ];
  });
  const games = decided.map((m) => {
    const [w, l] = m.winner === 'team1' ? [m.team1, m.team2] : [m.team2, m.team1];
    return { w, l, margin: w.points - l.points };
  });
  const by = <T,>(list: T[], f: (x: T) => number) => list.reduce((best, x) => (f(x) > f(best) ? x : best));
  const awards: Award[] = [];

  const high = by(sides, (s) => s.team.points);
  awards.push({ id: 'high', label: 'High score', rosterId: high.team.rosterId, who: high.team.name, detail: pts(high.team.points) });
  const low = by(sides, (s) => -s.team.points);
  awards.push({ id: 'low', label: 'Low score', rosterId: low.team.rosterId, who: low.team.name, detail: pts(low.team.points) });
  const blowout = by(games, (g) => g.margin);
  awards.push({ id: 'blowout', label: 'Biggest blowout', rosterId: blowout.w.rosterId, who: `${blowout.w.name} over ${blowout.l.name}`, detail: `by ${pts(blowout.margin)}` });
  const closest = by(games, (g) => -g.margin);
  awards.push({ id: 'closest', label: 'Closest game', rosterId: closest.w.rosterId, who: `${closest.w.name} over ${closest.l.name}`, detail: `by ${pts(closest.margin)}` });
  const unlucky = by(sides.filter((s) => !s.won), (s) => s.team.points);
  awards.push({ id: 'unlucky', label: 'Unluckiest loss', rosterId: unlucky.team.rosterId, who: unlucky.team.name, detail: `lost with ${pts(unlucky.team.points)}` });
  const lucky = by(sides.filter((s) => s.won), (s) => -s.team.points);
  awards.push({ id: 'lucky', label: 'Luckiest win', rosterId: lucky.team.rosterId, who: lucky.team.name, detail: `won with ${pts(lucky.team.points)}` });

  if (teamWeeks?.size) {
    const tw = (id: number) => teamWeeks.get(id);
    const benched = sides.filter((s) => tw(s.team.rosterId));
    if (benched.length) {
      const b = by(benched, (s) => tw(s.team.rosterId)!.optimal - s.team.points);
      const left = tw(b.team.rosterId)!.optimal - b.team.points;
      if (left >= 0.01) awards.push({ id: 'bench', label: 'Most left on bench', rosterId: b.team.rosterId, who: b.team.name, detail: `${pts(left)} pts${!b.won && tw(b.team.rosterId)!.optimal > b.opp.points ? ' (would have won)' : ''}` });
    }
    const projectedGames = games.filter((g) => tw(g.w.rosterId)?.projected != null && tw(g.l.rosterId)?.projected != null);
    if (projectedGames.length) {
      const u = by(projectedGames, (g) => tw(g.l.rosterId)!.projected! - tw(g.w.rosterId)!.projected!);
      const gap = tw(u.l.rosterId)!.projected! - tw(u.w.rosterId)!.projected!;
      if (gap > 0) awards.push({ id: 'upset', label: 'Biggest upset', rosterId: u.w.rosterId, who: `${u.w.name} over ${u.l.name}`, detail: `projected to lose by ${gap.toFixed(1)}` });
      const projectedSides = sides.filter((s) => tw(s.team.rosterId)?.projected != null);
      const o = by(projectedSides, (s) => s.team.points - tw(s.team.rosterId)!.projected!);
      awards.push({ id: 'over', label: 'Beat projections most', rosterId: o.team.rosterId, who: o.team.name, detail: `+${(o.team.points - tw(o.team.rosterId)!.projected!).toFixed(1)}` });
    }
  }
  return awards;
}
